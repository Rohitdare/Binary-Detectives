"""Unit tests for labelled-scenario evaluation accounting."""
import unittest
from unittest.mock import MagicMock, patch

from app import evaluator
from app.detectors.cycle import CycleDetectionResult
from app.detectors.fan_in import FanInDetectionResult
from app.detectors.fan_out import FanOutDetectionResult
from app.detectors.graph_pattern_utils import PatternDetectionResult


def candidate(candidate_id, accounts, tx_ids, suspicious=True):
    return {
        "cycle_id": candidate_id,
        "accounts": accounts,
        "transactions": [{"tx_id": tx_id} for tx_id in tx_ids],
        "suspicious": suspicious,
    }


class TestEvaluatorMetrics(unittest.TestCase):
    def setUp(self):
        self.labels = [
            {"alert_id": "F1", "kind": "fraud_cycle", "is_fraud": True,
             "accounts": {"A", "B", "C"}, "tx_ids": {"AB", "BC", "CA"}, "length": 3},
            {"alert_id": "B1", "kind": "slow_family_cycle", "is_fraud": False,
             "accounts": {"D", "E", "F"}, "tx_ids": {"DE", "EF", "FD"}, "length": 3},
        ]

    def evaluate(self, candidates):
        results = CycleDetectionResult(candidates)
        with patch.object(evaluator, "load_ground_truth", return_value=self.labels), \
             patch.object(evaluator, "detect_cycles", return_value=results):
            return evaluator.evaluate_cycle_detector(db=MagicMock())

    def test_metrics_use_one_to_one_exact_suspicious_matches(self):
        report = self.evaluate([
            candidate("fraud-hit", ["A", "B", "C"], ["AB", "BC", "CA"]),
            candidate("duplicate", ["A", "B", "C"], ["AB", "BC", "CA"]),
            candidate("benign-hit", ["D", "E", "F"], ["DE", "EF", "FD"]),
            candidate("partial", ["A", "B", "X"], ["AX", "XB", "BA"]),
        ])
        metrics = report["metrics"]
        self.assertEqual(metrics["true_positives"], 1)
        self.assertEqual(metrics["false_positives_on_labeled_benign_scenarios"], 1)
        self.assertEqual(metrics["false_negatives"], 0)
        self.assertEqual(metrics["precision"], 0.5)
        self.assertEqual(metrics["recall"], 1.0)
        self.assertEqual(metrics["partial_overlap_count_not_included"], 0)
        self.assertEqual(report["matching_results"]["unlabeled_suspicious_candidates_count"], 2)

    def test_structural_match_without_suspicious_signal_is_not_true_positive(self):
        report = self.evaluate([
            candidate("fraud-shape", ["A", "B", "C"], ["AB", "BC", "CA"], suspicious=False),
        ])
        metrics = report["metrics"]
        self.assertEqual(metrics["exact_structural_recall"], 1.0)
        self.assertEqual(metrics["true_positives"], 0)
        self.assertEqual(metrics["false_negatives"], 1)
        self.assertEqual(metrics["recall"], 0.0)

    def test_partial_account_overlap_is_reported_but_not_counted_as_recall(self):
        self.labels[0]["accounts"] = {"A", "B", "C", "D"}
        self.labels[0]["tx_ids"] = {"AB", "BC", "CD", "DA"}
        report = self.evaluate([
            candidate("partial-only", ["A", "B", "C"], ["AB", "BC", "CA"]),
        ])
        self.assertEqual(report["metrics"]["true_positives"], 0)
        self.assertEqual(report["metrics"]["recall"], 0.0)
        self.assertEqual(report["metrics"]["partial_overlap_count_not_included"], 1)
        self.assertFalse(report["matching_results"]["partial_matches"][0]["counts_as_true_positive"])

    def test_benign_overlap_is_reported_without_being_called_a_false_positive(self):
        report = self.evaluate([
            candidate("benign-lookalike", ["D", "E", "X"], ["DX", "XE", "ED"]),
        ])
        metrics = report["metrics"]
        self.assertEqual(metrics["false_positives_on_labeled_benign_scenarios"], 0)
        self.assertEqual(
            report["matching_results"]["benign_overlap_diagnostics_not_counted_as_false_positives"]["slow_family_cycle"],
            1,
        )

    def test_fan_evaluation_reports_labeled_metrics_and_unknowns_separately(self):
        labels = [
            {"alert_id": "FI_F", "pattern": "fan_in", "kind": "fan_in", "is_fraud": True,
             "accounts": {"R", "S1", "S2"}, "tx_ids": {"T1", "T2"}, "length": 2},
            {"alert_id": "FI_B", "pattern": "fan_in", "kind": "merchant_fan_in", "is_fraud": False,
             "accounts": {"M", "S3", "S4"}, "tx_ids": {"T3", "T4"}, "length": 2},
        ]

        def hit(hit_id, account_ids, tx_ids):
            return {"hit_id": hit_id, "account_ids": account_ids, "tx_ids": tx_ids,
                    "transactions": [{"tx_id": tx_id} for tx_id in tx_ids],
                    "measurements": {"suspicious": True}}

        fan_in = FanInDetectionResult([
            hit("TP", ["R", "S1", "S2"], ["T1", "T2"]),
            hit("FP", ["M", "S3", "S4"], ["T3", "T4"]),
            hit("UNKNOWN", ["X", "Y", "Z"], ["TX", "TY"]),
        ])
        with patch.object(evaluator, "load_ground_truth", return_value=labels), \
             patch.object(evaluator, "detect_fan_in", return_value=fan_in), \
             patch.object(evaluator, "detect_fan_out", return_value=FanOutDetectionResult([])):
            report = evaluator.evaluate_fan_detectors(db=MagicMock())

        metrics = report["patterns"]["fan_in"]["metrics"]
        self.assertEqual(metrics["true_positives"], 1)
        self.assertEqual(metrics["false_positives_on_labeled_benign_scenarios"], 1)
        self.assertEqual(metrics["false_negatives"], 0)
        self.assertEqual(metrics["precision_on_labeled_scenarios"], 0.5)
        self.assertEqual(report["patterns"]["fan_in"]["unlabeled_suspicious_candidates_count"], 1)

    def test_ground_truth_loader_filters_requested_pattern(self):
        fan_in_labels = evaluator.load_ground_truth(pattern="fan_in")
        self.assertEqual(len(fan_in_labels), 22)
        self.assertEqual({item["pattern"] for item in fan_in_labels}, {"fan_in"})

    def test_fan_evaluation_route_alias_is_additive(self):
        with patch("app.db.FalkorDBClient"):
            from app import main
        expected = {"status": "success", "patterns": {}}
        with patch("app.evaluator.evaluate_fan_detectors", return_value=expected):
            self.assertEqual(main.evaluate_fan_patterns(limit=10), expected)

    def test_path_detector_evaluation_counts_exact_matches_and_reports_overlap(self):
        def label(alert_id, pattern, is_fraud, accounts, tx_ids, kind):
            return {"alert_id": alert_id, "pattern": pattern, "is_fraud": is_fraud,
                    "accounts": set(accounts), "tx_ids": set(tx_ids), "kind": kind}

        labels = {
            "relay_chain": [
                label("RF", "relay_chain", True, ["A", "B", "C", "D"], ["AB", "BC", "CD"], "relay_chain"),
                label("RB", "relay_chain", False, ["E", "F", "G", "H"], ["EF", "FG", "GH"], "near_miss_relay"),
            ],
            "scatter_gather": [label("SF", "scatter_gather", True, ["S", "I", "T"], ["SI", "IT"], "scatter_gather")],
            "gather_scatter": [label("GF", "gather_scatter", True, ["H", "A", "B", "C"], ["AH", "BH", "HC"], "gather_scatter")],
            "bipartite": [], "dense_cluster": [], "hub_account": [],
        }

        def hit(hit_id, accounts, tx_ids, suspicious=True):
            return {"hit_id": hit_id, "account_ids": accounts, "tx_ids": tx_ids,
                    "measurements": {"suspicious": suspicious}}

        detector_results = {
            "relay_chain": PatternDetectionResult([
                hit("RTP", ["A", "B", "C", "D"], ["AB", "BC", "CD"]),
                hit("RFP", ["E", "F", "G", "H"], ["EF", "FG", "GH"]),
                hit("RUNKNOWN", ["X", "Y"], ["XY"]),
            ]),
            "scatter_gather": PatternDetectionResult([hit("STP", ["S", "I", "T"], ["SI", "IT"])]),
            "gather_scatter": PatternDetectionResult([hit("GTP", ["H", "A", "B", "C"], ["AH", "BH", "HC"])]),
            "bipartite": PatternDetectionResult([]),
            "dense_cluster": PatternDetectionResult([]),
            "hub_account": PatternDetectionResult([]),
        }
        with patch.object(evaluator, "load_ground_truth", side_effect=lambda data_dir, client, pattern: labels[pattern]), \
             patch.object(evaluator, "detect_relay_chains", return_value=detector_results["relay_chain"]), \
             patch.object(evaluator, "detect_scatter_gather", return_value=detector_results["scatter_gather"]), \
             patch.object(evaluator, "detect_gather_scatter", return_value=detector_results["gather_scatter"]), \
             patch.object(evaluator, "detect_bipartite", return_value=detector_results["bipartite"]), \
             patch.object(evaluator, "detect_dense_clusters", return_value=detector_results["dense_cluster"]), \
             patch.object(evaluator, "detect_hub_accounts", return_value=detector_results["hub_account"]):
            report = evaluator.evaluate_additional_graph_detectors(db=MagicMock())

        self.assertEqual(set(report["patterns"]), {"relay_chain", "scatter_gather", "gather_scatter",
                                                     "bipartite", "dense_cluster", "hub_account"})
        relay = report["patterns"]["relay_chain"]
        self.assertEqual(relay["metrics"]["true_positives"], 1)
        self.assertEqual(relay["metrics"]["false_positives_on_labeled_benign_scenarios"], 1)
        self.assertEqual(relay["unlabeled_suspicious_candidates_excluded_from_precision"], 1)
        self.assertEqual(report["patterns"]["scatter_gather"]["metrics"]["false_positive_rate_on_labeled_benign_scenarios"], None)
        self.assertEqual(report["patterns"]["bipartite"]["status"], "not_evaluable")
        self.assertEqual(report["patterns"]["hub_account"]["status"], "not_evaluable")

    def test_path_detector_evaluation_route_alias_is_additive(self):
        with patch("app.db.FalkorDBClient"):
            from app import main
        expected = {"status": "success", "patterns": {}}
        with patch("app.evaluator.evaluate_additional_graph_detectors", return_value=expected):
            self.assertEqual(main.evaluate_graph_patterns(limit=10), expected)


if __name__ == "__main__":
    unittest.main()
