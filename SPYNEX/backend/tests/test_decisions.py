"""Decision normalization and write semantics using an isolated fake client."""
import os
import sys
import unittest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.memory.decisions import (
    DecisionNotFound,
    InvalidVerdict,
    STATUS_FOR,
    Verdict,
    normalize,
    record_decision,
)


class Result:
    def __init__(self, rows):
        self.result_set = rows


class FakeDB:
    def __init__(self, missing=False):
        self.calls = []
        self.missing = missing

    def execute_query(self, graph, query, params, caller):
        self.calls.append((graph, query, params, caller))
        return Result([] if self.missing else [[params["decision_id"]]])


class DecisionServiceTests(unittest.TestCase):
    def test_new_and_legacy_values_normalize_to_enum(self):
        self.assertEqual(normalize("APPROVE_SAR"), Verdict.APPROVE_SAR)
        self.assertEqual(normalize("escalate"), Verdict.APPROVE_SAR)
        self.assertEqual(normalize("dismiss"), Verdict.DISMISS)
        self.assertEqual(normalize("monitor"), Verdict.MONITOR)

    def test_verdict_creates_append_only_node_with_mapped_status(self):
        for verdict, note in ((Verdict.APPROVE_SAR, "reviewed"), (Verdict.DISMISS, "payroll"), (Verdict.MONITOR, "")):
            with self.subTest(verdict=verdict):
                db = FakeDB()
                result = record_decision("CASE_0001", verdict.value, note, db=db)
                self.assertEqual(result["decision"], verdict.value)
                self.assertEqual(len(db.calls), 1)
                query, params = db.calls[0][1], db.calls[0][2]
                self.assertIn("CREATE (d:Decision", query)
                self.assertNotIn("MERGE (d:Decision", query)
                self.assertEqual(params["case_status"], STATUS_FOR[verdict])
                self.assertNotEqual(params["case_status"], "APPROVE_SAR")

    def test_legacy_verdict_is_normalized_before_storage(self):
        db = FakeDB()
        result = record_decision("CASE_0001", "escalate", "reason", db=db)
        self.assertEqual(result["decision"], Verdict.APPROVE_SAR.value)
        self.assertEqual(db.calls[0][2]["decision"], Verdict.APPROVE_SAR.value)
        self.assertEqual(db.calls[0][2]["case_status"], "escalated")

    def test_unknown_verdict_and_required_notes_are_rejected(self):
        with self.assertRaises(InvalidVerdict):
            record_decision("CASE_0001", "unknown", "note", db=FakeDB())
        with self.assertRaises(InvalidVerdict):
            record_decision("CASE_0001", "APPROVE_SAR", "", db=FakeDB())
        with self.assertRaises(InvalidVerdict):
            record_decision("CASE_0001", "DISMISS", "", db=FakeDB())

    def test_missing_case_returns_not_found(self):
        with self.assertRaises(DecisionNotFound):
            record_decision("CASE_missing", "MONITOR", "", db=FakeDB(missing=True))

    def test_repeated_decisions_create_distinct_ids(self):
        db = FakeDB()
        first = record_decision("CASE_0001", "MONITOR", db=db)
        second = record_decision("CASE_0001", "DISMISS", "reviewed", db=db)
        self.assertNotEqual(first["decision_id"], second["decision_id"])
        self.assertEqual(len(db.calls), 2)


if __name__ == "__main__":
    unittest.main()
