"""Automated test suite for RingTrace Fan-In and Fan-Out Detectors.

Runs all assertions against isolated synthetic test graphs in FalkorDB, ensuring
production graphs ('txn', 'labels') remain completely untouched.
"""
import json
import os
import sys
import unittest
import uuid

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.db import FalkorDBClient
from app.detectors.fan_in import (
    detect_fan_in,
    evaluate_fan_in_suspicion,
    extract_fan_in_bursts,
)
from app.detectors.fan_out import (
    check_empirical_payroll_recurrence,
    detect_fan_out,
    evaluate_fan_out_suspicion,
    extract_fan_out_bursts,
)

FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


def load_fixture_data(filename: str) -> dict:
    with open(os.path.join(FIXTURES_DIR, filename), "r", encoding="utf-8") as f:
        return json.load(f)


def populate_test_graph(db: FalkorDBClient, graph_name: str, fixture: dict):
    # Create accounts
    accounts = fixture["accounts"]
    acc_rows = [{"id": a["id"], "type": a.get("type", "personal"), "community": a.get("community", 1)} for a in accounts]
    merge_accs = (
        "UNWIND $rows AS r "
        "MERGE (a:Account {id: r.id}) "
        "SET a.type = r.type, a.community = r.community"
    )
    db.execute_query(graph_name, merge_accs, {"rows": acc_rows}, caller="test:setup_accounts")

    # Create transactions
    txs = fixture["transactions"]
    tx_rows = [
        {
            "tx_id": t["tx_id"],
            "src": t["src"],
            "dst": t["dst"],
            "amount": float(t["amount"]),
            "ts": int(t["ts"]),
            "step": int(t.get("step", 1)),
            "tx_type": t.get("tx_type", "UPI"),
        }
        for t in txs
    ]
    merge_txs = (
        "UNWIND $rows AS r "
        "MATCH (src:Account {id: r.src}), (dst:Account {id: r.dst}) "
        "MERGE (src)-[t:SENT {tx_id: r.tx_id}]->(dst) "
        "SET t.amount = r.amount, t.ts = r.ts, t.step = r.step, t.tx_type = r.tx_type"
    )
    db.execute_query(graph_name, merge_txs, {"rows": tx_rows}, caller="test:setup_transactions")


