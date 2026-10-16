"""Unit and integration test suite for the Agent Loop, Validator, and Fallback (Member B, Step 3)."""
import os
import sys
import unittest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.agent.fallback import run_fallback_investigation
from app.agent.llm import is_llm_available
from app.agent.loop import run_investigation
from app.agent.validator import extract_referenced_ids, validate_narrative
from app.db import FalkorDBClient
from app.mcp_server.tools import propose_action


class TestAgentComponents(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = FalkorDBClient()

    # -----------------------------------------------------------------------
    # Validator Tests
    # -----------------------------------------------------------------------
    def test_01_extract_referenced_ids(self):
        text = (
            "Account ACC_01911 transferred funds to ACC_02464 via transfer TX_0014054. "
            "This matches historical case CASE_0001, but differs from demo_user_99."
        )
        refs = extract_referenced_ids(text)
        self.assertIn("ACC_01911", refs["accounts"])
        self.assertIn("ACC_02464", refs["accounts"])
        self.assertIn("demo_user_99", refs["accounts"])
        self.assertIn("TX_0014054", refs["transactions"])
        self.assertIn("CASE_0001", refs["cases"])

    def test_02_validator_accepts_clean_evidence(self):
        text = "Observed transfer from ACC_01911 to ACC_02464 under TX_0014054."
        allowed_accs = {"ACC_01911", "ACC_02464"}
        allowed_txs = {"TX_0014054"}

        val = validate_narrative(
            text=text,
            allowed_accounts=allowed_accs,
            allowed_transactions=allowed_txs,
            current_case_id="CASE_0001",
        )
        self.assertTrue(val.is_valid)
        self.assertEqual(len(val.hallucinated_ids), 0)

    def test_03_validator_rejects_hallucinated_ids(self):
        # ACC_99999 and TX_7777777 are invented
        fake_text = "Fraudulent funds flowed from ACC_01911 to ACC_99999 via fictitious transaction TX_7777777."
        allowed_accs = {"ACC_01911", "ACC_02464"}
        allowed_txs = {"TX_0014054"}

        val = validate_narrative(
            text=fake_text,
            allowed_accounts=allowed_accs,
            allowed_transactions=allowed_txs,
            current_case_id="CASE_0001",
        )
        self.assertFalse(val.is_valid)
        self.assertIn("ACC_99999", val.hallucinated_ids)
        self.assertIn("TX_7777777", val.hallucinated_ids)
        self.assertIn("validation failed", val.error_message)

    # -----------------------------------------------------------------------
    # Fallback Engine Tests
    # -----------------------------------------------------------------------
    def test_04_fallback_executes_cycle_case(self):
        streamed_steps = []

        def on_step(step):
            streamed_steps.append(step)

        res = run_fallback_investigation(
            case_id="CASE_0001",
            step_callback=on_step,
            db=self.db,
            memory_graph="memory",
            txn_graph="txn",
        )

        self.assertEqual(res["status"], "done")
        self.assertEqual(res["mode"], "fallback")
        self.assertEqual(res["case_id"], "CASE_0001")
        self.assertGreater(len(res["steps"]), 3)
        self.assertEqual(len(streamed_steps), len(res["steps"]))

        # Check assessment structure
        assessment = res["assessment"]
        self.assertEqual(assessment["risk_level"], "high")
        self.assertIn("CASE_0001", assessment["narrative"])
        self.assertGreater(len(assessment["findings"]), 0)

        # Check proposed action
        prop = res["proposed_action"]
        self.assertEqual(prop["status"], "success")
        self.assertEqual(prop["type"], "escalate")
        self.assertEqual(prop["action_status"], "pending")

    def test_05_fallback_payroll_similar_dismissal_rule(self):
        # First, record a simulated decision on CASE_0002 marking it dismissed
        propose_action(case_id="CASE_0002", type="dismiss", reason="Legitimate monthly payroll run", db=self.db, memory_graph="memory")
        self.db.execute_query(
            "memory",
            "MATCH (c:Case {id: 'CASE_0002'}) "
            "CREATE (d:Decision {decision_id: 'DEC_TEST_002', decision: 'dismiss', note: 'Payroll approved', actor: 'senior_analyst', ts: '2026-01-05T12:00:00Z'}) "
            "CREATE (c)-[:DECIDED]->(d) "
            "SET c.status = 'dismissed'",
            caller="test:setup_decision",
        )

        # Now run investigation on CASE_0003 (which shares all 15 payroll accounts)
        res = run_fallback_investigation(
            case_id="CASE_0003",
            db=self.db,
            memory_graph="memory",
            txn_graph="txn",
        )

        self.assertEqual(res["status"], "done")
        self.assertEqual(res["mode"], "fallback")
        # Payroll with matching past dismissal triggers dismissal proposal!
        self.assertEqual(res["proposed_action"]["type"], "dismiss")
        self.assertEqual(res["assessment"]["risk_level"], "low")
        self.assertIn("CASE_0002", res["proposed_action"]["reason"])

    # -----------------------------------------------------------------------
    # Agent Loop Fallback Integration Tests
    # -----------------------------------------------------------------------
    def test_06_agent_loop_with_wrong_key_falls_back_safely(self):
        # Save original key
        orig_key = os.environ.get("GEMINI_API_KEY", "")
        try:
            os.environ["GEMINI_API_KEY"] = "fake_invalid_key_12345"

            res = run_investigation(
                case_id="CASE_0001",
                db=self.db,
                memory_graph="memory",
                txn_graph="txn",
            )

            # Must not crash; seamlessly fall back to deterministic engine
            self.assertEqual(res["status"], "done")
            self.assertEqual(res["mode"], "fallback")
            self.assertIn("CASE_0001", res["assessment"]["narrative"])
            self.assertIn(res["proposed_action"]["type"], ["escalate", "monitor", "dismiss"])
        finally:
            os.environ["GEMINI_API_KEY"] = orig_key

    def test_07_agent_loop_without_key_runs_fallback(self):
        orig_key = os.environ.get("GEMINI_API_KEY", "")
        try:
            os.environ["GEMINI_API_KEY"] = ""

            self.assertFalse(is_llm_available())
            res = run_investigation(
                case_id="CASE_0001",
                db=self.db,
                memory_graph="memory",
                txn_graph="txn",
            )
            self.assertEqual(res["status"], "done")
            self.assertEqual(res["mode"], "fallback")
        finally:
            os.environ["GEMINI_API_KEY"] = orig_key


if __name__ == "__main__":
    unittest.main()
