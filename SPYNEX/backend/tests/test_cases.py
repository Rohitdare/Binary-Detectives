"""Case grouping, scoring, and isolated memory-graph persistence tests."""
import os
import sys
import unittest
import uuid
from unittest.mock import patch

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(TESTS_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.cases.builder import build_cases, persist_cases
from app.cases.scorer import score_case
from app.db import FalkorDBClient
from app.queries import GET_CASE_BY_ID, GET_CASE_HITS, MERGE_ACCOUNTS, MERGE_TRANSACTIONS
from app.detectors.graph_pattern_utils import PatternDetectionResult
from app import scan_service


def hit(hit_id, pattern, accounts, tx_id, ts=100, amount=10000):
    return {"hit_id": hit_id, "pattern": pattern, "account_ids": accounts,
            "account_roles": {accounts[0]: "origin"}, "tx_ids": [tx_id],
            "transactions": [{"tx_id": tx_id, "src": accounts[0], "dst": accounts[-1],
                              "amount": amount, "ts": ts}],
            "measurements": {"suspicious": True}}


class TestCases(unittest.TestCase):
    def test_groups_shared_accounts_and_splits_large_components(self):
        hits = [hit("H1", "cycle", ["A", "B"], "T1"),
                hit("H2", "relay_chain", ["B", "C"], "T2", 200),
                hit("H3", "fan_in", ["X", "Y"], "T3"),
                hit("H4", "hub_account", ["B", "Z"], "T4")]
        built = build_cases(hits)
        self.assertEqual(len(built["cases"]), 2)
        connected = next(case for case in built["cases"] if "A" in case["account_ids"])
        self.assertEqual(set(connected["patterns"]), {"cycle", "relay_chain", "hub_account"})
        self.assertEqual(connected["score_breakdown"]["corroboration"], 15)
        self.assertTrue(all(case["account_count"] <= 60 for case in built["cases"]))

    def test_hub_signal_never_creates_a_case_by_itself(self):
        built = build_cases([hit("H", "hub_account", ["A", "B"], "T")])
        self.assertEqual(built["cases"], [])
        self.assertEqual(built["non_case_generating_hit_ids"], ["H"])

    def test_business_origin_reduces_severity_and_score_is_bounded(self):
        data = hit("H", "relay_chain", ["A", "B"], "T", amount=1e15)
        score = score_case([data], data["transactions"], 2, {"A": "payroll"})
        self.assertEqual(score["severity"], 22)
        self.assertLessEqual(score["total"], 100)
        self.assertEqual(score["score_type"], "triage_priority_not_probability")

    def test_memory_graph_upsert_is_idempotent(self):
        db = FalkorDBClient()
        graph = f"test_case_{uuid.uuid4().hex[:12]}"
        try:
            case = build_cases([hit("HIT1", "cycle", ["A", "B"], "TX1")])["cases"][0]
            self.assertEqual(persist_cases([case], db=db, graph_name=graph), 1)
            persist_cases([case], db=db, graph_name=graph)
            result = db.execute_query(graph, GET_CASE_BY_ID, {"case_id": case["case_id"]}, caller="test:case_read")
            self.assertEqual(len(result.result_set), 1)
            hits = db.execute_query(graph, GET_CASE_HITS, {"case_id": case["case_id"]}, caller="test:case_hits")
            self.assertEqual(len(hits.result_set), 1)
            from fastapi.testclient import TestClient
            from app.main import app
            previous_db, previous_graph = app.state.db_client, app.state.graph_name
            app.state.db_client, app.state.graph_name = db, "test_empty_txn_graph"
            with patch.dict(os.environ, {"FALKORDB_MEMORY_GRAPH": graph}):
                client = TestClient(app)
                listing = client.get("/api/v1/cases?limit=5")
                detail = client.get(f"/api/v1/cases/{case['case_id']}")
                evidence_graph = client.get(f"/api/v1/cases/{case['case_id']}/graph")
            app.state.db_client, app.state.graph_name = previous_db, previous_graph
            self.assertEqual(listing.status_code, 200)
            self.assertEqual(listing.json()["items"][0]["case_id"], case["case_id"])
            self.assertEqual(detail.status_code, 200)
            self.assertEqual(detail.json()["hits"][0]["hit_id"], "HIT1")
            self.assertEqual(evidence_graph.status_code, 200)
            self.assertEqual({edge["tx_id"] for edge in evidence_graph.json()["edges"]}, {"TX1"})
        finally:
            db.delete_graph(graph, caller="test:case_cleanup")

    def test_scan_registry_runs_end_to_end_on_isolated_graphs(self):
        db = FalkorDBClient()
        txn_graph = f"test_scan_{uuid.uuid4().hex[:10]}"
        memory_graph = f"test_memory_{uuid.uuid4().hex[:10]}"
        accounts = [{"id": "S", "type": "personal", "community": 1},
                    {"id": "T", "type": "personal", "community": 1}]
        tx = {"tx_id": "SCAN_TX", "src": "S", "dst": "T", "amount": 10_000.0,
              "ts": 1_700_000_000, "step": 1, "tx_type": "UPI"}
        db.execute_query(txn_graph, MERGE_ACCOUNTS, {"rows": accounts}, caller="test:scan_accounts")
        db.execute_query(txn_graph, MERGE_TRANSACTIONS, {"rows": [tx]}, caller="test:scan_tx")
        test_hit = hit("SCAN_HIT", "relay_chain", ["S", "T"], "SCAN_TX", tx["ts"], tx["amount"])

        def fixture_detector(limit, graph_name, db, edge_snapshot):
            self.assertEqual(graph_name, txn_graph)
            self.assertEqual(len(edge_snapshot[0]), 1)
            return PatternDetectionResult([test_hit], edges_scanned=1)

        try:
            scan_id = scan_service.create_scan_job()
            with patch.object(scan_service, "DETECTOR_REGISTRY", (("relay_chain", fixture_detector),)):
                scan_service.run_scan(scan_id, db, txn_graph, memory_graph)
            result = scan_service.get_scan_job(scan_id)
            self.assertEqual(result["status"], "complete")
            self.assertEqual(result["hit_count"], 1)
            self.assertEqual(result["case_count"], 1)
        finally:
            db.delete_graph(txn_graph, caller="test:scan_cleanup")
            db.delete_graph(memory_graph, caller="test:scan_cleanup")


if __name__ == "__main__":
    unittest.main()
