"""Manual agent-loop tests with scripted model replies and fake tools."""
import json
import os
import sys
import unittest
from unittest.mock import patch

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.agent.loop import _run_llm_investigation, run_investigation


class ScriptedResponse:
    def __init__(self, calls=None, text=""):
        self.calls = calls or []
        self.text = text


class ManualAgentLoopTests(unittest.TestCase):
    def test_calls_restricted_tools_and_completes_with_verified_text(self):
        final = json.dumps({
            "risk_level": "medium",
            "summary": "Case CASE_0001 includes a verified transfer from ACC_00001.",
            "narrative": "ACC_00001 sent ₹1,000 in TX_0000001. This warrants analyst review.",
            "findings": [{"text": "placeholder is ignored; persisted findings come from tool calls", "evidence_ids": []}],
            "proposed_action": {"type": "monitor", "reason": "Review the verified transfer TX_0000001."},
        })
        replies = [
            ScriptedResponse([("tool_get_case", {"case_id": "CASE_0001"})]),
            ScriptedResponse([("tool_trace_funds", {"account_id": "ACC_00001", "direction": "forward", "max_hops": 2})]),
            ScriptedResponse([("tool_record_finding", {"case_id": "CASE_0001", "text": "Verified transfer TX_0000001 from ACC_00001 for ₹1,000.", "evidence_ids": ["ACC_00001", "TX_0000001"]})]),
            ScriptedResponse([("tool_propose_action", {"case_id": "CASE_0001", "type": "monitor", "reason": "Review transfer TX_0000001 for ₹1,000."})]),
            ScriptedResponse(text=final),
        ]
        tool_map = {
            "tool_get_case": lambda **kw: {"status": "success", "case_id": "CASE_0001", "total_amount": 1000, "evidence": {"account_ids": ["ACC_00001"], "tx_ids": ["TX_0000001"]}, "summary": "Case details returned."},
            "tool_trace_funds": lambda **kw: {"status": "success", "total_initial_amount": 1000, "evidence": {"account_ids": ["ACC_00001", "ACC_00002"], "tx_ids": ["TX_0000001"]}, "summary": "Followed transfers one step."},
            "tool_record_finding": lambda **kw: {"status": "success", "finding_id": "FIND_1", "summary": "Finding recorded.", "evidence": {"account_ids": ["ACC_00001"], "tx_ids": ["TX_0000001"]}},
            "tool_propose_action": lambda **kw: {"status": "success", "action_id": "ACT_1", "type": "monitor", "reason": kw["reason"], "action_status": "pending", "summary": "Action proposed."},
        }
        steps = []
        with patch("app.agent.loop.llm.tool_declarations", return_value=[]), \
             patch("app.agent.loop.llm.user_message", side_effect=lambda value: value), \
             patch("app.agent.loop.llm.function_response_message", side_effect=lambda value: value), \
             patch("app.agent.loop.llm.tool_result_part", side_effect=lambda name, result: (name, result)), \
             patch("app.agent.loop.llm.response_content", return_value=None), \
             patch("app.agent.loop.llm.function_calls", side_effect=lambda response: response.calls), \
             patch("app.agent.loop.llm.text", side_effect=lambda response: response.text), \
             patch("app.agent.loop.llm.generate_with_timeout", side_effect=lambda *args, **kwargs: replies.pop(0)), \
             patch.dict("app.agent.loop.GEMINI_TOOL_NAME_MAP", tool_map, clear=True):
            result = _run_llm_investigation("CASE_0001", "INV_TEST", steps.append, None, "memory", "txn")

        self.assertEqual(result["mode"], "llm")
        self.assertEqual(result["status"], "done")
        self.assertEqual([step["tool"] for step in steps], ["get_case", "trace_funds", "record_finding", "propose_action"])
        self.assertEqual(len(result["assessment"]["findings"]), 1)

    def test_model_without_api_key_uses_fallback_path(self):
        fallback = {"status": "done", "mode": "fallback", "assessment": {}, "proposed_action": {}}
        with patch("app.agent.loop.llm.is_llm_available", return_value=False), \
             patch("app.agent.loop.run_fallback_investigation", return_value=fallback) as run_fallback:
            result = run_investigation("CASE_0001")
        self.assertEqual(result["mode"], "fallback")
        run_fallback.assert_called_once()


if __name__ == "__main__":
    unittest.main()
