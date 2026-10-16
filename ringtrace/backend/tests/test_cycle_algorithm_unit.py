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
from app.detectors.fan_in import detect_fan_in
from app.detectors.fan_out import detect_fan_out


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
            SimpleNamespace(result_set=[["SINK_01", "personal", 8]]),
            SimpleNamespace(result_set=[[len(transactions)]]),
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
            SimpleNamespace(result_set=[["ORIG_01", "personal", 9]]),
            SimpleNamespace(result_set=[[len(transactions)]]),
            SimpleNamespace(result_set=[[
                tx["tx_id"], tx["src"], tx["dst"], tx["amount"], tx["ts"], tx["step"], tx["tx_type"]
            ] for tx in transactions]),
        ]
        hits = detect_fan_out(db=self.db)
        hit = next(item for item in hits if item["account_ids"][0] == "ORIG_01")
        self.assertTrue(hit["measurements"]["suspicious"])
        self.assertEqual({tx["tx_id"] for tx in hit["transactions"]}, set(hit["tx_ids"]))

    def test_api_returns_evidence_metadata_and_timeout_error(self):
        with patch("app.db.FalkorDBClient"):
            from app import main

        with patch.object(main.db_client, "execute_query", return_value=SimpleNamespace(result_set=cycle_rows())):
            data = main.get_cycle_candidates(min_length=3, max_length=3, limit=50)
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["suspicious_count"], 1)
        self.assertEqual(data["cycles"][0]["transactions"][0]["tx_id"], "TX_AB")
        self.assertGreaterEqual(data["execution_time_ms"], 0)

        with patch.object(main.db_client, "execute_query", side_effect=TimeoutError("query timed out")):
            with self.assertRaises(main.HTTPException) as raised:
                main.get_cycle_candidates(min_length=3, max_length=3, limit=50)
        self.assertEqual(raised.exception.status_code, 500)
        self.assertIn("query timed out", raised.exception.detail)


if __name__ == "__main__":
    unittest.main()
