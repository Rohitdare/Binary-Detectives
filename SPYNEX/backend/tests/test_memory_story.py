"""End-to-end unit and integration test for the Memory Block pitch story (Section 3).

Story Workflow:
1. Find the payroll-style fan-out case (CASE_0002, origin ACC_02975 is a payroll account).
2. Human analyst dismisses CASE_0002 with a compliance note.
3. Query similar cases for CASE_0003 (which shares the exact same 16 payroll accounts).
4. Assert find_similar_cases and GET /api/v1/cases/CASE_0003/similar return CASE_0002 with
   outcome="dismiss" and its decided timestamp.
5. Run investigation on CASE_0003:
   - Proposes action "dismiss" citing historical case CASE_0002.
   - Assessment narrative explicitly cites CASE_0002.
   - Anti-hallucination validator verifies and accepts the citation of CASE_0002.
   - An invented case citation (e.g. CASE_9999) is rejected.
"""
import unittest
from fastapi.testclient import TestClient

from app.agent.fallback import run_fallback_investigation
from app.agent.validator import validate_narrative
from app.db import FalkorDBClient
from app.main import app
from app.mcp_server.tools import find_similar_cases
from app.memory.graph import MEMORY_GRAPH
from app.memory.seed import seed_memory
from app.queries_memory import RECORD_DECISION_CYPHER


class TestMemoryStory(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.db = FalkorDBClient()
        seed_memory(db=cls.db, reset=False)

    def test_01_payroll_fanout_dismissal_and_memory_recall(self):
        # 1. Verify CASE_0002 exists and is a fan-out pattern
        case_res = self.client.get("/api/v1/cases/CASE_0002")
        self.assertEqual(case_res.status_code, 200)
        cdata = case_res.json()
        self.assertEqual(cdata["case_id"], "CASE_0002")
        self.assertIn("fan_out", cdata["patterns"])

        # 2. Dismiss CASE_0002 with a compliance note
        dec_payload = {
            "decision": "dismiss",
            "note": "Routine monthly salary dispersal to 15 employees. Legitimate payroll fan-out.",
            "actor": "Analyst_1",
        }
        dec_res = self.client.post("/api/v1/cases/CASE_0002/decisions", json=dec_payload)
        self.assertIn(dec_res.status_code, (200, 201))
        dec_json = dec_res.json()
        self.assertEqual(dec_json["decision"], "dismiss")
        self.assertEqual(dec_json["case_id"], "CASE_0002")

        # Verify CASE_0002 status is updated to dismissed
        c2_updated = self.client.get("/api/v1/cases/CASE_0002").json()
        self.assertEqual(c2_updated["status"], "dismissed")

        # 3. Query similar cases for CASE_0003
        sim_tool_res = find_similar_cases("CASE_0003", limit=5, db=self.db, memory_graph=MEMORY_GRAPH)
        self.assertEqual(sim_tool_res["status"], "success")
        self.assertGreaterEqual(sim_tool_res["similar_count"], 1)

        matched_item = next((item for item in sim_tool_res["items"] if item["case_id"] == "CASE_0002"), None)
        self.assertIsNotNone(matched_item, "CASE_0002 must be returned as a similar case for CASE_0003")
        self.assertEqual(matched_item["match_type"], "shared_accounts")
        self.assertIn(matched_item["outcome"], ("dismiss", "dismissed"))
        self.assertIsNotNone(matched_item["decided_at"])
        self.assertIn("CASE_0002", sim_tool_res["evidence"]["case_ids"])

        # 4. Test GET /api/v1/cases/CASE_0003/similar API endpoint
        api_sim_res = self.client.get("/api/v1/cases/CASE_0003/similar")
        self.assertEqual(api_sim_res.status_code, 200)
        api_data = api_sim_res.json()
        api_matched = next((it for it in api_data["items"] if it["case_id"] == "CASE_0002"), None)
        self.assertIsNotNone(api_matched)
        self.assertIn(api_matched["outcome"], ("dismiss", "dismissed"))
        self.assertIsNotNone(api_matched["decided_at"])

        # 5. Verify CASE_0003 case detail returns similar_case_count
        c3_detail = self.client.get("/api/v1/cases/CASE_0003").json()
        self.assertGreaterEqual(c3_detail.get("similar_case_count", 0), 1)

        # 6. Run investigation on CASE_0003 and verify citation of CASE_0002
        inv_res = run_fallback_investigation("CASE_0003", db=self.db, memory_graph=MEMORY_GRAPH)
        self.assertEqual(inv_res["status"], "done")
        self.assertEqual(inv_res["proposed_action"]["type"], "dismiss")
        self.assertIn("CASE_0002", inv_res["proposed_action"]["reason"])

        narrative = inv_res["assessment"]["narrative"]
        self.assertIn("CASE_0002", narrative, "The assessment narrative must cite the prior case ID CASE_0002")

        # 7. Check Validator accepts the citation of CASE_0002
        allowed_accs = set(sim_tool_res["evidence"]["account_ids"])
        allowed_txs = set(sim_tool_res["evidence"]["tx_ids"])
        allowed_cases = set(sim_tool_res["evidence"]["case_ids"])

        val_good = validate_narrative(
            text=narrative,
            allowed_accounts=allowed_accs,
            allowed_transactions=allowed_txs,
            allowed_cases=allowed_cases,
            current_case_id="CASE_0003",
        )
        self.assertTrue(val_good.is_valid, f"Validator must accept legitimate citation of CASE_0002: {val_good.error_message}")
        self.assertIn("CASE_0002", val_good.referenced_cases)

        # 8. Check Validator rejects hallucinated/invented case citation
        fake_narrative = narrative + " Additionally, see non-existent case CASE_9999 which was also reviewed."
        val_bad = validate_narrative(
            text=fake_narrative,
            allowed_accounts=allowed_accs,
            allowed_transactions=allowed_txs,
            allowed_cases=allowed_cases,
            current_case_id="CASE_0003",
        )
        self.assertFalse(val_bad.is_valid)
        self.assertIn("CASE_9999", val_bad.hallucinated_ids)


if __name__ == "__main__":
    unittest.main()
