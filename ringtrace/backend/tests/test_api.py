"""Tests for RingTrace FastAPI endpoints."""
import os
import sys
import unittest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from fastapi.testclient import TestClient
from app.main import app


class TestRingTraceAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_health_endpoint(self):
        resp = self.client.get("/api/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("status", data)
        self.assertIn("falkordb_connected", data)
        self.assertTrue(data["falkordb_connected"])

    def test_stats_endpoint(self):
        resp = self.client.get("/api/stats")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertGreater(data["total_accounts"], 0)
        self.assertGreater(data["total_transactions"], 0)
        self.assertEqual(data["active_investigations"], 0)
        self.assertEqual(data["suspicious_patterns_detected"], "Not yet analyzed")

    def test_transactions_endpoint(self):
        resp = self.client.get("/api/transactions?limit=10")
        self.assertEqual(resp.status_code, 200)
        txs = resp.json()
        self.assertIsInstance(txs, list)
        self.assertEqual(len(txs), 10)
        first = txs[0]
        for field in ("tx_id", "src", "dst", "amount", "ts", "tx_type"):
            self.assertIn(field, first)

    def test_graph_endpoint(self):
        resp = self.client.get("/api/graph?limit=25")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("nodes", data)
        self.assertIn("edges", data)
        self.assertGreater(len(data["nodes"]), 0)
        self.assertGreater(len(data["edges"]), 0)
        # Verify Cytoscape format: elements have data attribute
        self.assertIn("data", data["nodes"][0])
        self.assertIn("id", data["nodes"][0]["data"])
        self.assertIn("data", data["edges"][0])
        self.assertIn("source", data["edges"][0]["data"])
        self.assertIn("target", data["edges"][0]["data"])

    def test_account_details_endpoint(self):
        resp = self.client.get("/api/accounts/ACC_00001")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["account"]["id"], "ACC_00001")
        self.assertIn("incoming", data)
        self.assertIn("outgoing", data)

    def test_account_not_found(self):
        resp = self.client.get("/api/accounts/NON_EXISTENT_ACC")
        self.assertEqual(resp.status_code, 404)

    def test_search_endpoint(self):
        resp = self.client.get("/api/search?q=ACC_0000")
        self.assertEqual(resp.status_code, 200)
        res = resp.json()
        self.assertIsInstance(res, list)
        self.assertGreater(len(res), 0)
        self.assertTrue(all("ACC_0000" in acc["id"] for acc in res))

    def test_fan_in_endpoint(self):
        resp = self.client.get("/api/detectors/fan-in?limit=5")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["pattern"], "fan_in")
        self.assertIn("hits", data)
        self.assertIn("truncated", data)
        self.assertIsInstance(data["hits"], list)

    def test_fan_out_endpoint(self):
        resp = self.client.get("/api/detectors/fan-out?limit=5")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["pattern"], "fan_out")
        self.assertIn("hits", data)
        self.assertIn("truncated", data)
        self.assertIsInstance(data["hits"], list)

    def test_fan_in_validation_error(self):
        resp = self.client.get("/api/detectors/fan-in?min_senders=1")
        self.assertEqual(resp.status_code, 422)

    def test_fan_out_validation_error(self):
        resp = self.client.get("/api/detectors/fan-out?min_receivers=1")
        self.assertEqual(resp.status_code, 422)


if __name__ == "__main__":
    unittest.main()
