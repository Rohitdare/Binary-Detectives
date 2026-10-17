"""End-to-End Regression Test for Phase 5 Frontend & API Integration."""
import unittest
import uuid
import os
import time
from fastapi.testclient import TestClient

from app.main import app
from app.db import FalkorDBClient
from app.queries import MERGE_ACCOUNTS, MERGE_TRANSACTIONS


class TestEndToEndCaseWorkflow(unittest.TestCase):
    """Verifies the complete end-to-end workflow required by Phase 5."""

    @classmethod
    def setUpClass(cls):
        cls.db = FalkorDBClient()
        cls.test_id = uuid.uuid4().hex[:8]
        cls.txn_graph = f"test_e2e_txn_{cls.test_id}"
        cls.memory_graph = f"test_e2e_mem_{cls.test_id}"

        # Seed isolated test transaction graph with a 3-hop cycle and a 3-hop fan-out
        accounts = [
            {"id": "ACC_A", "type": "personal", "community": 1},
            {"id": "ACC_B", "type": "personal", "community": 1},
            {"id": "ACC_C", "type": "personal", "community": 1},
            {"id": "ACC_D", "type": "personal", "community": 2},
            {"id": "ACC_E", "type": "personal", "community": 2},
        ]
        txs = [
            # Cycle A -> B -> C -> A
            {"tx_id": "TX_C1", "src": "ACC_A", "dst": "ACC_B", "amount": 50000.0, "ts": 1700000000, "step": 1, "tx_type": "UPI"},
            {"tx_id": "TX_C2", "src": "ACC_B", "dst": "ACC_C", "amount": 49000.0, "ts": 1700003600, "step": 1, "tx_type": "UPI"},
            {"tx_id": "TX_C3", "src": "ACC_C", "dst": "ACC_A", "amount": 48000.0, "ts": 1700007200, "step": 1, "tx_type": "UPI"},
            # Dispersal from C -> D, C -> E
            {"tx_id": "TX_D1", "src": "ACC_C", "dst": "ACC_D", "amount": 10000.0, "ts": 1700010000, "step": 2, "tx_type": "UPI"},
            {"tx_id": "TX_D2", "src": "ACC_C", "dst": "ACC_E", "amount": 10000.0, "ts": 1700010500, "step": 2, "tx_type": "UPI"},
        ]
        cls.db.execute_query(cls.txn_graph, MERGE_ACCOUNTS, {"rows": accounts}, caller="test:e2e_seed")
        cls.db.execute_query(cls.txn_graph, MERGE_TRANSACTIONS, {"rows": txs}, caller="test:e2e_seed")

        # Point app to test graphs
        cls.previous_graph = getattr(app.state, "graph_name", "txn")
        cls.previous_db = getattr(app.state, "db_client", None)
        cls.previous_mem_env = os.environ.get("FALKORDB_MEMORY_GRAPH")
        app.state.graph_name = cls.txn_graph
        app.state.db_client = cls.db
        os.environ["FALKORDB_MEMORY_GRAPH"] = cls.memory_graph

        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        app.state.graph_name = cls.previous_graph
        app.state.db_client = cls.previous_db
        if cls.previous_mem_env:
            os.environ["FALKORDB_MEMORY_GRAPH"] = cls.previous_mem_env
        else:
            os.environ.pop("FALKORDB_MEMORY_GRAPH", None)
        cls.db.delete_graph(cls.txn_graph, caller="test:e2e_cleanup")
        cls.db.delete_graph(cls.memory_graph, caller="test:e2e_cleanup")

    def test_01_full_lifecycle_scan_to_case_selection(self):
        """Step 1-6: Trigger scan, verify 202, poll completion, list cases, fetch detail, and inspect graph."""
        # 1. Trigger scan
        scan_resp = self.client.post("/api/v1/scan")
        self.assertEqual(scan_resp.status_code, 202)
        scan_data = scan_resp.json()
        self.assertIn("scan_id", scan_data)
        self.assertEqual(scan_data["status"], "running")
        scan_id = scan_data["scan_id"]

        # 2. Wait for completion
        for _ in range(30):
            status_resp = self.client.get(f"/api/v1/scan/{scan_id}")
            self.assertEqual(status_resp.status_code, 200)
            if status_resp.json()["status"] in ("complete", "completed", "partial"):
                break
            time.sleep(0.1)

        completed_job = self.client.get(f"/api/v1/scan/{scan_id}").json()
        self.assertIn(completed_job["status"], ("complete", "completed", "partial"))
        self.assertGreaterEqual(completed_job["hit_count"], 1)
        self.assertGreaterEqual(completed_job["case_count"], 1)

        # 3. List cases through /api/v1/cases
        cases_resp = self.client.get("/api/v1/cases")
        self.assertEqual(cases_resp.status_code, 200)
        cases_data = cases_resp.json()
        self.assertIn("items", cases_data)
        self.assertGreater(len(cases_data["items"]), 0)

        selected_case = cases_data["items"][0]
        case_id = selected_case["case_id"]
        # Verify deterministic case ID format: CASE_{12-hex hash}
        self.assertTrue(case_id.startswith("CASE_"))
        self.assertEqual(len(case_id), 17)

        # 4. Fetch case detail and score breakdown
        detail_resp = self.client.get(f"/api/v1/cases/{case_id}")
        self.assertEqual(detail_resp.status_code, 200)
        detail = detail_resp.json()
        self.assertEqual(detail["case_id"], case_id)
        self.assertIn("score_breakdown", detail)
        breakdown = detail["score_breakdown"]
        self.assertIn("severity", breakdown)
        self.assertIn("amount", breakdown)
        self.assertIn("velocity", breakdown)
        self.assertIn("account_count", breakdown)
        self.assertIn("corroboration", breakdown)
        self.assertEqual(
            breakdown["total"],
            breakdown["severity"] + breakdown["amount"] + breakdown["velocity"] +
            breakdown["account_count"] + breakdown["corroboration"]
        )

        # 5. Fetch case graph and transaction data
        graph_resp = self.client.get(f"/api/v1/cases/{case_id}/graph")
        self.assertEqual(graph_resp.status_code, 200)
        graph = graph_resp.json()
        self.assertIn("nodes", graph)
        self.assertIn("edges", graph)
        self.assertGreater(len(graph["nodes"]), 0)
        self.assertGreater(len(graph["edges"]), 0)

        # Confirm 1 edge per transaction
        edge_tx_ids = [e["tx_id"] for e in graph["edges"]]
        self.assertEqual(len(edge_tx_ids), len(set(edge_tx_ids)))

    def test_02_unknown_case_id_returns_exact_404_envelope(self):
        """Step 7: Handle an unknown case ID using the established 404 error envelope."""
        unknown_id = "CASE_999999999999"
        expected = {
            "error": {
                "code": "not_found",
                "message": "Case not found",
                "details": {},
            }
        }
        resp = self.client.get(f"/api/v1/cases/{unknown_id}")
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json(), expected)

        # Same for /graph
        graph_resp = self.client.get(f"/api/v1/cases/{unknown_id}/graph")
        self.assertEqual(graph_resp.status_code, 404)
        self.assertEqual(graph_resp.json(), expected)

    def test_03_repeated_scan_preserves_case_identity_and_idempotency(self):
        """Step 8: Repeat a scan and verify that unchanged account sets retain their stable case IDs."""
        first_cases = self.client.get("/api/v1/cases").json()["items"]
        first_ids = {c["case_id"] for c in first_cases}

        # Trigger second scan
        scan_resp = self.client.post("/api/v1/scan")
        scan_id = scan_resp.json()["scan_id"]
        for _ in range(30):
            if self.client.get(f"/api/v1/scan/{scan_id}").json()["status"] in ("complete", "completed", "partial"):
                break
            time.sleep(0.1)

        second_cases = self.client.get("/api/v1/cases").json()["items"]
        second_ids = {c["case_id"] for c in second_cases}

        # Exact ID match, no duplicated cases
        self.assertEqual(first_ids, second_ids)
        self.assertEqual(len(first_cases), len(second_cases))


if __name__ == "__main__":
    unittest.main()
