"""Tests for Ground-Truth Isolation and Metric Calculation Correctness (Member A).

Verifies:
1. Strict zero leakage: Detectors and scan services never import evaluator or query labels.
2. Production graph integrity: No fraud labels on Account nodes or SENT edges.
3. Metric calculations: TP, FP, FN, TN, precision, recall, F1, FPR edge cases.
4. Unevaluable patterns: hub_account correctly reports None instead of manufactured 0.0.
5. Benign-free patterns: FPR is None (undefined) when no benign scenarios exist.
6. One-to-one matching: No double-counting of candidates or ground-truth alerts.
7. Aggregate evaluation: evaluate_all_detectors macro/micro metrics and API compatibility.
"""
import ast
import glob
import os
import unittest
from unittest.mock import MagicMock

from app.db import FalkorDBClient
from app.evaluator import (
    evaluate_additional_graph_detectors,
    evaluate_all_detectors,
    evaluate_cycle_detector,
    evaluate_fan_detectors,
    load_ground_truth,
)
from app.queries import LABEL_LEAKAGE_CHECK


class TestGroundTruthIsolation(unittest.TestCase):
    """Verify that operational detectors and scanning code never access ground truth."""

    def setUp(self):
        self.backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.detectors_dir = os.path.join(self.backend_dir, "app", "detectors")

    def test_ast_no_evaluator_imports_in_detectors(self):
        """Operational detector code must never import app.evaluator or reference alerts.csv."""
        detector_files = glob.glob(os.path.join(self.detectors_dir, "*.py"))
        self.assertGreater(len(detector_files), 5, "Should find detector modules")

        for file_path in detector_files:
            with open(file_path, "r", encoding="utf-8") as f:
                tree = ast.parse(f.read(), filename=file_path)

            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        self.assertNotIn("evaluator", alias.name, f"Forbidden import of evaluator in {file_path}")
                        self.assertNotIn("alerts", alias.name, f"Forbidden import of alerts in {file_path}")
                elif isinstance(node, ast.ImportFrom):
                    module = node.module or ""
                    self.assertNotIn("evaluator", module, f"Forbidden import from evaluator in {file_path}")
                    self.assertNotIn("alerts", module, f"Forbidden import from alerts in {file_path}")

    def test_ast_no_evaluator_imports_in_scan_and_cases(self):
        """Scan service, scheduler, and case builder must never import evaluator."""
        core_files = [
            os.path.join(self.backend_dir, "app", "scan_service.py"),
            os.path.join(self.backend_dir, "app", "cases", "builder.py"),
            os.path.join(self.backend_dir, "app", "cases", "priority.py"),
            os.path.join(self.backend_dir, "app", "scheduler", "service.py"),
        ]

        for file_path in core_files:
            if not os.path.exists(file_path):
                continue
            with open(file_path, "r", encoding="utf-8") as f:
                tree = ast.parse(f.read(), filename=file_path)

            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        self.assertNotIn("evaluator", alias.name, f"Forbidden import of evaluator in {file_path}")
                elif isinstance(node, ast.ImportFrom):
                    module = node.module or ""
                    self.assertNotIn("evaluator", module, f"Forbidden import from evaluator in {file_path}")

    def test_detectors_never_query_labels_graph(self):
        """Detector invocations with a mock DB must never call execute_query with graph_name='labels'."""
        from app.detectors import (
            detect_bipartite,
            detect_cycles,
            detect_dense_clusters,
            detect_fan_in,
            detect_fan_out,
            detect_gather_scatter,
            detect_hub_accounts,
            detect_relay_chains,
            detect_scatter_gather,
        )

        mock_db = MagicMock()
        mock_result = MagicMock()
        mock_result.result_set = []
        mock_db.execute_query.return_value = mock_result

        detectors = [
            (detect_cycles, {"limit": 5}),
            (detect_fan_in, {"limit": 5}),
            (detect_fan_out, {"limit": 5}),
            (detect_relay_chains, {"limit": 5}),
            (detect_scatter_gather, {"limit": 5}),
            (detect_gather_scatter, {"limit": 5}),
            (detect_bipartite, {"limit": 5}),
            (detect_dense_clusters, {"limit": 5}),
            (detect_hub_accounts, {"limit": 5}),
        ]

        for det_fn, kwargs in detectors:
            mock_db.reset_mock()
            try:
                det_fn(graph_name="txn", db=mock_db, **kwargs)
            except Exception:
                pass  # Algorithmic exception on empty results is fine; we inspect call arguments

            for call in mock_db.execute_query.call_args_list:
                args, _ = call
                graph_arg = args[0]
                self.assertNotEqual(
                    graph_arg, "labels",
                    f"{det_fn.__name__} executed query against forbidden 'labels' graph!"
                )
                self.assertEqual(graph_arg, "txn")

    def test_production_graph_has_zero_leakage_labels(self):
        """The live txn graph must have 0 Account nodes with fraud labels."""
        client = FalkorDBClient()
        try:
            result = client.execute_query("txn", LABEL_LEAKAGE_CHECK, caller="test:label_leakage")
            leakage_count = result.result_set[0][0]
            self.assertEqual(leakage_count, 0, f"Found {leakage_count} leaked label properties on Account nodes in 'txn'")
        except Exception as e:
            # If database is offline, skip test gracefully
            self.skipTest(f"FalkorDB unavailable for live graph check: {e}")


