"""Pure tests for evidence collection and plain-language validation."""
import os
import sys
import unittest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.agent.evidence import EvidenceStore
from app.agent.plain_language import describe_pattern, find_jargon
from app.agent.validator import validate_evidence_ids


class PlainLanguageEvidenceTests(unittest.TestCase):
    def test_cycle_and_other_pattern_templates_use_measured_values(self):
        cycle = describe_pattern("cycle", {
            "cycle_length": 4,
            "duration_seconds": 7200,
            "amount_conservation_ratio": 0.91,
        })
        self.assertIn("3 intermediary accounts", cycle)
        self.assertIn("2 hours", cycle)
        self.assertIn("91%", cycle)
        self.assertEqual(find_jargon(cycle), [])

        fan_out = describe_pattern("fan_out", {"distinct_receivers": 5, "total_outflow": 1250.5, "time_span_seconds": 3600})
        self.assertIn("5 recipient accounts", fan_out)
        self.assertIn("₹1,250.50", fan_out)
        self.assertEqual(find_jargon(fan_out), [])

    def test_missing_measurements_return_generic_plain_sentence(self):
        description = describe_pattern("cycle", {})
        self.assertIn("Circular fund movement", description)
        self.assertEqual(find_jargon(description), [])

    def test_evidence_store_validates_ids_amounts_and_sar_ids(self):
        evidence = EvidenceStore()
        evidence.add({
            "case_id": "CASE_0001",
            "evidence": {"account_ids": ["ACC_00001"], "tx_ids": ["TX_0000001"]},
            "sar_id": "SAR_ab12cd34",
            "total_amount": 120000,
        })
        self.assertTrue(validate_evidence_ids(
            "CASE_0001 shows ACC_00001 sent ₹1,20,000 in TX_0000001; prior SAR_ab12cd34 is attached.", evidence
        ).is_valid)
        invalid = validate_evidence_ids("ACC_99999 sent ₹9,999 in TX_9999999.", evidence)
        self.assertFalse(invalid.is_valid)
        self.assertIn("ACC_99999", invalid.hallucinated_ids)
        self.assertIn("9,999", invalid.hallucinated_amounts)

    def test_unverified_error_text_does_not_authorize_echoed_ids(self):
        evidence = EvidenceStore()
        evidence.add({"status": "error", "error": "Account ACC_99999 not found"})
        self.assertFalse(evidence.has_id("ACC_99999"))


if __name__ == "__main__":
    unittest.main()
