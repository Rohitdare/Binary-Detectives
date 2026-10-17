"""Fast isolated tests for bounded cycle search and its API response."""
import os
import json
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.detectors.cycle import detect_cycles
from app.detectors.fan_in import detect_fan_in, extract_fan_in_bursts
from app.detectors.fan_out import detect_fan_out, extract_fan_out_bursts
from app.queries import GET_ACCOUNT_INCOMING_TRANSFERS, GET_ACCOUNT_OUTGOING_TRANSFERS, GET_CYCLE_EDGES
from app.detectors.windowing import normalize_transaction_rows


def cycle_rows(last_ts: int = 3000):
    third_ts = last_ts
    second_ts = 2000 if last_ts == 3000 else last_ts // 2
    return [
        ["A", "B", "TX_AB", 10000.0, 1000, 1, "UPI"],
        ["B", "C", "TX_BC", 9500.0, second_ts, 1, "NEFT"],
        ["C", "A", "TX_CA", 9000.0, third_ts, 1, "IMPS"],
    ]


class TestCycleAlgorithmUnit(unittest.TestCase):
    def setUp(self):
        from unittest.mock import MagicMock

        self.db = MagicMock()
        self.db.execute_query.return_value = SimpleNamespace(result_set=cycle_rows())

    def _fixture_snapshot(self, filename):
        fixture_path = os.path.join(BACKEND_DIR, "tests", "fixtures", filename)
        with open(fixture_path, encoding="utf-8") as stream:
            fixture = json.load(stream)
        edges = [{key: tx[key] for key in ("tx_id", "src", "dst", "amount", "ts", "step", "tx_type")}
                 for tx in fixture["transactions"]]
        return fixture, (edges, False, 0)

    def test_cycle_positive_fixture_returns_exact_suspicious_evidence(self):
        fixture, snapshot = self._fixture_snapshot("cycle_positive.json")
        result = detect_cycles(min_length=3, max_length=3, db=self.db, edge_snapshot=snapshot)
        self.assertEqual(len(result), 1)
        self.assertTrue(result[0]["suspicious"])
        self.assertEqual(set(result[0]["accounts"]), {account["id"] for account in fixture["accounts"]})
        self.assertEqual(set(result[0]["canonical_edge_sequence"]),
                         {tx["tx_id"] for tx in fixture["transactions"]})
        self.assertEqual({tx["tx_id"] for tx in result[0]["transactions"]},
                         {tx["tx_id"] for tx in fixture["transactions"]})

    def test_cycle_negative_fixture_is_structural_but_not_suspicious(self):
        fixture, snapshot = self._fixture_snapshot("cycle_negative.json")
        result = detect_cycles(min_length=4, max_length=4, db=self.db, edge_snapshot=snapshot)
        self.assertEqual(len(result), 1)
        self.assertFalse(result[0]["suspicious"])
        self.assertEqual(result[0]["duration_seconds"], 97200)
        self.assertEqual(set(result[0]["canonical_edge_sequence"]),
                         {tx["tx_id"] for tx in fixture["transactions"]})

    def test_fast_cycle_is_review_candidate_with_complete_evidence(self):
        result = detect_cycles(min_length=3, max_length=3, db=self.db)
        self.assertEqual(len(result), 1)
        self.assertTrue(result[0]["suspicious"])
        self.assertEqual(result[0]["canonical_edge_sequence"], ["TX_AB", "TX_BC", "TX_CA"])
        self.assertEqual(result[0]["accounts"], ["A", "B", "C"])
        self.assertEqual(result.edges_scanned, 3)

    def test_slow_candidate_is_not_marked_suspicious(self):
        self.db.execute_query.return_value = SimpleNamespace(result_set=cycle_rows(last_ts=91000))
        result = detect_cycles(min_length=3, max_length=3, db=self.db)
        self.assertEqual(len(result), 1)
        self.assertFalse(result[0]["suspicious"])
        self.assertIn("cycle candidate only", result[0]["explanation"])

    def test_equal_timestamp_hops_are_not_chronologically_ordered(self):
        self.db.execute_query.return_value = SimpleNamespace(result_set=[
            ["A", "B", "TX_AB", 10000.0, 1000, 1, "UPI"],
            ["B", "C", "TX_BC", 9500.0, 1000, 1, "UPI"],
            ["C", "A", "TX_CA", 9000.0, 3000, 1, "UPI"],
        ])
        result = detect_cycles(min_length=3, max_length=3, db=self.db)
        self.assertEqual(result, [])

    def test_cycle_can_start_at_earliest_edge_not_smallest_account(self):
        self.db.execute_query.return_value = SimpleNamespace(result_set=[
            ["Z", "A", "TX_ZA", 10000.0, 1000, 1, "UPI"],
            ["A", "B", "TX_AB", 9500.0, 2000, 1, "UPI"],
            ["B", "Z", "TX_BZ", 9000.0, 3000, 1, "UPI"],
        ])
        result = detect_cycles(min_length=3, max_length=3, db=self.db)
        self.assertEqual(len(result), 1)
        # Output accounts rotate to the canonical smallest transaction ID, so
        # they need not start at the earliest transaction's source.
        self.assertEqual(result[0]["accounts"], ["A", "B", "Z"])
        self.assertTrue(result[0]["suspicious"])

    def test_malformed_transaction_rows_are_skipped_and_reported(self):
        valid, skipped = normalize_transaction_rows([
            ["TX_OK", "A", "B", 10.0, 100, 1, "UPI"],
            ["TX_BAD", "A", "B", "not-an-amount", 101, 1, "UPI"],
        ])
        self.assertEqual(len(valid), 1)
        self.assertEqual(skipped, 1)

        self.db.execute_query.return_value = SimpleNamespace(result_set=[
            ["A", "B", "TX_AB", 10000.0, 1000, 1, "UPI"],
            ["B", "C", "TX_BC", 9500.0, 2000, 1, "UPI"],
            ["C", "A", "TX_CA", 9000.0, 3000, 1, "UPI"],
            ["BAD", "A", "B", None, "bad-ts", 1, "UPI"],
        ])
        result = detect_cycles(min_length=3, max_length=3, db=self.db)
        self.assertEqual(len(result), 1)
        self.assertTrue(result.truncated)
        self.assertEqual(result.truncation_reason, "invalid_transaction_rows")
        self.assertEqual(result.invalid_rows_skipped, 1)

    def test_cycle_limit_prioritizes_suspicious_results(self):
        rows = [
            ["A1", "A2", "TX_A12", 10000.0, 1000, 1, "UPI"],
            ["A2", "A3", "TX_A23", 9500.0, 2000, 1, "UPI"],
            ["A3", "A1", "TX_A31", 9000.0, 3000, 1, "UPI"],
            ["Z1", "Z2", "TX_Z12", 10000.0, 1000, 1, "UPI"],
            ["Z2", "Z3", "TX_Z23", 9500.0, 45500, 1, "UPI"],
            ["Z3", "Z1", "TX_Z31", 9000.0, 91000, 1, "UPI"],
        ]
        self.db.execute_query.return_value = SimpleNamespace(result_set=rows)
        result = detect_cycles(min_length=3, max_length=3, limit=1, db=self.db)
        self.assertEqual(len(result), 1)
        self.assertTrue(result[0]["suspicious"])
        self.assertEqual({tx["tx_id"] for tx in result[0]["transactions"]}, {"TX_A12", "TX_A23", "TX_A31"})
        self.assertTrue(result.truncated)
        self.assertEqual(result.truncation_reason, "result_limit")

    def test_empty_and_database_error_results(self):
        self.db.execute_query.return_value = SimpleNamespace(result_set=[])
        self.assertEqual(detect_cycles(db=self.db), [])
        self.db.execute_query.side_effect = TimeoutError("query timed out")
        with self.assertRaisesRegex(TimeoutError, "query timed out"):
            detect_cycles(db=self.db)

    def test_edge_scan_limit_is_reported_truthfully(self):
        self.db.execute_query.return_value = SimpleNamespace(result_set=cycle_rows() * 2)
        with patch("app.detectors.cycle.EDGE_SCAN_LIMIT", 3):
            result = detect_cycles(min_length=3, max_length=3, db=self.db)
        self.assertTrue(result.truncated)
        self.assertEqual(result.truncation_reason, "edge_scan_limit")
        self.assertEqual(result.edges_scanned, 3)

    def test_fan_in_fixture_produces_suspicious_hit_with_real_transaction_rows(self):
        fixture_path = os.path.join(BACKEND_DIR, "tests", "fixtures", "fan_in_positive.json")
        with open(fixture_path, encoding="utf-8") as stream:
            transactions = json.load(stream)["transactions"]
        self.db.execute_query.side_effect = [
            SimpleNamespace(result_set=[["SINK_01", "personal", 8, len(transactions)]]),
            SimpleNamespace(result_set=[[
                tx["tx_id"], tx["src"], tx["dst"], tx["amount"], tx["ts"], tx["step"], tx["tx_type"]
            ] for tx in transactions]),
        ]
        hits = detect_fan_in(db=self.db)
        hit = next(item for item in hits if item["account_ids"][0] == "SINK_01")
        self.assertTrue(hit["measurements"]["suspicious"])
        self.assertEqual({tx["tx_id"] for tx in hit["transactions"]}, set(hit["tx_ids"]))

    def test_fan_out_fixture_produces_suspicious_hit_with_real_transaction_rows(self):
        fixture_path = os.path.join(BACKEND_DIR, "tests", "fixtures", "fan_out_positive.json")
        with open(fixture_path, encoding="utf-8") as stream:
            transactions = json.load(stream)["transactions"]
        self.db.execute_query.side_effect = [
            SimpleNamespace(result_set=[["ORIG_01", "personal", 9, len(transactions)]]),
            SimpleNamespace(result_set=[[
                tx["tx_id"], tx["src"], tx["dst"], tx["amount"], tx["ts"], tx["step"], tx["tx_type"]
            ] for tx in transactions]),
        ]
        hits = detect_fan_out(db=self.db)
        hit = next(item for item in hits if item["account_ids"][0] == "ORIG_01")
        self.assertTrue(hit["measurements"]["suspicious"])
        self.assertEqual({tx["tx_id"] for tx in hit["transactions"]}, set(hit["tx_ids"]))

    def test_fan_in_prioritizes_suspicious_hit_over_benign_high_volume_hit(self):
        benign = [[f"TX_B{i}", f"S{i}", "BENIGN", 1000.0, 10000 + i * 60, 1, "UPI"] for i in range(8)]
        suspicious = [[f"TX_S{i}", f"I{i}", "SUSPICIOUS", 47500.0, 20000 + i * 60, 1, "UPI"] for i in range(8)]
        self.db.execute_query.side_effect = [
            SimpleNamespace(result_set=[["BENIGN", "merchant", 8, 8], ["SUSPICIOUS", "personal", 8, 8]]),
            SimpleNamespace(result_set=benign),
            SimpleNamespace(result_set=suspicious),
        ]
        hits = detect_fan_in(limit=1, db=self.db)
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["account_ids"][0], "SUSPICIOUS")
        self.assertTrue(hits[0]["measurements"]["suspicious"])
        self.assertTrue(hits.truncated)

    def test_fan_out_prioritizes_suspicious_hit_over_recurring_payroll(self):
        def tx_rows(origin, amount):
            return [[f"TX_{origin}_{i}", origin, f"R{i}", amount, 10000 + i * 60, 1, "UPI"] for i in range(8)]

        self.db.execute_query.side_effect = [
            SimpleNamespace(result_set=[["PAYROLL", "payroll", 8, 8], ["SUSPICIOUS", "personal", 8, 8]]),
            SimpleNamespace(result_set=tx_rows("PAYROLL", 1000.0)),
            SimpleNamespace(result_set=tx_rows("SUSPICIOUS", 47500.0)),
        ]
        hits = detect_fan_out(limit=1, db=self.db)
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["account_ids"][0], "SUSPICIOUS")
        self.assertTrue(hits[0]["measurements"]["suspicious"])
        self.assertTrue(hits.truncated)

    def test_fan_results_expose_incomplete_account_history(self):
        rows = [["TX1", "S1", "SINK", 100.0, 100, 1, "UPI"]]
        self.db.execute_query.side_effect = [
            SimpleNamespace(result_set=[["SINK", "personal", 8, 2]]),
            SimpleNamespace(result_set=rows),
        ]
        result = detect_fan_in(limit=10, max_txs_per_account=1, db=self.db)
        self.assertTrue(result.truncated)
        self.assertEqual(result.truncation_reason, "account_history_limit_reached")
        self.assertIn("ORDER BY t.ts DESC", GET_ACCOUNT_INCOMING_TRANSFERS)
        self.assertIn("ORDER BY t.ts DESC", GET_ACCOUNT_OUTGOING_TRANSFERS)
        self.assertIn("ORDER BY t.ts DESC", GET_CYCLE_EDGES)

    def test_truncated_payroll_history_yields_indeterminate_classification(self):
        rows = [[f"T{i}", "PAYROLL", f"R{i}", 1000.0, 1000 + i * 60, 1, "NEFT"] for i in range(8)]
        self.db.execute_query.side_effect = [
            SimpleNamespace(result_set=[["PAYROLL", "payroll", 8, 9]]),
            SimpleNamespace(result_set=rows),
        ]
        result = detect_fan_out(limit=10, max_txs_per_account=8, db=self.db)
        self.assertTrue(result.truncated)
        self.assertEqual(result.truncation_reason, "account_history_limit_reached")
        self.assertEqual(len(result), 1)
        self.assertFalse(result[0]["measurements"]["suspicious"])
        self.assertTrue(result[0]["measurements"]["suspicion_indeterminate"])
        self.assertEqual(result[0]["measurements"]["payroll_recurrence_status"], "unknown_incomplete_history")

    def test_fan_in_retains_overlapping_qualifying_windows_as_separate_bursts(self):
        transactions = [
            {"tx_id": f"A{i}", "src": f"A{i}", "dst": "SINK", "ts": 0}
            for i in range(8)
        ] + [
            {"tx_id": f"B{i}", "src": f"B{i}", "dst": "SINK", "ts": 172800}
            for i in range(4)
        ] + [
            {"tx_id": f"C{i}", "src": f"C{i}", "dst": "SINK", "ts": 259200}
            for i in range(4)
        ]
        bursts = extract_fan_in_bursts(transactions, window_seconds=172800, min_senders=8)
        self.assertEqual(len(bursts), 2)
        self.assertTrue({f"B{i}" for i in range(4)}.issubset({tx["tx_id"] for tx in bursts[0]}))
        self.assertTrue({f"B{i}" for i in range(4)}.issubset({tx["tx_id"] for tx in bursts[1]}))

    def test_fan_out_retains_overlapping_qualifying_windows_as_separate_bursts(self):
        transactions = [
            {"tx_id": f"A{i}", "src": "ORIGIN", "dst": f"A{i}", "ts": 0}
            for i in range(8)
        ] + [
            {"tx_id": f"B{i}", "src": "ORIGIN", "dst": f"B{i}", "ts": 172800}
            for i in range(4)
        ] + [
            {"tx_id": f"C{i}", "src": "ORIGIN", "dst": f"C{i}", "ts": 259200}
            for i in range(4)
        ]
        bursts = extract_fan_out_bursts(transactions, window_seconds=172800, min_receivers=8)
        self.assertEqual(len(bursts), 2)
        self.assertTrue({f"B{i}" for i in range(4)}.issubset({tx["tx_id"] for tx in bursts[0]}))
        self.assertTrue({f"B{i}" for i in range(4)}.issubset({tx["tx_id"] for tx in bursts[1]}))

    def test_fan_window_includes_exact_boundary_but_excludes_one_second_beyond(self):
        inside = [
            {"tx_id": "T1", "src": "S1", "dst": "R1", "ts": 100},
            {"tx_id": "T2", "src": "S2", "dst": "R2", "ts": 200},
        ]
        outside = [dict(inside[0]), dict(inside[1], ts=201)]
        self.assertEqual(len(extract_fan_in_bursts(inside, window_seconds=100, min_senders=2)), 1)
        self.assertEqual(len(extract_fan_in_bursts(outside, window_seconds=100, min_senders=2)), 0)
        self.assertEqual(len(extract_fan_out_bursts(inside, window_seconds=100, min_receivers=2)), 1)
        self.assertEqual(len(extract_fan_out_bursts(outside, window_seconds=100, min_receivers=2)), 0)

    def test_api_returns_evidence_metadata_and_timeout_error(self):
        with patch("app.db.FalkorDBClient"):
            from app import main

        with patch.object(main.db_client, "execute_query", return_value=SimpleNamespace(result_set=cycle_rows())):
            data = main.get_cycle_candidates(min_length=3, max_length=3, limit=50)
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["suspicious_count"], 1)
        self.assertEqual(data["cycles"][0]["transactions"][0]["tx_id"], "TX_AB")
        self.assertGreaterEqual(data["execution_time_ms"], 0)
        self.assertIn("invalid_rows_skipped", data)

        with patch.object(main.db_client, "execute_query", side_effect=TimeoutError("query timed out")):
            with self.assertRaises(main.HTTPException) as raised:
                main.get_cycle_candidates(min_length=3, max_length=3, limit=50)
        self.assertEqual(raised.exception.status_code, 500)
        self.assertIn("query timed out", raised.exception.detail)


if __name__ == "__main__":
    unittest.main()
