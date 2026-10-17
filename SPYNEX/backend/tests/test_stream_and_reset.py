"""Tests for RingTrace Stream Replay and Demo Reset endpoints (Member B)."""
import os
import sys
import time
import unittest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from fastapi.testclient import TestClient
from app.db import FalkorDBClient
from app.main import app
from app.memory.graph import MEMORY_GRAPH, TXN_GRAPH


class TestStreamAndReset(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.db = FalkorDBClient()

    def test_stream_status_initial(self):
        resp = self.client.get("/api/v1/stream/status")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("state", data)
        self.assertIn("sent", data)
        self.assertIn("total", data)
        self.assertGreater(data["total"], 0)

    def test_stream_lifecycle(self):
        # 1. Start stream
        start_resp = self.client.post(
            "/api/v1/stream/start",
            json={"batch_size": 10, "interval_seconds": 0.1},
        )
        self.assertEqual(start_resp.status_code, 200)
        self.assertEqual(start_resp.json()["state"], "running")

        # Let it stream a quick batch
        time.sleep(0.3)

        # 2. Pause stream
        pause_resp = self.client.post("/api/v1/stream/pause")
        self.assertEqual(pause_resp.status_code, 200)
        self.assertEqual(pause_resp.json()["state"], "paused")

        # 3. Resume stream
        resume_resp = self.client.post("/api/v1/stream/resume")
        self.assertEqual(resume_resp.status_code, 200)
        self.assertEqual(resume_resp.json()["state"], "running")

        # 4. Stop stream
        stop_resp = self.client.post("/api/v1/stream/stop")
        self.assertEqual(stop_resp.status_code, 200)
        self.assertEqual(stop_resp.json()["state"], "stopped")

    def test_stream_sse_events(self):
        import asyncio
        from app.stream.worker import replay_worker, publish_event

        async def check_sse():
            gen = replay_worker.event_generator()
            first_chunk = await anext(gen)
            self.assertIn("event: stream_status", first_chunk)

            # Test event publication
            publish_event("tx_batch", {"count": 5, "tx_ids": ["TX_TEST_1"]})
            second_chunk = await anext(gen)
            self.assertIn("event: tx_batch", second_chunk)
            self.assertIn("TX_TEST_1", second_chunk)

        asyncio.run(check_sse())

    def test_demo_reset(self):
        # 1. Inject a mock demo account and transaction into txn graph
        self.db.execute_query(
            TXN_GRAPH,
            """
            MERGE (a:Account {id: 'demo_acc_test_1'})
            MERGE (b:Account {id: 'demo_acc_test_2'})
            MERGE (a)-[t:SENT {tx_id: 'demo_tx_test_1', amount: 50000.0, ts: 1700000000, step: 1, tx_type: 'transfer'}]->(b)
            """,
        )

        # 2. Modify memory graph by recording a dummy decision
        self.db.execute_query(
            MEMORY_GRAPH,
            """
            MATCH (c:Case {id: 'CASE_0001'})
            MERGE (d:Decision {decision_id: 'DEC_TEST_TEMP', decision: 'dismiss', note: 'test', actor: 'tester', ts: '2026-01-01T00:00:00Z'})
            MERGE (c)-[:DECIDED]->(d)
            SET c.status = 'dismissed'
            """,
        )

        # 3. Execute demo reset
        resp = self.client.post("/api/v1/demo/reset")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        self.assertEqual(data["status"], "success")
        self.assertTrue(data["memory_cleared"])
        self.assertTrue(data["replay_reset"])
        self.assertTrue(data["reseeded"])
        self.assertEqual(data["cases_seeded"], 3)
        self.assertGreaterEqual(data["removed_demo_accounts"], 2)

        # 4. Verify demo accounts wiped from txn graph
        check_acc = self.db.execute_query(
            TXN_GRAPH,
            "MATCH (a:Account) WHERE a.id STARTS WITH 'demo_' RETURN count(a)",
        )
        self.assertEqual(check_acc.result_set[0][0], 0)

        # 5. Verify CASE_0001 status in memory is restored to 'open' (pristine snapshot)
        check_case = self.db.execute_query(
            MEMORY_GRAPH,
            "MATCH (c:Case {id: 'CASE_0001'}) RETURN c.status",
        )
        self.assertEqual(check_case.result_set[0][0], "open")


if __name__ == "__main__":
    unittest.main()
