"""Isolated fixture tests for relay, scatter-gather, and gather-scatter."""
import json
import os
import sys
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.db import FalkorDBClient
from app.detectors.gather_scatter import detect_gather_scatter
from app.detectors.relay_chain import detect_relay_chains
from app.detectors.scatter_gather import detect_scatter_gather
from app.detectors.graph_pattern_utils import PatternDetectionResult
from app.detectors.gather_scatter import _activity_batches
from app.queries import GET_PATTERN_TRANSACTION_EDGES

FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


def load_fixture(name):
    with open(os.path.join(FIXTURES_DIR, name), encoding="utf-8") as fixture_file:
        return json.load(fixture_file)


def populate_graph(db, graph_name, fixture):
    accounts = [{"id": account["id"], "type": account.get("type", "personal"), "community": 1}
                for account in fixture["accounts"]]
    db.execute_query(
        graph_name,
        "UNWIND $rows AS r MERGE (a:Account {id:r.id}) SET a.type=r.type, a.community=r.community",
        {"rows": accounts}, caller="test:graph_pattern_accounts",
    )
    transactions = [{
        "tx_id": tx["tx_id"], "src": tx["src"], "dst": tx["dst"],
        "amount": tx["amount"], "ts": tx["ts"], "step": 1,
        "tx_type": tx.get("tx_type", "UPI"),
    } for tx in fixture["transactions"]]
    db.execute_query(
        graph_name,
        "UNWIND $rows AS r MATCH (s:Account {id:r.src}), (d:Account {id:r.dst}) "
        "MERGE (s)-[t:SENT {tx_id:r.tx_id}]->(d) "
        "SET t.amount=r.amount, t.ts=r.ts, t.step=r.step, t.tx_type=r.tx_type",
        {"rows": transactions}, caller="test:graph_pattern_transactions",
    )