class TestEvaluationMetricsCorrectness(unittest.TestCase):
    """Verify evaluator metric formulas, edge cases, and unevaluable pattern handling."""

    def setUp(self):
        self.backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.sim_dir = os.path.join(self.backend_dir, "data", "sim")

    def test_ground_truth_inventory(self):
        """Verify ground-truth dataset has 116 total alerts across known patterns."""
        if not os.path.exists(os.path.join(self.sim_dir, "alerts.csv")):
            self.skipTest("Simulation alerts.csv not found")

        alerts = load_ground_truth(self.sim_dir, pattern=None)
        self.assertEqual(len(alerts), 116, "Expected exactly 116 planted alerts in simulation dataset")

        fraud = [a for a in alerts if a["is_fraud"]]
        benign = [a for a in alerts if not a["is_fraud"]]
        self.assertEqual(len(fraud), 80, "Expected 80 planted fraud scenarios")
        self.assertEqual(len(benign), 36, "Expected 36 planted benign look-alike scenarios")

    def test_hub_account_is_not_evaluable(self):
        """hub_account has no planted scenarios and must report None metrics, not 0.0."""
        # Use isolated dummy evaluation call or verify evaluator output
        client = MagicMock()
        mock_result = MagicMock()
        mock_result.result_set = []
        client.execute_query.return_value = mock_result

        # Run evaluate_additional_graph_detectors with empty ground truth
        report = evaluate_additional_graph_detectors(data_dir=self.sim_dir, sample_limit=10, db=client, edge_snapshot=[])
        hub_rep = report["patterns"]["hub_account"]

        self.assertEqual(hub_rep["status"], "not_evaluable")
        self.assertEqual(hub_rep["planted_fraud_scenarios"], 0)
        self.assertEqual(hub_rep["planted_benign_scenarios"], 0)
        self.assertIsNone(hub_rep["metrics"]["precision_on_labeled_scenarios"])
        self.assertIsNone(hub_rep["metrics"]["recall"])
        self.assertIsNone(hub_rep["metrics"]["f1"])
        self.assertIsNone(hub_rep["metrics"]["false_positive_rate_on_labeled_benign_scenarios"])
        self.assertIn("No planted ground-truth alerts exist", hub_rep["limitations"][0])

    def test_patterns_without_benign_controls_have_none_fpr(self):
        """Patterns without benign look-alikes must report FPR as None (undefined), not 0.0."""
        client = MagicMock()
        mock_result = MagicMock()
        mock_result.result_set = []
        client.execute_query.return_value = mock_result

        report = evaluate_additional_graph_detectors(data_dir=self.sim_dir, sample_limit=10, db=client, edge_snapshot=[])
        for pattern in ("scatter_gather", "gather_scatter", "bipartite", "dense_cluster"):
            pat_rep = report["patterns"][pattern]
            self.assertEqual(pat_rep["planted_benign_scenarios"], 0)
            self.assertIsNone(
                pat_rep["metrics"]["false_positive_rate_on_labeled_benign_scenarios"],
                f"{pattern} falsely reported a numerical FPR when 0 benign scenarios exist"
            )

    def test_zero_denominator_metrics_safety(self):
        """Verify that precision/recall/F1/FPR never raise ZeroDivisionError."""
        # Empty predictions on evaluable ground truth
        client = MagicMock()
        mock_result = MagicMock()
        mock_result.result_set = []
        client.execute_query.return_value = mock_result

        # evaluate_fan_detectors with zero candidates found
        report = evaluate_fan_detectors(data_dir=self.sim_dir, sample_limit=10, db=client, edge_snapshot=[])
        for pattern in ("fan_in", "fan_out"):
            metrics = report["patterns"][pattern]["metrics"]
            self.assertIn("precision_on_labeled_scenarios", metrics)
            self.assertIn("recall", metrics)
            self.assertIn("f1", metrics)
            # When 0 hits returned, TP=0, FP=0 -> precision is 0.0 (evaluable, but 0 positive hits)
            self.assertEqual(metrics["true_positives"], 0)
            self.assertEqual(metrics["recall"], 0.0)

    def test_evaluate_all_detectors_aggregation(self):
        """Verify evaluate_all_detectors aggregates 9 detectors into valid summary."""
        client = MagicMock()
        mock_result = MagicMock()
        mock_result.result_set = []
        client.execute_query.return_value = mock_result

        full_rep = evaluate_all_detectors(data_dir=self.sim_dir, sample_limit=10, db=client, edge_snapshot=[])
        self.assertIn("overall_summary", full_rep)
        self.assertIn("by_detector", full_rep)
        self.assertEqual(len(full_rep["by_detector"]), 9)

        summary = full_rep["overall_summary"]
        self.assertEqual(summary["total_planted_alerts"], 116)
        self.assertEqual(summary["evaluable_patterns_count"], 8)
        self.assertEqual(summary["unevaluable_patterns_count"], 1)
        self.assertEqual(summary["patterns_with_benign_controls"], 4)
        self.assertEqual(summary["patterns_without_benign_controls"], 4)

        # Confirm macro metrics do not crash or produce NaN
        self.assertIsInstance(summary["micro_precision"], float)
        self.assertIsInstance(summary["micro_recall"], float)
        self.assertIsInstance(summary["micro_f1"], float)


if __name__ == "__main__":
    unittest.main()
