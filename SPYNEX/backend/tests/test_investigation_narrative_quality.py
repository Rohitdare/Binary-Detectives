"""Tests for Investigation Narrative Quality, Plain Language, Grounding, and Deterministic Fallback."""
import json
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.agent.evidence import EvidenceStore
from app.agent.fallback import run_fallback_investigation
from app.agent.loop import AGENT_SYSTEM_INSTRUCTION, _run_llm_investigation, run_investigation
from app.agent.plain_language import PLAIN_LANGUAGE_RULES, describe_pattern
from app.agent.validator import check_repetitive_boilerplate, validate_evidence_ids


class ScriptedResponse:
    def __init__(self, calls=None, text=""):
        self.calls = calls or []
        self.text = text


class TestInvestigationNarrativeQuality(unittest.TestCase):
    """Test suite covering the 12 explicit criteria from Section 8 of the investigation narrative specification."""

    # 1. No repeated boilerplate disclaimer
    def test_no_repeated_boilerplate_in_pattern_descriptions(self):
        patterns = ["cycle", "relay_chain", "fan_out", "fan_in", "hub_account", "scatter_gather", "gather_scatter", "bipartite", "dense_cluster"]
        boilerplate = "This pattern merits review and does not by itself prove fraud."
        for pat in patterns:
            desc = describe_pattern(pat, {"duration_seconds": 3600, "intermediary_count": 3})
            self.assertNotIn(boilerplate, desc, f"Pattern {pat} still contained exact boilerplate disclaimer.")

    # 2. LLM prompt prohibits generic repetitive filler
    def test_llm_prompt_prohibits_generic_repetitive_filler(self):
        self.assertIn("Anti-Repetition & Anti-Boilerplate", AGENT_SYSTEM_INSTRUCTION)
        self.assertIn("Do NOT append the same disclaimer after each finding", AGENT_SYSTEM_INSTRUCTION)
        self.assertIn("Avoid generic filler, repeated caveats, and boilerplate disclaimers", PLAIN_LANGUAGE_RULES)
        self.assertIn("Do not repeat the same disclaimer after each finding", PLAIN_LANGUAGE_RULES)
        self.assertIn("triage priority reflecting pattern severity", PLAIN_LANGUAGE_RULES)
        self.assertIn("Trace reach describes the observed movement and disbursement scope of funds", PLAIN_LANGUAGE_RULES)

    # 3. Deterministic fallback produces meaningful, evidence-specific explanations
    def test_deterministic_fallback_produces_evidence_specific_explanations(self):
        mock_c_res = {
            "status": "success",
            "case_id": "CASE_3803f60b5eee",
            "score": 75,
            "patterns": ["relay_chain", "scatter_gather"],
            "hits": [
                {
                    "pattern": "relay_chain",
                    "measurements": {
                        "hop_count": 3,
                        "duration_seconds": 2.4 * 3600,
                        "overall_retention_ratio": 1.11,
                    },
                },
                {
                    "pattern": "scatter_gather",
                    "measurements": {
                        "intermediary_count": 3,
                        "duration_seconds": 27.1 * 3600,
                    },
                },
            ],
            "accounts": [{"id": f"ACC_{i:05d}", "type": "personal"} for i in range(60)],
            "evidence": {"account_ids": [f"ACC_{i:05d}" for i in range(60)], "tx_ids": []},
        }
        with patch("app.agent.fallback.get_case", return_value=mock_c_res), \
             patch("app.agent.fallback.expand_neighborhood", return_value={"status": "success", "evidence": {}}), \
             patch("app.agent.fallback.trace_funds", return_value={"status": "success", "summary": "Traced 3 hops reaching 12 accounts across 15 routes.", "evidence": {"account_ids": ["ACC_00001", "ACC_00002"]}}), \
             patch("app.agent.fallback.find_similar_cases", return_value={"status": "success", "items": []}), \
             patch("app.agent.fallback.record_finding", return_value={"status": "success", "finding_id": "FIND_001", "evidence": {}}), \
             patch("app.agent.fallback.propose_action", side_effect=lambda **kw: {"status": "success", "action_id": "ACT_001", "type": kw.get("type"), "reason": kw.get("reason")}):

            res = run_fallback_investigation("CASE_3803f60b5eee")
            narrative = res["assessment"]["narrative"]

            # Must have clear sections
            self.assertIn("#### Case overview", narrative)
            self.assertIn("#### Key findings", narrative)
            self.assertIn("#### Fund movement", narrative)
            self.assertIn("#### Historical context", narrative)
            self.assertIn("#### Assessment", narrative)
            self.assertIn("#### Recommended next step", narrative)

            # Check that boilerplate is absent
            self.assertEqual(check_repetitive_boilerplate(narrative), [])

    # 4. Findings with different patterns produce appropriately different explanations
    def test_different_patterns_produce_distinct_explanations(self):
        cycle_desc = describe_pattern("cycle", {"cycle_length": 4, "duration_seconds": 7200, "amount_conservation_ratio": 0.95})
        relay_desc = describe_pattern("relay_chain", {"hop_count": 4, "duration_seconds": 3600, "overall_retention_ratio": 0.90})
        fan_out_desc = describe_pattern("fan_out", {"distinct_receivers": 8, "total_outflow": 50000, "time_span_seconds": 7200})
        fan_in_desc = describe_pattern("fan_in", {"distinct_senders": 5, "total_amount": 75000, "time_span_seconds": 10800})
        scatter_desc = describe_pattern("scatter_gather", {"intermediary_count": 3, "duration_seconds": 18000})
        gather_scatter_desc = describe_pattern("gather_scatter", {"distinct_incoming_counterparties": 3, "distinct_outgoing_counterparties": 4, "incoming_amount": 12000, "duration_seconds": 7200})

        self.assertIn("Circular fund movement", cycle_desc)
        self.assertIn("Rapid pass-through", relay_desc)
        self.assertIn("Dispersal pattern", fan_out_desc)
        self.assertIn("Convergence pattern", fan_in_desc)
        self.assertIn("Split-and-recombine routing", scatter_desc)
        self.assertIn("Transit hub pattern", gather_scatter_desc)

        # All descriptions must be unique
        all_descs = [cycle_desc, relay_desc, fan_out_desc, fan_in_desc, scatter_desc, gather_scatter_desc]
        self.assertEqual(len(all_descs), len(set(all_descs)))

    # 5. Missing measurements do not cause fabricated values
    def test_missing_measurements_do_not_fabricate(self):
        cycle_empty = describe_pattern("cycle", {})
        self.assertIn("Circular fund movement", cycle_empty)
        self.assertNotIn("₹", cycle_empty)
        self.assertNotIn("hours", cycle_empty)

        fan_out_empty = describe_pattern("fan_out", {})
        self.assertIn("Dispersal pattern", fan_out_empty)
        self.assertNotIn("₹", fan_out_empty)
        self.assertNotIn("hours", fan_out_empty)

    # 6. The 111% amount ratio is preserved and handled carefully rather than silently normalized
    def test_relay_chain_retention_ratio_greater_than_100_percent(self):
        desc = describe_pattern("relay_chain", {
            "hop_count": 3,
            "duration_seconds": 8640,
            "overall_retention_ratio": 1.11,
        })
        # Must retain 111% and explain possible downstream aggregation / co-mingling
        self.assertIn("111%", desc)
        self.assertIn("downstream transfer amounts reaching 111%", desc)
        self.assertIn("fund aggregation or co-mingling", desc)
        # Must NOT claim simple conservation or silently alter to 100%
        self.assertNotIn("retaining 100%", desc)

    # 7. Narrative does not equate high priority score with fraud probability
    def test_priority_score_is_triage_score_not_fraud_probability(self):
        mock_c_res = {
            "status": "success",
            "case_id": "CASE_HIGH_SCORE",
            "score": 85,
            "patterns": ["cycle"],
            "hits": [{"pattern": "cycle", "measurements": {"cycle_length": 3}}],
            "accounts": [{"id": "ACC_00001"}, {"id": "ACC_00002"}, {"id": "ACC_00003"}],
            "evidence": {"account_ids": ["ACC_00001", "ACC_00002", "ACC_00003"], "tx_ids": []},
        }
        with patch("app.agent.fallback.get_case", return_value=mock_c_res), \
             patch("app.agent.fallback.expand_neighborhood", return_value={"status": "success", "evidence": {}}), \
             patch("app.agent.fallback.trace_funds", return_value={"status": "success", "summary": "Traced 2 hops.", "evidence": {}}), \
             patch("app.agent.fallback.find_similar_cases", return_value={"status": "success", "items": []}), \
             patch("app.agent.fallback.record_finding", return_value={"status": "success", "finding_id": "FIND_001", "evidence": {}}), \
             patch("app.agent.fallback.propose_action", side_effect=lambda **kw: {"status": "success", "action_id": "ACT_001", "type": kw.get("type"), "reason": kw.get("reason")}):

            res = run_fallback_investigation("CASE_HIGH_SCORE")
            narrative = res["assessment"]["narrative"]
            self.assertIn("triage priority score, not a probability of fraud", narrative)
            self.assertNotIn("85% probability of fraud", narrative)
            self.assertNotIn("85% chance of fraud", narrative)

    # 8. Trace reach is not described as a count of fraudulent accounts
    def test_trace_reach_described_as_scope_not_fraudulent_accounts(self):
        mock_c_res = {
            "status": "success",
            "case_id": "CASE_TRACE_SCOPE",
            "score": 50,
            "patterns": ["fan_out"],
            "hits": [],
            "accounts": [{"id": "ACC_00008"}],
            "evidence": {"account_ids": ["ACC_00008"], "tx_ids": []},
        }
        with patch("app.agent.fallback.get_case", return_value=mock_c_res), \
             patch("app.agent.fallback.expand_neighborhood", return_value={"status": "success", "evidence": {}}), \
             patch("app.agent.fallback.trace_funds", return_value={"status": "success", "summary": "Forward trace from ACC_00008 reached 29 accounts across 31 routes.", "evidence": {}}), \
             patch("app.agent.fallback.find_similar_cases", return_value={"status": "success", "items": []}), \
             patch("app.agent.fallback.record_finding", return_value={"status": "success", "finding_id": "FIND_001", "evidence": {}}), \
             patch("app.agent.fallback.propose_action", side_effect=lambda **kw: {"status": "success", "action_id": "ACT_001", "type": kw.get("type"), "reason": kw.get("reason")}):

            res = run_fallback_investigation("CASE_TRACE_SCOPE")
            narrative = res["assessment"]["narrative"]
            self.assertIn("Trace reach describes the observed movement and disbursement boundary of funds across routes, not a count of suspicious or fraudulent accounts", narrative)

    # 9. Historical decisions are only described when supported by returned data
    def test_historical_decisions_handling(self):
        mock_c_res = {
            "status": "success",
            "case_id": "CASE_HIST_A",
            "score": 50,
            "patterns": [],
            "hits": [],
            "accounts": [{"id": "ACC_00001"}],
            "evidence": {"account_ids": ["ACC_00001"], "tx_ids": []},
        }
        # Case A: with past dismissal
        with patch("app.agent.fallback.get_case", return_value=mock_c_res), \
             patch("app.agent.fallback.expand_neighborhood", return_value={"status": "success", "evidence": {}}), \
             patch("app.agent.fallback.trace_funds", return_value={"status": "success", "summary": "Traced 1 hop.", "evidence": {}}), \
             patch("app.agent.fallback.find_similar_cases", return_value={"status": "success", "items": [{"case_id": "CASE_OLD_1", "outcome": "dismiss"}]}), \
             patch("app.agent.fallback.record_finding", return_value={"status": "success", "finding_id": "FIND_001", "evidence": {}}), \
             patch("app.agent.fallback.propose_action", side_effect=lambda **kw: {"status": "success", "action_id": "ACT_001", "type": kw.get("type"), "reason": kw.get("reason")}):

            res_a = run_fallback_investigation("CASE_HIST_A")
            self.assertIn("CASE_OLD_1", res_a["assessment"]["narrative"])
            self.assertIn("previously investigated and dismissed as legitimate business flow", res_a["assessment"]["narrative"])

        # Case B: without past dismissals (must not infer suspicion from absence)
        with patch("app.agent.fallback.get_case", return_value=mock_c_res), \
             patch("app.agent.fallback.expand_neighborhood", return_value={"status": "success", "evidence": {}}), \
             patch("app.agent.fallback.trace_funds", return_value={"status": "success", "summary": "Traced 1 hop.", "evidence": {}}), \
             patch("app.agent.fallback.find_similar_cases", return_value={"status": "success", "items": [{"case_id": "CASE_OLD_2", "outcome": "escalate"}]}), \
             patch("app.agent.fallback.record_finding", return_value={"status": "success", "finding_id": "FIND_001", "evidence": {}}), \
             patch("app.agent.fallback.propose_action", side_effect=lambda **kw: {"status": "success", "action_id": "ACT_001", "type": kw.get("type"), "reason": kw.get("reason")}):

            res_b = run_fallback_investigation("CASE_HIST_A")
            self.assertIn("No past dismissals were recorded for this cluster; this absence does not establish suspicious activity", res_b["assessment"]["narrative"])

    # 10. MONITOR recommendations explain available evidence and uncertainty
    def test_monitor_recommendation_explains_evidence_and_uncertainty(self):
        mock_c_res = {
            "status": "success",
            "case_id": "CASE_4bcece643a05",
            "score": 54,
            "patterns": ["fan_out", "bipartite"],
            "hits": [
                {
                    "pattern": "fan_out",
                    "measurements": {
                        "distinct_receivers": 9,
                        "total_outflow": 33040.14,
                        "time_span_seconds": 39.2 * 3600,
                    },
                },
                {
                    "pattern": "bipartite",
                    "measurements": {
                        "source_count": 3,
                        "target_count": 4,
                        "span": 70.9 * 3600,
                    },
                },
            ],
            "accounts": [{"id": f"ACC_{i:05d}", "type": "personal"} for i in range(60)],
            "evidence": {"account_ids": [f"ACC_{i:05d}" for i in range(60)], "tx_ids": []},
        }
        with patch("app.agent.fallback.get_case", return_value=mock_c_res), \
             patch("app.agent.fallback.expand_neighborhood", return_value={"status": "success", "evidence": {}}), \
             patch("app.agent.fallback.trace_funds", return_value={
                 "status": "success",
                 "summary": "Forward trace from ACC_00008 reached 29 accounts across 31 routes within 3 steps and 7 days. Starting total was ₹27,090.93.",
                 "evidence": {"account_ids": ["ACC_00008"]},
             }), \
             patch("app.agent.fallback.find_similar_cases", return_value={
                 "status": "success",
                 "items": [{"case_id": f"CASE_SIM_{i}", "outcome": "escalate"} for i in range(5)],
             }), \
             patch("app.agent.fallback.record_finding", return_value={"status": "success", "finding_id": "FIND_001", "evidence": {}}), \
             patch("app.agent.fallback.propose_action", side_effect=lambda **kw: {"status": "success", "action_id": "ACT_002", "type": kw.get("type"), "reason": kw.get("reason")}):

            res = run_fallback_investigation("CASE_4bcece643a05")
            reason = res["proposed_action"]["reason"]
            self.assertIn("Priority score 54/100 reflects moderate transfer structuring", reason)
            self.assertIn("Ongoing transaction monitoring is recommended", reason)
            self.assertEqual(res["proposed_action"]["type"], "monitor")

    # 11. Validator catches repeated boilerplate disclaimers
    def test_validator_rejects_repeated_disclaimers(self):
        store = EvidenceStore()
        store.add({"case_id": "CASE_TEST", "evidence": {"account_ids": ["ACC_00001"]}})
        text_with_dupe_boilerplate = (
            "CASE_TEST finding 1: ACC_00001 transferred funds. This pattern merits review and does not by itself prove fraud. "
            "Finding 2: ACC_00001 sent more funds. This pattern merits review and does not by itself prove fraud."
        )
        res = validate_evidence_ids(text_with_dupe_boilerplate, store)
        self.assertFalse(res.is_valid)
        self.assertIn("repeated boilerplate disclaimer", res.error_message)

    # 12. Full fallback and mocked LLM loop compatibility
    def test_llm_and_fallback_compatibility(self):
        fake_fallback = {
            "status": "done",
            "mode": "fallback",
            "assessment": {
                "risk_level": "medium",
                "summary": "Investigation completed for CASE_COMPAT.",
                "narrative": "Structured narrative for CASE_COMPAT.",
                "findings": [],
            },
            "proposed_action": {
                "type": "monitor",
                "reason": "Moderate risk pattern under observation.",
            },
        }
        with patch("app.agent.loop.llm.is_llm_available", return_value=False), \
             patch("app.agent.loop.run_fallback_investigation", return_value=fake_fallback):

            res = run_investigation("CASE_COMPAT")
            self.assertEqual(res["status"], "done")
            self.assertEqual(res["mode"], "fallback")
            self.assertIn("risk_level", res["assessment"])
            self.assertIn("summary", res["assessment"])
            self.assertIn("narrative", res["assessment"])
            self.assertIn("findings", res["assessment"])
            self.assertIn("type", res["proposed_action"])
            self.assertIn("reason", res["proposed_action"])


if __name__ == "__main__":
    unittest.main()
