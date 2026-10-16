"""Tests for RingTrace Investigation & Memory Endpoints (Member B)."""
import os
import sys
import time
import unittest
import uuid

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from fastapi.testclient import TestClient
from app.db import FalkorDBClient
from app.main import app
from app.memory.graph import MEMORY_GRAPH
from app.queries_memory import PROPOSE_ACTION_CYPHER


class TestInvestigationRoutes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.db = FalkorDBClient()

    def test_start_investigation_not_found(self):
        resp = self.client.post("/api/v1/cases/NON_EXISTENT_CASE_9999/investigations")
        self.assertEqual(resp.status_code, 404)
        data = resp.json()
        self.assertIn("error", data["detail"])
        self.assertEqual(data["detail"]["error"]["code"], "not_found")

    def test_start_investigation_success(self):
        resp = self.client.post("/api/v1/cases/CASE_0001/investigations")
        self.assertEqual(resp.status_code, 202)
        data = resp.json()
        self.assertIn("investigation_id", data)
        self.assertEqual(data["status"], "running")
        self.assertTrue(data["investigation_id"].startswith("INV_"))

        inv_id = data["investigation_id"]

        # Check get investigation details endpoint
        get_resp = self.client.get(f"/api/v1/investigations/{inv_id}")
        self.assertEqual(get_resp.status_code, 200)
        inv_data = get_resp.json()
        self.assertEqual(inv_data["investigation_id"], inv_id)
        self.assertEqual(inv_data["case_id"], "CASE_0001")

    def test_get_case_investigations(self):
        resp = self.client.get("/api/v1/cases/CASE_0001/investigations")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("items", data)
        self.assertIn("total", data)

    def test_sse_stream_not_found(self):
        resp = self.client.get("/api/v1/investigations/INV_NONEXISTENT_9999/events")
        self.assertEqual(resp.status_code, 200)
        # SSE stream should yield error event
        text = resp.text
        self.assertIn("event: error", text)
        self.assertIn("not_found", text)

    def test_sse_stream_active(self):
        # Start an investigation
        start_resp = self.client.post("/api/v1/cases/CASE_0001/investigations")
        self.assertEqual(start_resp.status_code, 202)
        inv_id = start_resp.json()["investigation_id"]

        # Connect to SSE stream
        with self.client.stream("GET", f"/api/v1/investigations/{inv_id}/events") as stream:
            self.assertEqual(stream.status_code, 200)
            self.assertIn("text/event-stream", stream.headers.get("content-type", ""))
            
            # Read first few chunks
            chunks = []
            for line in stream.iter_lines():
                if line:
                    chunks.append(line)
                if len(chunks) >= 4 or any("event: done" in c for c in chunks):
                    break
            self.assertTrue(len(chunks) > 0)

    def test_record_decision_invalid_input(self):
        # Invalid decision value
        payload = {"decision": "invalid_choice", "note": "Testing", "actor": "Analyst_1"}
        resp = self.client.post("/api/v1/cases/CASE_0001/decisions", json=payload)
        self.assertEqual(resp.status_code, 400)

    def test_record_decision_case_not_found(self):
        payload = {"decision": "dismiss", "note": "Payroll", "actor": "Analyst_1"}
        resp = self.client.post("/api/v1/cases/CASE_9999_MISSING/decisions", json=payload)
        self.assertEqual(resp.status_code, 404)

    def test_record_decision_success(self):
        # Seed a test case to prevent mutating CASE_0001 permanently
        test_case_id = f"CASE_TEST_{uuid.uuid4().hex[:6]}"
        now_ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        self.db.execute_query(
            MEMORY_GRAPH,
            """
            MERGE (c:Case {id: $case_id})
            ON CREATE SET c.name = 'Test Decision Case', c.status = 'open', c.created_at = $ts
            """,
            {"case_id": test_case_id, "ts": now_ts},
        )

        payload = {
            "decision": "dismiss",
            "note": "Payroll routine legitimate transfer",
            "actor": "Analyst_1",
        }
        resp = self.client.post(f"/api/v1/cases/{test_case_id}/decisions", json=payload)
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data["case_id"], test_case_id)
        self.assertEqual(data["decision"], "dismiss")
        self.assertEqual(data["actor"], "Analyst_1")
        self.assertEqual(data["note"], "Payroll routine legitimate transfer")
        self.assertTrue(data["decision_id"].startswith("DEC_"))

        # Verify status in graph updated to 'dismissed'
        check_q = self.db.execute_query(
            MEMORY_GRAPH,
            "MATCH (c:Case {id: $cid}) RETURN c.status",
            {"cid": test_case_id},
        )
        self.assertEqual(check_q.result_set[0][0], "dismissed")

        # Verify get decisions endpoint
        dec_resp = self.client.get(f"/api/v1/cases/{test_case_id}/decisions")
        self.assertEqual(dec_resp.status_code, 200)
        dec_data = dec_resp.json()
        self.assertEqual(dec_data["total"], 1)
        self.assertEqual(dec_data["items"][0]["decision"], "dismiss")
        self.assertEqual(dec_data["items"][0]["actor"], "Analyst_1")

    def test_find_similar_cases_endpoint(self):
        # CASE_0002 shares accounts with CASE_0003
        resp = self.client.get("/api/v1/cases/CASE_0002/similar")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("items", data)
        self.assertIsInstance(data["items"], list)
        self.assertTrue(len(data["items"]) > 0)
        first_match = data["items"][0]
        self.assertIn("case_id", first_match)
        self.assertIn("match", first_match)
        self.assertIn("shared_account_ids", first_match)
        self.assertIn("outcome", first_match)

    def test_approve_proposed_action(self):
        # Create a test case and proposed action
        test_case_id = f"CASE_ACT_{uuid.uuid4().hex[:6]}"
        action_id = f"ACT_TEST_{uuid.uuid4().hex[:6]}"
        now_ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        self.db.execute_query(
            MEMORY_GRAPH,
            """
            MERGE (c:Case {id: $case_id})
            ON CREATE SET c.name = 'Test Action Case', c.status = 'open', c.created_at = $ts
            """,
            {"case_id": test_case_id, "ts": now_ts},
        )
        self.db.execute_query(
            MEMORY_GRAPH,
            PROPOSE_ACTION_CYPHER,
            {
                "case_id": test_case_id,
                "action_id": action_id,
                "type": "draft_sar",
                "reason": "Circular layering detected",
                "created_at": now_ts,
            },
        )

        resp = self.client.post(f"/api/v1/actions/{action_id}/approve")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["action"]["status"], "approved")
        self.assertEqual(data["decision"]["decision"], "escalate")

        # Verify case status updated to sar_drafted
        case_res = self.db.execute_query(
            MEMORY_GRAPH,
            "MATCH (c:Case {id: $cid}) RETURN c.status",
            {"cid": test_case_id},
        )
        self.assertEqual(case_res.result_set[0][0], "sar_drafted")

    def test_reject_proposed_action(self):
        test_case_id = f"CASE_REJ_{uuid.uuid4().hex[:6]}"
        action_id = f"ACT_REJ_{uuid.uuid4().hex[:6]}"
        now_ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        self.db.execute_query(
            MEMORY_GRAPH,
            """
            MERGE (c:Case {id: $case_id})
            ON CREATE SET c.name = 'Test Reject Case', c.status = 'open', c.created_at = $ts
            """,
            {"case_id": test_case_id, "ts": now_ts},
        )
        self.db.execute_query(
            MEMORY_GRAPH,
            PROPOSE_ACTION_CYPHER,
            {
                "case_id": test_case_id,
                "action_id": action_id,
                "type": "monitor",
                "reason": "Suspicious velocity",
                "created_at": now_ts,
            },
        )

        resp = self.client.post(f"/api/v1/actions/{action_id}/reject")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "rejected")


if __name__ == "__main__":
    unittest.main()
