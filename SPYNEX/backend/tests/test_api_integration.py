"""Phase 4: Scan and API Integration Tests — RingTrace Member A.

Verifies end-to-end integration of the registered detector registry, scan pipeline,
case grouping, scoring, memory-graph persistence, and Member A API endpoints.
Tests run against isolated test graphs (test_txn_<uuid>, test_mem_<uuid>) and clean up thoroughly.
"""
import base64
import json
import os
import sys
import unittest
import uuid
from unittest.mock import patch

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(TESTS_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from fastapi.testclient import TestClient
from app.main import app
from app.db import FalkorDBClient
from app.queries import MERGE_ACCOUNTS, MERGE_TRANSACTIONS
from app.detectors.graph_pattern_utils import PatternDetectionResult
from app import scan_service


def make_test_hit(hit_id: str, pattern: str, accounts: list, tx_ids: list, amount: float = 25000.0, ts: int = 1700000000):
    txs = [{"tx_id": tid, "src": accounts[i % len(accounts)], "dst": accounts[(i + 1) % len(accounts)],
            "amount": amount, "ts": ts + i * 3600, "step": 1, "tx_type": "UPI"} for i, tid in enumerate(tx_ids)]
    return {
        "hit_id": hit_id, "pattern": pattern, "account_ids": list(accounts),
        "account_roles": {accounts[0]: "origin", accounts[-1]: "sink"},
        "tx_ids": list(tx_ids), "transactions": txs,
        "measurements": {"suspicious": True, "amount": amount, "confidence": 0.9},
        "explanation": f"Test {pattern} hit for integration",
    }


class TestAPIIntegration(unittest.TestCase):
    """Phase 4 API integration test suite covering all contract and pipeline specifications."""

    def setUp(self):
        self.db = FalkorDBClient()
        self.txn_graph = f"test_api_txn_{uuid.uuid4().hex[:10]}"
        self.memory_graph = f"test_api_mem_{uuid.uuid4().hex[:10]}"
        self.client = TestClient(app)

        # Configure app state to use isolated graphs for this test run
        self.prev_db = app.state.db_client
        self.prev_graph = app.state.graph_name
        app.state.db_client = self.db
        app.state.graph_name = self.txn_graph
        self.env_patch = patch.dict(os.environ, {"FALKORDB_MEMORY_GRAPH": self.memory_graph})
        self.env_patch.start()

    def tearDown(self):
        self.env_patch.stop()
        app.state.db_client = self.prev_db
        app.state.graph_name = self.prev_graph
        try:
            self.db.delete_graph(self.txn_graph, caller="test:api_cleanup")
        except Exception:
            pass
        try:
            self.db.delete_graph(self.memory_graph, caller="test:api_cleanup")
        except Exception:
            pass

    def _seed_test_graph(self):
        """Seed minimal valid accounts and transactions into isolated txn graph."""
        accounts = [
            {"id": "ACC_A", "type": "personal", "community": 1},
            {"id": "ACC_B", "type": "personal", "community": 1},
            {"id": "ACC_C", "type": "merchant", "community": 1},
        ]
        txs = [
            {"tx_id": "TX_01", "src": "ACC_A", "dst": "ACC_B", "amount": 48000.0, "ts": 1700000000, "step": 1, "tx_type": "UPI"},
            {"tx_id": "TX_02", "src": "ACC_B", "dst": "ACC_A", "amount": 45000.0, "ts": 1700003600, "step": 1, "tx_type": "UPI"},
        ]
        self.db.execute_query(self.txn_graph, MERGE_ACCOUNTS, {"rows": accounts}, caller="test:seed_accounts")
        self.db.execute_query(self.txn_graph, MERGE_TRANSACTIONS, {"rows": txs}, caller="test:seed_transactions")

    def test_01_scan_invokes_registry_and_case_pipeline(self):
        """Requirement 1: The scan invokes registered detectors, groups hits, scores, and persists cases."""
        self._seed_test_graph()
        hit1 = make_test_hit("HIT_CYC_1", "cycle", ["ACC_A", "ACC_B"], ["TX_01", "TX_02"])

        def mock_cycle_detector(limit, graph_name, db, edge_snapshot):
            return PatternDetectionResult([hit1], edges_scanned=2)

        with patch.object(scan_service, "DETECTOR_REGISTRY", (("cycle", mock_cycle_detector),)):
            # Execute scan via service
            scan_id = scan_service.create_scan_job()
            scan_service.run_scan(scan_id, self.db, self.txn_graph, self.memory_graph)
            status = scan_service.get_scan_job(scan_id)

            self.assertEqual(status["status"], "complete")
            self.assertEqual(status["hit_count"], 1)
            self.assertEqual(status["case_count"], 1)
            self.assertIn("cycle", status["detector_reports"])

            # Verify case was persisted in isolated memory graph
            cases_resp = self.client.get("/api/v1/cases")
            self.assertEqual(cases_resp.status_code, 200)
            items = cases_resp.json()["items"]
            self.assertEqual(len(items), 1)
            self.assertTrue(items[0]["case_id"].startswith("CASE_"))
            self.assertEqual(items[0]["patterns"], ["cycle"])

    def test_02_scan_response_matches_contract_example(self):
        """Requirement 2: POST /api/v1/scan returns HTTP 202 with { scan_id, status: 'running' }."""
        resp = self.client.post("/api/v1/scan")
        self.assertEqual(resp.status_code, 202)
        body = resp.json()
        self.assertIn("scan_id", body)
        self.assertTrue(body["scan_id"].startswith("SCAN_"))
        self.assertEqual(body["status"], "running")

        # Verify job status lookup
        status_resp = self.client.get(f"/api/v1/scan/{body['scan_id']}")
        self.assertEqual(status_resp.status_code, 200)
        self.assertEqual(status_resp.json()["scan_id"], body["scan_id"])

    def test_03_repeated_scans_do_not_create_duplicate_cases(self):
        """Requirement 3: Repeated scans over the same evidence do not duplicate cases or hits."""
        self._seed_test_graph()
        hit1 = make_test_hit("HIT_IDEM_1", "cycle", ["ACC_A", "ACC_B"], ["TX_01", "TX_02"])

        def mock_detector(limit, graph_name, db, edge_snapshot):
            return PatternDetectionResult([hit1], edges_scanned=2)

        with patch.object(scan_service, "DETECTOR_REGISTRY", (("cycle", mock_detector),)):
            # Run scan twice
            s1 = scan_service.create_scan_job()
            scan_service.run_scan(s1, self.db, self.txn_graph, self.memory_graph)
            s2 = scan_service.create_scan_job()
            scan_service.run_scan(s2, self.db, self.txn_graph, self.memory_graph)

            # Query API
            resp = self.client.get("/api/v1/cases")
            self.assertEqual(resp.status_code, 200)
            items = resp.json()["items"]
            self.assertEqual(len(items), 1, "Idempotent persistence must not duplicate cases on repeated scans.")

    def test_04_case_listing_returns_expected_summaries_and_filters(self):
        """Requirement 4: Case listing honors status, severity, pattern, and sort filters."""
        # Manually persist two cases in isolated memory graph
        from app.cases.builder import build_cases, persist_cases
        hit_high = make_test_hit("H_HIGH", "cycle", ["ACC_1", "ACC_2"], ["TX_H1"], amount=100000.0)
        hit_med = make_test_hit("H_MED", "relay_chain", ["ACC_3", "ACC_4"], ["TX_M1"], amount=10000.0)

        built = build_cases([hit_high, hit_med])
        persist_cases(built["cases"], db=self.db, graph_name=self.memory_graph)

        # 1. Unfiltered listing
        all_cases = self.client.get("/api/v1/cases").json()["items"]
        self.assertEqual(len(all_cases), 2)

        # 2. Pattern filter
        cycle_only = self.client.get("/api/v1/cases?pattern=cycle").json()["items"]
        self.assertEqual(len(cycle_only), 1)
        self.assertEqual(cycle_only[0]["patterns"], ["cycle"])

        relay_only = self.client.get("/api/v1/cases?pattern=relay_chain").json()["items"]
        self.assertEqual(len(relay_only), 1)
        self.assertEqual(relay_only[0]["patterns"], ["relay_chain"])

        # 3. Status filter
        open_cases = self.client.get("/api/v1/cases?status=open").json()["items"]
        self.assertEqual(len(open_cases), 2)
        dismissed = self.client.get("/api/v1/cases?status=dismissed").json()["items"]
        self.assertEqual(len(dismissed), 0)

        # 4. Sort by score (default) vs updated_at
        by_score = self.client.get("/api/v1/cases?sort=score").json()["items"]
        self.assertGreaterEqual(by_score[0]["score"], by_score[1]["score"])

        by_updated = self.client.get("/api/v1/cases?sort=updated_at")
        self.assertEqual(by_updated.status_code, 200)

    def test_05_case_details_contain_hits_transactions_and_breakdowns(self):
        """Requirement 5: Case details endpoint returns hits, transactions, decisions, and score_breakdown."""
        from app.cases.builder import build_cases, persist_cases
        hit = make_test_hit("H_DET_1", "cycle", ["ACC_X", "ACC_Y"], ["TX_D1"], amount=35000.0)
        case = build_cases([hit])["cases"][0]
        persist_cases([case], db=self.db, graph_name=self.memory_graph)

        resp = self.client.get(f"/api/v1/cases/{case['case_id']}")
        self.assertEqual(resp.status_code, 200)
        detail = resp.json()

        # Contract summary fields
        self.assertEqual(detail["case_id"], case["case_id"])
        self.assertEqual(detail["status"], "open")
        self.assertIn("score", detail)
        self.assertIn("severity", detail)

        # Hits list
        self.assertEqual(len(detail["hits"]), 1)
        self.assertEqual(detail["hits"][0]["hit_id"], "H_DET_1")
        self.assertEqual(detail["hits"][0]["pattern"], "cycle")
        self.assertIn("measurements", detail["hits"][0])

        # Transactions list
        self.assertEqual(len(detail["transactions"]), 1)
        self.assertEqual(detail["transactions"][0]["tx_id"], "TX_D1")

        # Score breakdown
        self.assertIn("score_breakdown", detail)
        sb = detail["score_breakdown"]
        for key in ("severity", "amount", "velocity", "account_count", "corroboration", "total"):
            self.assertIn(key, sb)
        self.assertEqual(sb["total"], detail["score"])

        # Decisions list
        self.assertIsInstance(detail["decisions"], list)

    def test_06_graph_endpoints_return_nodes_and_unmerged_edges(self):
        """Requirement 6: Case graph returns individual transaction edges and role-annotated nodes."""
        from app.cases.builder import build_cases, persist_cases
        hit = make_test_hit("H_GRAPH_1", "cycle", ["ACC_G1", "ACC_G2"], ["TX_G1", "TX_G2"])
        case = build_cases([hit])["cases"][0]
        persist_cases([case], db=self.db, graph_name=self.memory_graph)

        resp = self.client.get(f"/api/v1/cases/{case['case_id']}/graph")
        self.assertEqual(resp.status_code, 200)
        graph_data = resp.json()

        # Check nodes
        node_ids = {n["id"] for n in graph_data["nodes"]}
        self.assertEqual(node_ids, {"ACC_G1", "ACC_G2"})
        for node in graph_data["nodes"]:
            self.assertIn("roles", node)
            self.assertTrue(node["in_case"])

        # Check unmerged edges (one edge per transaction)
        edge_tx_ids = {e["tx_id"] for e in graph_data["edges"]}
        self.assertEqual(edge_tx_ids, {"TX_G1", "TX_G2"})
        for edge in graph_data["edges"]:
            for prop in ("tx_id", "source", "target", "amount", "ts"):
                self.assertIn(prop, edge)

    def test_07_unknown_case_id_returns_established_error_format(self):
        """Requirement 7: Unknown case IDs return 404 with exact contract error shape."""
        expected_error = {
            "error": {
                "code": "not_found",
                "message": "Case not found",
                "details": {},
            }
        }
        resp = self.client.get("/api/v1/cases/CASE_UNKNOWN_999999")
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json(), expected_error)

        # Also verify /graph on non-existent case returns the identical error envelope
        graph_resp = self.client.get("/api/v1/cases/CASE_UNKNOWN_999999/graph")
        self.assertEqual(graph_resp.status_code, 404)
        self.assertEqual(graph_resp.json(), expected_error)

    def test_08_empty_detection_results_return_valid_responses(self):
        """Requirement 8: Empty detection results and empty graph produce valid zero-state responses."""
        # 1. Summary on empty graph
        summary_resp = self.client.get("/api/v1/graph/summary")
        self.assertEqual(summary_resp.status_code, 200)
        summary = summary_resp.json()
        self.assertEqual(summary["case_count"], 0)
        self.assertEqual(summary["cases_by_pattern"], {})

        # 2. Case list on empty graph
        cases_resp = self.client.get("/api/v1/cases")
        self.assertEqual(cases_resp.status_code, 200)
        self.assertEqual(cases_resp.json(), {"items": [], "next_cursor": None})

        # 3. Scan with zero hits
        def mock_empty_detector(limit, graph_name, db, edge_snapshot):
            return PatternDetectionResult([], edges_scanned=0)

        with patch.object(scan_service, "DETECTOR_REGISTRY", (("cycle", mock_empty_detector),)):
            scan_id = scan_service.create_scan_job()
            scan_service.run_scan(scan_id, self.db, self.txn_graph, self.memory_graph)
            status = scan_service.get_scan_job(scan_id)
            self.assertEqual(status["status"], "complete")
            self.assertEqual(status["hit_count"], 0)
            self.assertEqual(status["case_count"], 0)

    def test_09_pagination_respects_limits_and_cursors(self):
        """Requirement 9: Pagination respects default 50, max 200, cursor advancement, and validates bounds."""
        # Reject limits out of bounds
        self.assertEqual(self.client.get("/api/v1/cases?limit=0").status_code, 422)
        self.assertEqual(self.client.get("/api/v1/cases?limit=201").status_code, 422)

        # Accept max limit
        self.assertEqual(self.client.get("/api/v1/cases?limit=200").status_code, 200)

        # Invalid cursor returns HTTP 400
        bad_cursor_resp = self.client.get("/api/v1/cases?cursor=not-valid-base64-!")
        self.assertEqual(bad_cursor_resp.status_code, 400)
        self.assertEqual(bad_cursor_resp.json()["error"]["code"], "invalid_cursor")

        # Test cursor navigation across multiple items
        from app.cases.builder import build_cases, persist_cases
        hits = [make_test_hit(f"H_PAGE_{i}", "cycle", [f"ACC_P_{i}", f"ACC_Q_{i}"], [f"TX_P_{i}"]) for i in range(5)]
        cases = build_cases(hits)["cases"]
        persist_cases(cases, db=self.db, graph_name=self.memory_graph)

        # Fetch page 1 (limit=2)
        page1 = self.client.get("/api/v1/cases?limit=2").json()
        self.assertEqual(len(page1["items"]), 2)
        self.assertIsNotNone(page1["next_cursor"])

        # Fetch page 2 using cursor
        page2 = self.client.get(f"/api/v1/cases?limit=2&cursor={page1['next_cursor']}").json()
        self.assertEqual(len(page2["items"]), 2)
        self.assertNotEqual(page1["items"][0]["case_id"], page2["items"][0]["case_id"])

    def test_10_hashed_case_ids_resolve_correctly_through_all_endpoints(self):
        """Requirement 10: Deterministic CASE_{hash} IDs resolve properly through all case endpoints."""
        from app.cases.builder import build_cases, persist_cases
        hit = make_test_hit("HIT_HASH_01", "fan_in", ["ACC_HASH_1", "ACC_HASH_2"], ["TX_HASH_01"])
        case = build_cases([hit])["cases"][0]
        case_id = case["case_id"]

        # Confirm ID format: CASE_ + 12 hex characters
        self.assertTrue(case_id.startswith("CASE_"))
        self.assertEqual(len(case_id), 17)  # 'CASE_' (5) + 12 = 17

        persist_cases([case], db=self.db, graph_name=self.memory_graph)

        # Resolve through GET /cases/{id}
        detail_resp = self.client.get(f"/api/v1/cases/{case_id}")
        self.assertEqual(detail_resp.status_code, 200)
        self.assertEqual(detail_resp.json()["case_id"], case_id)

        # Resolve through GET /cases/{id}/graph
        graph_resp = self.client.get(f"/api/v1/cases/{case_id}/graph")
        self.assertEqual(graph_resp.status_code, 200)

    def test_11_legacy_routes_and_account_endpoints_remain_compatible(self):
        """Requirement 11: Legacy /api/... aliases and account endpoints function identically."""
        self._seed_test_graph()

        # Legacy /api/health and /api/v1/health
        h1 = self.client.get("/api/health")
        h2 = self.client.get("/api/v1/health")
        self.assertEqual(h1.status_code, 200)
        self.assertEqual(h2.status_code, 200)
        self.assertEqual(h1.json()["status"], h2.json()["status"])

        # Legacy /api/graph/summary and /api/v1/graph/summary
        s1 = self.client.get("/api/graph/summary")
        s2 = self.client.get("/api/v1/graph/summary")
        self.assertEqual(s1.status_code, 200)
        self.assertEqual(s2.status_code, 200)

        # Account profile endpoint
        acc_resp = self.client.get("/api/v1/accounts/ACC_A")
        self.assertEqual(acc_resp.status_code, 200)
        acc_data = acc_resp.json()
        self.assertEqual(acc_data["account"]["id"], "ACC_A")
        self.assertIn("incoming", acc_data)
        self.assertIn("outgoing", acc_data)

        # Account neighborhood endpoint
        neigh_resp = self.client.get("/api/v1/accounts/ACC_A/neighborhood?hops=1")
        self.assertEqual(neigh_resp.status_code, 200)
        self.assertIn("nodes", neigh_resp.json())
        self.assertIn("edges", neigh_resp.json())


if __name__ == "__main__":
    unittest.main()
