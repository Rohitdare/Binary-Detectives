"""Isolated tests for chat validation and deterministic SAR draft creation."""
import json
import os
import sys
import unittest
from unittest.mock import patch

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.agent.chat import ChatCaseNotFound, run_case_chat
from app.agent.evidence import EvidenceStore
from app.agent.plain_language import find_jargon
from app.agent.validator import validate_evidence_ids
from app.api import investigation_routes as routes
from app.memory.sar import DISCLAIMER, build_sar
from app.queries_memory import (
    CREATE_SAR_CYPHER,
    GET_CASE_BY_ID,
    GET_CASE_DECISIONS,
    GET_CASE_NOTES,
    GET_CASE_PAYLOAD,
    GET_INVESTIGATIONS_BY_CASE,
    GET_LATEST_CASE_SAR,
    SAVE_CHAT_NOTE_CYPHER,
)


class Result:
    def __init__(self, rows):
        self.result_set = rows


CASE_DATA = {
    "status": "success",
    "case_id": "CASE_0001",
    "case_status": "escalated",
    "score": 82,
    "score_breakdown": {"amount": 14, "total": 82},
    "patterns": ["cycle"],
    "hits": [{"pattern": "cycle", "tx_ids": ["TX_0000001"], "account_ids": ["ACC_00001"], "measurements": {
        "cycle_length": 2, "duration_seconds": 3600, "amount_conservation_ratio": 0.9,
    }}],
    "accounts": [{"id": "ACC_00001", "type": "personal"}],
    "evidence": {"account_ids": ["ACC_00001"], "tx_ids": ["TX_0000001"]},
}
PAYLOAD = {
    "case_id": "CASE_0001", "account_ids": ["ACC_00001"], "tx_ids": ["TX_0000001"],
    "total_amount": 50000.0, "tx_count": 1, "score": 82,
    "score_breakdown": {"amount": 14, "total": 82},
    "first_ts": "2026-02-01T00:00:00Z", "last_ts": "2026-02-01T01:00:00Z",
}


class FakeDB:
    def __init__(self, approved=True, existing_sar=None):
        self.calls = []
        self.approved = approved
        self.existing_sar = existing_sar

    def execute_query(self, graph, query, params=None, caller="test"):
        self.calls.append((graph, query, params or {}, caller))
        params = params or {}
        if query == GET_CASE_BY_ID:
            return Result([[params["case_id"], "escalated", 82, "{}", ["cycle"], "sig", "now"]])
        if query == GET_CASE_DECISIONS:
            decisions = [["DEC_1", "APPROVE_SAR", "reviewed case", "analyst_1", "2026-02-01T02:00:00Z"]] if self.approved else []
            return Result(decisions)
        if query == GET_LATEST_CASE_SAR:
            return Result([self.existing_sar] if self.existing_sar else [])
        if query == GET_CASE_PAYLOAD:
            return Result([[json.dumps(PAYLOAD), "escalated"]])
        if query == GET_INVESTIGATIONS_BY_CASE:
            return Result([])
        if query == GET_CASE_NOTES:
            return Result([])
        if query == CREATE_SAR_CYPHER:
            return Result([[params["sar_id"]]])
        if query == SAVE_CHAT_NOTE_CYPHER:
            return Result([[params["note_id"]]])
        return Result([])