class TestFanDetectors(unittest.TestCase):
    """Test suite covering fan_in and fan_out detection on isolated graphs."""

    @classmethod
    def setUpClass(cls):
        cls.db = FalkorDBClient()

    def test_fan_in_positive_fixture(self):
        """Test fan_in with 8 distinct senders, parallel transfers, and structuring amounts."""
        test_graph = f"test_fan_in_pos_{uuid.uuid4().hex[:8]}"
        fixture = load_fixture_data("fan_in_positive.json")
        try:
            populate_test_graph(self.db, test_graph, fixture)

            hits = detect_fan_in(
                min_senders=8,
                window_seconds=172800,
                graph_name=test_graph,
                db=self.db,
            )

            self.assertEqual(len(hits), 1, "Expected exactly 1 fan_in hit.")
            hit = hits[0]
            self.assertEqual(hit["pattern"], "fan_in")
            self.assertIn("SINK_01", hit["account_ids"])
            self.assertEqual(hit["measurements"]["distinct_senders"], 8)
            # TX_IN_01A and TX_IN_01B from SRC_01 both preserved -> total 9 txs
            self.assertEqual(hit["measurements"]["tx_count"], 9)
            self.assertIn("TX_IN_01A", hit["tx_ids"])
            self.assertIn("TX_IN_01B", hit["tx_ids"])
            self.assertEqual({tx["tx_id"] for tx in hit["transactions"]}, set(hit["tx_ids"]))
            self.assertTrue(all({"src", "dst", "amount", "ts", "tx_type"}.issubset(tx) for tx in hit["transactions"]))
            # Structuring share is high (8 out of 9 txs between 42.5k and 49.5k)
            self.assertGreater(hit["measurements"]["structuring_share"], 0.7)
            self.assertTrue(hit["measurements"]["suspicious"])
            self.assertIn("HIT_fan_in_", hit["hit_id"])
        finally:
            self.db.delete_graph(test_graph)

    def test_fan_in_negative_fixture(self):
        """Test negative cases: transfers outside 48h window and insufficient distinct senders."""
        test_graph = f"test_fan_in_neg_{uuid.uuid4().hex[:8]}"
        fixture = load_fixture_data("fan_in_negative.json")
        try:
            populate_test_graph(self.db, test_graph, fixture)

            hits = detect_fan_in(
                min_senders=8,
                window_seconds=172800,
                graph_name=test_graph,
                db=self.db,
            )

            self.assertEqual(len(hits), 0, "Transfers outside window and few senders must yield 0 hits.")
        finally:
            self.db.delete_graph(test_graph)

    def test_fan_in_merchant_benign_classification(self):
        """Test that merchant accounts receiving retail payments are detected with evidence but classified benign."""
        test_graph = f"test_fan_in_mch_{uuid.uuid4().hex[:8]}"
        fixture = load_fixture_data("fan_in_merchant.json")
        try:
            populate_test_graph(self.db, test_graph, fixture)

            hits = detect_fan_in(
                min_senders=8,
                window_seconds=172800,
                graph_name=test_graph,
                db=self.db,
            )

            self.assertEqual(len(hits), 1, "Merchant aggregation must be detected and preserved.")
            hit = hits[0]
            self.assertEqual(hit["measurements"]["receiver_account_type"], "merchant")
            self.assertEqual(hit["measurements"]["structuring_share"], 0.0)
            self.assertFalse(hit["measurements"]["suspicious"], "Merchant with zero structuring must be marked benign.")
        finally:
            self.db.delete_graph(test_graph)

    def test_merchant_fan_in_with_structuring_is_not_exempt(self):
        self.assertTrue(evaluate_fan_in_suspicion(
            receiver_type="merchant",
            distinct_senders=8,
            tx_count=8,
            time_span_seconds=600,
            structuring_share=0.25,
            total_amount=80000.0,
        ))

    def test_fan_out_positive_fixture(self):
        """Test fan_out with 1 origin disbursing to 9 distinct receivers within 6 hours."""
        test_graph = f"test_fan_out_pos_{uuid.uuid4().hex[:8]}"
        fixture = load_fixture_data("fan_out_positive.json")
        try:
            populate_test_graph(self.db, test_graph, fixture)

            hits = detect_fan_out(
                min_receivers=8,
                window_seconds=172800,
                graph_name=test_graph,
                db=self.db,
            )

            self.assertEqual(len(hits), 1, "Expected exactly 1 fan_out hit.")
            hit = hits[0]
            self.assertEqual(hit["pattern"], "fan_out")
            self.assertIn("ORIG_01", hit["account_ids"])
            self.assertEqual(hit["measurements"]["distinct_receivers"], 9)
            # TX_OUT_01A and TX_OUT_01B preserved -> total 10 txs
            self.assertEqual(hit["measurements"]["tx_count"], 10)
            self.assertIn("TX_OUT_01A", hit["tx_ids"])
            self.assertIn("TX_OUT_01B", hit["tx_ids"])
            self.assertEqual({tx["tx_id"] for tx in hit["transactions"]}, set(hit["tx_ids"]))
            self.assertTrue(all({"src", "dst", "amount", "ts", "tx_type"}.issubset(tx) for tx in hit["transactions"]))
            self.assertTrue(hit["measurements"]["suspicious"])
            self.assertFalse(hit["measurements"]["is_recurring_payroll"])
        finally:
            self.db.delete_graph(test_graph)

    def test_fan_out_negative_fixture(self):
        """Test negative cases: disbursements outside 48h window and insufficient distinct receivers."""
        test_graph = f"test_fan_out_neg_{uuid.uuid4().hex[:8]}"
        fixture = load_fixture_data("fan_out_negative.json")
        try:
            populate_test_graph(self.db, test_graph, fixture)

            hits = detect_fan_out(
                min_receivers=8,
                window_seconds=172800,
                graph_name=test_graph,
                db=self.db,
            )

            self.assertEqual(len(hits), 0, "Disbursements outside window or to few receivers must yield 0 hits.")
        finally:
            self.db.delete_graph(test_graph)

    def test_fan_out_recurring_payroll_classification(self):
        """Test empirical payroll recurrence: monthly disbursement batches are recognized and marked benign."""
        test_graph = f"test_fan_out_pay_{uuid.uuid4().hex[:8]}"
        fixture = load_fixture_data("fan_out_payroll.json")
        try:
            populate_test_graph(self.db, test_graph, fixture)

            hits = detect_fan_out(
                min_receivers=8,
                window_seconds=172800,
                graph_name=test_graph,
                db=self.db,
            )

            self.assertGreaterEqual(len(hits), 1, "Payroll batches must be detected and preserved.")
            hit = hits[0]
            self.assertEqual(hit["measurements"]["origin_account_type"], "payroll")
            self.assertTrue(hit["measurements"]["is_recurring_payroll"], "Empirical monthly recurrence must be detected.")
            self.assertFalse(hit["measurements"]["suspicious"], "Verified recurring payroll with no structuring must be benign.")
        finally:
            self.db.delete_graph(test_graph)

    def test_payroll_type_alone_does_not_suppress_rapid_fan_out(self):
        self.assertTrue(evaluate_fan_out_suspicion(
            origin_type="payroll",
            distinct_receivers=8,
            tx_count=8,
            time_span_seconds=600,
            structuring_share=0.0,
            is_recurring_payroll=False,
        ))

    def test_materially_different_payroll_batch_is_not_verified_recurrence(self):
        fixture = load_fixture_data("fan_out_payroll.json")
        history = fixture["transactions"]
        target = [dict(tx, amount=5000.0) for tx in history[8:]]
        self.assertFalse(check_empirical_payroll_recurrence(history, target))

    def test_fan_in_validation_errors(self):
        """Test parameter bounds validation for fan_in."""
        with self.assertRaises(ValueError):
            detect_fan_in(min_senders=1)
        with self.assertRaises(ValueError):
            detect_fan_in(window_seconds=10)
        with self.assertRaises(ValueError):
            detect_fan_in(limit=0)
        with self.assertRaises(ValueError):
            detect_fan_in(limit=500)

    def test_fan_out_validation_errors(self):
        """Test parameter bounds validation for fan_out."""
        with self.assertRaises(ValueError):
            detect_fan_out(min_receivers=1)
        with self.assertRaises(ValueError):
            detect_fan_out(window_seconds=10)
        with self.assertRaises(ValueError):
            detect_fan_out(limit=0)
        with self.assertRaises(ValueError):
            detect_fan_out(limit=500)

    def test_deterministic_deduplication(self):
        """Ensure repeated scans produce identical hit_ids."""
        test_graph = f"test_fan_dedupe_{uuid.uuid4().hex[:8]}"
        fixture = load_fixture_data("fan_in_positive.json")
        try:
            populate_test_graph(self.db, test_graph, fixture)

            hits1 = detect_fan_in(min_senders=8, graph_name=test_graph, db=self.db)
            hits2 = detect_fan_in(min_senders=8, graph_name=test_graph, db=self.db)

            self.assertEqual(len(hits1), 1)
            self.assertEqual(len(hits2), 1)
            self.assertEqual(hits1[0]["hit_id"], hits2[0]["hit_id"])
        finally:
            self.db.delete_graph(test_graph)


if __name__ == "__main__":
    unittest.main()