class TestGraphPatternDetectors(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = FalkorDBClient()

    def _run_fixture(self, fixture_name, detector, **kwargs):
        graph_name = f"test_pattern_{uuid.uuid4().hex[:12]}"
        fixture = load_fixture(fixture_name)
        try:
            populate_graph(self.db, graph_name, fixture)
            return detector(graph_name=graph_name, db=self.db, **kwargs)
        finally:
            self.db.delete_graph(graph_name, caller="test:graph_pattern_cleanup")

    def test_relay_chain_positive_and_bad_delay_or_retention_negative(self):
        hits = self._run_fixture("relay_chain_positive.json", detect_relay_chains)
        self.assertTrue(hits)
        hit = next(item for item in hits if item["measurements"]["hop_count"] == 3)
        self.assertEqual(hit["account_ids"], ["R0", "R1", "R2", "R3"])
        self.assertTrue(hit["measurements"]["suspicious"])
        self.assertIn(hit["tx_ids"][0], {"R_AB_1", "R_AB_2"})
        self.assertEqual(hit["tx_ids"][1:], ["R_BC", "R_CD"])
        self.assertFalse(self._run_fixture("relay_chain_negative.json", detect_relay_chains))

    def test_scatter_gather_requires_same_source_and_sink(self):
        hits = self._run_fixture("scatter_gather_positive.json", detect_scatter_gather)
        self.assertEqual(len(hits), 1)
        hit = hits[0]
        self.assertEqual(hit["measurements"]["intermediary_count"], 3)
        self.assertEqual(hit["account_roles"]["S"], "source")
        self.assertEqual(hit["account_roles"]["T"], "sink")
        self.assertEqual(len(hit["tx_ids"]), 6)
        self.assertTrue(hit["measurements"]["suspicious"])
        self.assertFalse(self._run_fixture("scatter_gather_negative.json", detect_scatter_gather))

    def test_scatter_gather_keeps_separated_observation_episodes_distinct(self):
        rows = []
        for episode, start in (("A", 100), ("B", 400_000)):
            for intermediary, offset in (("I1", 0), ("I2", 10)):
                rows.extend([
                    [f"{episode}_{intermediary}_IN", "S", intermediary, 1000.0, start + offset, 1, "UPI"],
                    [f"{episode}_{intermediary}_OUT", intermediary, "T", 900.0, start + offset + 100, 1, "UPI"],
                ])
        fake_db = MagicMock()
        fake_db.execute_query.return_value = SimpleNamespace(result_set=rows)
        hits = detect_scatter_gather(min_intermediaries=2, db=fake_db)
        self.assertEqual(len(hits), 2)
        self.assertTrue(all(hit["measurements"]["intermediary_count"] == 2 for hit in hits))

    def test_gather_scatter_requires_minimum_on_both_sides_and_preserves_parallel_edges(self):
        hits = self._run_fixture(
            "gather_scatter_positive.json", detect_gather_scatter,
            min_incoming_counterparties=3, min_outgoing_counterparties=3,
        )
        self.assertEqual(len(hits), 1)
        hit = hits[0]
        self.assertEqual(hit["measurements"]["distinct_incoming_counterparties"], 3)
        self.assertEqual(hit["measurements"]["incoming_tx_count"], 4)
        self.assertIn("GS_IN1B", hit["tx_ids"])
        self.assertTrue(hit["measurements"]["balance_ratio_is_not_fund_attribution"])
        self.assertTrue(hit["measurements"]["suspicious"] is False)
        self.assertFalse(self._run_fixture("gather_scatter_negative.json", detect_gather_scatter))

    def test_stable_hit_ids_for_identical_edge_read(self):
        fixture = load_fixture("scatter_gather_positive.json")
        raw_rows = [[tx["tx_id"], tx["src"], tx["dst"], tx["amount"], tx["ts"], 1, "UPI"]
                    for tx in fixture["transactions"]]
        fake_db = MagicMock()
        fake_db.execute_query.return_value = SimpleNamespace(result_set=raw_rows)
        first = detect_scatter_gather(db=fake_db)
        second = detect_scatter_gather(db=fake_db)
        self.assertEqual([hit["hit_id"] for hit in first], [hit["hit_id"] for hit in second])
        self.assertIn("LIMIT $limit", GET_PATTERN_TRANSACTION_EDGES)

    def test_read_cap_and_database_failure_are_visible(self):
        fake_db = MagicMock()
        fake_db.execute_query.return_value = SimpleNamespace(result_set=[
            ["T1", "A", "B", 100.0, 100, 1, "UPI"],
            ["T2", "B", "C", 95.0, 200, 1, "UPI"],
        ])
        capped = detect_relay_chains(min_hops=3, max_hops=3, max_edges=1, db=fake_db)
        self.assertTrue(capped.truncated)
        self.assertIn("edge_read_limit", capped.truncation_reasons)
        fake_db.execute_query.side_effect = TimeoutError("query timed out")
        with self.assertRaisesRegex(TimeoutError, "timed out"):
            detect_gather_scatter(db=fake_db)

    def test_search_budget_and_invalid_rows_are_reported(self):
        fixture = load_fixture("relay_chain_positive.json")
        rows = [[tx["tx_id"], tx["src"], tx["dst"], tx["amount"], tx["ts"], 1, "UPI"]
                for tx in fixture["transactions"]]
        fake_db = MagicMock()
        fake_db.execute_query.return_value = SimpleNamespace(result_set=rows)
        limited = detect_relay_chains(max_search_steps=1, db=fake_db)
        self.assertTrue(limited.truncated)
        self.assertIn("search_budget", limited.truncation_reasons)
        fake_db.execute_query.return_value = SimpleNamespace(result_set=[
            ["BAD", "A", "B", "not-a-number", 100, 1, "UPI"],
        ])
        malformed = detect_scatter_gather(db=fake_db)
        self.assertTrue(malformed.truncated)
        self.assertEqual(malformed.invalid_rows_skipped, 1)
        self.assertIn("invalid_transaction_rows", malformed.truncation_reasons)

    def test_relay_and_scatter_time_window_boundaries_are_inclusive(self):
        relay_rows = [
            ["T1", "A", "B", 1000.0, 100, 1, "UPI"],
            ["T2", "B", "C", 950.0, 460, 1, "UPI"],
            ["T3", "C", "D", 900.0, 820, 1, "UPI"],
        ]
        fake_db = MagicMock()
        fake_db.execute_query.return_value = SimpleNamespace(result_set=relay_rows)
        self.assertTrue(detect_relay_chains(min_hops=3, max_hops=3, max_gap_seconds=360, db=fake_db))
        relay_rows[-1] = ["T3", "C", "D", 900.0, 821, 1, "UPI"]
        self.assertFalse(detect_relay_chains(min_hops=3, max_hops=3, max_gap_seconds=360, db=fake_db))

        scatter_rows = [
            ["S1", "S", "I1", 1000.0, 100, 1, "UPI"], ["S2", "I1", "T", 900.0, 1100, 1, "UPI"],
            ["S3", "S", "I2", 1000.0, 120, 1, "UPI"], ["S4", "I2", "T", 900.0, 1120, 1, "UPI"],
        ]
        fake_db.execute_query.return_value = SimpleNamespace(result_set=scatter_rows)
        self.assertTrue(detect_scatter_gather(min_intermediaries=2, max_path_gap_seconds=1000, db=fake_db))
        self.assertFalse(detect_scatter_gather(min_intermediaries=2, max_path_gap_seconds=999, db=fake_db))

    def test_gather_scatter_activity_gap_boundary_is_inclusive(self):
        events = [
            {"tx_id": "T1", "src": "S1", "dst": "H", "ts": 0},
            {"tx_id": "T2", "src": "S2", "dst": "H", "ts": 100},
        ]
        self.assertEqual(len(_activity_batches(events, "src", 2, 100, 200)), 1)
        outside = [dict(events[0]), dict(events[1], ts=101)]
        self.assertEqual(_activity_batches(outside, "src", 2, 100, 200), [])

    def test_wrong_direction_does_not_form_scatter_gather(self):
        rows = [
            ["T1", "I1", "S", 1000.0, 100, 1, "UPI"],
            ["T2", "T", "I1", 900.0, 200, 1, "UPI"],
            ["T3", "I2", "S", 1000.0, 100, 1, "UPI"],
            ["T4", "T", "I2", 900.0, 200, 1, "UPI"],
        ]
        fake_db = MagicMock()
        fake_db.execute_query.return_value = SimpleNamespace(result_set=rows)
        self.assertEqual(detect_scatter_gather(min_intermediaries=2, db=fake_db), [])

    def test_all_new_pattern_routes_are_additive_and_return_traceable_hits(self):
        with patch("app.db.FalkorDBClient"):
            from app import main
        from fastapi.testclient import TestClient

        fixture_hit = {
            "hit_id": "HIT_route_fixture", "pattern": "relay_chain",
            "account_ids": ["A", "B", "C", "D"], "account_roles": {"A": "origin"},
            "tx_ids": ["T1", "T2", "T3"],
            "measurements": {"suspicious": True},
            "explanation": "Directed fixture evidence.",
        }
        result = PatternDetectionResult([fixture_hit])
        for path, detector_name in (
            ("/api/detectors/relay-chain", "detect_relay_chains"),
            ("/api/detectors/scatter-gather", "detect_scatter_gather"),
            ("/api/detectors/gather-scatter", "detect_gather_scatter"),
            ("/api/v1/detectors/relay-chain", "detect_relay_chains"),
            ("/api/v1/detectors/scatter-gather", "detect_scatter_gather"),
            ("/api/v1/detectors/gather-scatter", "detect_gather_scatter"),
        ):
            with patch.object(main, detector_name, return_value=result):
                response = TestClient(main.app).get(path)
            self.assertEqual(response.status_code, 200, path)
            body = response.json()
            self.assertIn("execution_time_ms", body)
            self.assertIn("truncation_reasons", body)
            self.assertEqual(body["hits"][0]["tx_ids"], ["T1", "T2", "T3"])


if __name__ == "__main__":
    unittest.main()