class ChatSarTests(unittest.TestCase):
    def test_canonical_decisions_keep_legacy_api_labels(self):
        self.assertEqual(routes._legacy_decision_label("APPROVE_SAR"), "escalate")
        self.assertEqual(routes._legacy_decision_label("DISMISS"), "dismiss")
        self.assertEqual(routes._legacy_decision_label("MONITOR"), "monitor")

    def test_build_sar_is_deterministic_verified_and_disclaimed(self):
        data = {
            "sar_id": "SAR_ab12cd34", "case_id": "CASE_0001", "generated_at": "2026-10-18T00:00:00Z",
            "account_ids": ["ACC_00001"], "tx_ids": ["TX_0000001"], "total_amount": 50000,
            "tx_count": 1, "score": 82, "patterns": ["cycle"], "hits": CASE_DATA["hits"],
            "score_breakdown": {"total": 82}, "time_range": "2026-02-01 to 2026-02-01",
            "decision": {"actor": "analyst_1", "ts": "2026-02-01", "note": "reviewed"},
        }
        report = build_sar(data)
        evidence = EvidenceStore()
        evidence.add(data)
        evidence.add({"sar_id": data["sar_id"]})
        self.assertIn(DISCLAIMER, report["narrative"])
        self.assertIn("not a probability", report["narrative"])
        self.assertEqual(find_jargon(report["narrative"]), [])
        self.assertTrue(validate_evidence_ids(report["summary"] + report["narrative"], evidence).is_valid)

    def test_tampered_sar_id_is_rejected(self):
        evidence = EvidenceStore()
        evidence.add({"case_id": "CASE_0001", "account_ids": ["ACC_00001"], "total_amount": 50000})
        result = validate_evidence_ids("SAR_ab12cd34 names ACC_00001 and ₹50,000", evidence)
        self.assertFalse(result.is_valid)
        self.assertIn("SAR_ab12cd34", result.hallucinated_ids)

    def test_generate_requires_approval(self):
        with patch.object(routes, "db_client", FakeDB(approved=False)):
            with self.assertRaises(routes.HTTPException) as caught:
                routes.generate_case_sar("CASE_0001")
        self.assertEqual(caught.exception.status_code, 409)

    def test_generate_persists_one_sar_and_repeat_is_idempotent(self):
        db = FakeDB()
        with patch.object(routes, "db_client", db), \
             patch.object(routes, "get_case", return_value=CASE_DATA), \
             patch.object(routes, "find_similar_cases", return_value={"status": "success", "items": []}):
            # Route functions receive Query defaults only under FastAPI; direct
            # unit calls pass the explicit value to exercise idempotency.
            first = routes.generate_case_sar("CASE_0001", regenerate=False)
            existing = [first["sar_id"], first["summary"], first["narrative"], "FILE_SAR", "analyst_1", first["created_at"]]
            db.existing_sar = existing
            second = routes.generate_case_sar("CASE_0001", regenerate=False)
        self.assertEqual(first["sar_id"], second["sar_id"])
        self.assertEqual(sum(query == CREATE_SAR_CYPHER for _, query, _, _ in db.calls), 1)
        self.assertIn(DISCLAIMER, first["narrative"])

    def test_chat_fallback_persists_only_verified_reply(self):
        db = FakeDB()
        with patch("app.agent.chat.get_case", return_value=CASE_DATA), \
             patch("app.agent.chat.llm.is_llm_available", return_value=False):
            response = run_case_chat("CASE_0001", "Summarize this case", db=db)
        self.assertTrue(response["verified"])
        self.assertIn("Circular fund movement", response["reply"])
        self.assertEqual(sum(query == SAVE_CHAT_NOTE_CYPHER for _, query, _, _ in db.calls), 1)

    def test_chat_unknown_case_is_404_domain_error(self):
        with patch("app.agent.chat.get_case", return_value={"status": "error"}):
            with self.assertRaises(ChatCaseNotFound):
                run_case_chat("CASE_missing", "Where did money go?", db=FakeDB())

    def test_chat_history_precedes_the_current_question(self):
        db = FakeDB()
        captured = []

        def fail_after_capture(contents, *_args, **_kwargs):
            captured.extend(contents)
            raise RuntimeError("simulated model outage")

        with patch("app.agent.chat.get_case", return_value=CASE_DATA), \
             patch("app.agent.chat.llm.is_llm_available", return_value=True), \
             patch("app.agent.chat.llm.tool_declarations", return_value=[]), \
             patch("app.agent.chat.llm.user_message", side_effect=lambda value: f"user:{value}"), \
             patch("app.agent.chat.llm.history_message", side_effect=lambda role, value: f"{role}:{value}"), \
             patch("app.agent.chat.llm.generate_with_timeout", side_effect=fail_after_capture):
            run_case_chat(
                "CASE_0001",
                "Where did it go?",
                history=[{"role": "user", "content": "What happened?"}, {"role": "assistant", "content": "A transfer was recorded."}],
                db=db,
            )

        self.assertEqual(captured[0], "user:Investigate case CASE_0001.")
        self.assertEqual(captured[-1], "user:Analyst question: Where did it go?")
        self.assertEqual(captured[-3:-1], ["user:What happened?", "assistant:A transfer was recorded."])


if __name__ == "__main__":
    unittest.main()
