"""Tests for the memory graph seed (Member B, Step 1).

Uses throwaway graphs (test_txn_mem_*, test_memory_*) built from scratch, so the
live `txn` and `memorygraph` graphs are never touched.
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
from app.memory.graph import memory_counts, wipe_memory_graph
from app.memory.seed import (
    SEED_CASES,
    SeedError,
    compute_signature,
    hit_id_for,
    list_case_summaries,
    seed_memory,
)

# Tiny fake txn graph: a 3-hop cycle A->B->C->A and a payroll P paying X, Y, Z.
ACCOUNTS = [("ACC_90001", "personal"), ("ACC_90002", "personal"), ("ACC_90003", "personal"),
            ("ACC_90010", "payroll"), ("ACC_90011", "personal"), ("ACC_90012", "personal"),
            ("ACC_90013", "personal")]
TXS = [
    ("TX_9000001", "ACC_90001", "ACC_90002", 10000.0, 1000),
    ("TX_9000002", "ACC_90002", "ACC_90003", 9500.0, 2000),
    ("TX_9000003", "ACC_90003", "ACC_90001", 9000.0, 3000),
    ("TX_9000010", "ACC_90010", "ACC_90011", 30000.0, 5000),
    ("TX_9000011", "ACC_90010", "ACC_90012", 31000.0, 5100),
    ("TX_9000012", "ACC_90010", "ACC_90013", 32000.0, 5200),
    ("TX_9000013", "ACC_90010", "ACC_90011", 30000.0, 90000),  # later run, shares accounts
]
TEST_CASES = [
    {"case_id": "CASE_9001", "updated_at": "2026-01-01T00:00:00Z",
     "score_breakdown": {"severity": 30, "amount": 10, "velocity": 15, "account_count": 3, "corroboration": 10},
     "hits": [{"pattern": "cycle", "tx_ids": ["TX_9000001", "TX_9000002", "TX_9000003"]}]},
    {"case_id": "CASE_9002", "updated_at": "2026-01-02T00:00:00Z",
     "score_breakdown": {"severity": 15, "amount": 20, "velocity": 12, "account_count": 4, "corroboration": 0},
     "hits": [{"pattern": "fan_out", "tx_ids": ["TX_9000010", "TX_9000011", "TX_9000012"]}]},
    {"case_id": "CASE_9003", "updated_at": "2026-01-03T00:00:00Z",
     "score_breakdown": {"severity": 15, "amount": 5, "velocity": 5, "account_count": 2, "corroboration": 0},
     "hits": [{"pattern": "fan_out", "tx_ids": ["TX_9000013"]}]},
]


class TestMemorySeed(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = FalkorDBClient()
        suffix = uuid.uuid4().hex[:8]
        cls.txn = f"test_txn_mem_{suffix}"
        cls.mem = f"test_memory_{suffix}"
        cls.db.execute_query(cls.txn, "UNWIND $rows AS r CREATE (:Account {id: r[0], type: r[1]})",
                             {"rows": [list(a) for a in ACCOUNTS]}, caller="test:setup")
        cls.db.execute_query(
            cls.txn,
            "UNWIND $rows AS r MATCH (a:Account {id: r[1]}), (b:Account {id: r[2]}) "
            "CREATE (a)-[:SENT {tx_id: r[0], amount: r[3], ts: r[4], step: 1, tx_type: 'UPI'}]->(b)",
            {"rows": [list(t) for t in TXS]}, caller="test:setup")

    @classmethod
    def tearDownClass(cls):
        cls.db.delete_graph(cls.txn, caller="test:cleanup")
        cls.db.delete_graph(cls.mem, caller="test:cleanup")

    def setUp(self):
        wipe_memory_graph(self.db, self.mem)

    def _seed(self, **kw):
        return seed_memory(self.db, memory_graph=self.mem, txn_graph=self.txn, cases=TEST_CASES, **kw)

    def test_01_seed_creates_cases_hits_and_accounts(self):
        built = self._seed()
        self.assertEqual([c["case_id"] for c in built], ["CASE_9001", "CASE_9002", "CASE_9003"])
        counts = memory_counts(self.db, self.mem)
        self.assertEqual(counts.get("Case"), 3)
        self.assertEqual(counts.get("Hit"), 3)
        # 3 cycle accounts + payroll + 3 recipients; CASE_9003 reuses existing AccountRefs
        self.assertEqual(counts.get("AccountRef"), 7)

    def test_02_seed_is_idempotent(self):
        self._seed()
        first = memory_counts(self.db, self.mem)
        self._seed()
        self.assertEqual(memory_counts(self.db, self.mem), first)

    def test_03_case_fields_and_measurements(self):
        built = {c["case_id"]: c for c in self._seed()}
        cyc = built["CASE_9001"]
        self.assertEqual(cyc["score"], 68)
        self.assertEqual(cyc["status"], "open")
        m = cyc["hits"][0]["measurements"]
        self.assertEqual(m["length"], 3)
        self.assertEqual(m["duration_seconds"], 2000)
        self.assertTrue(m["is_time_ordered"])
        self.assertAlmostEqual(m["amount_conservation_ratio"], 0.9)
        fan = built["CASE_9002"]
        self.assertEqual(fan["signature"], "fan_out|payroll:1,personal:3|s")
        self.assertEqual(fan["hits"][0]["measurements"]["origin_type"], "payroll")
        roles = {a["id"]: a["roles"] for a in fan["accounts"]}
        self.assertEqual(roles["ACC_90010"], ["origin"])
        self.assertEqual(roles["ACC_90011"], ["recipient"])

    def test_04_stored_json_round_trips(self):
        self._seed()
        res = self.db.execute_query(self.mem, "MATCH (c:Case {id:'CASE_9001'})-[:HAS_HIT]->(h:Hit) "
                                    "RETURN c.score_breakdown, h.measurements, h.tx_ids", caller="test")
        breakdown, measurements, tx_ids = res.result_set[0]
        self.assertEqual(json.loads(breakdown)["total"], 68)
        self.assertEqual(json.loads(measurements)["length"], 3)
        self.assertEqual(sorted(tx_ids), ["TX_9000001", "TX_9000002", "TX_9000003"])

    def test_05_shared_account_refs_link_related_cases(self):
        self._seed()
        res = self.db.execute_query(
            self.mem,
            "MATCH (c1:Case {id:'CASE_9002'})-[:INVOLVES]->(a:AccountRef)<-[:INVOLVES]-(c2:Case {id:'CASE_9003'}) "
            "RETURN a.id ORDER BY a.id", caller="test")
        self.assertEqual([r[0] for r in res.result_set], ["ACC_90010", "ACC_90011"])

    def test_06_missing_transaction_raises_and_writes_nothing(self):
        bad = [dict(TEST_CASES[0], hits=[{"pattern": "cycle", "tx_ids": ["TX_9000001", "TX_0000000"]}])]
        with self.assertRaises(SeedError):
            seed_memory(self.db, memory_graph=self.mem, txn_graph=self.txn, cases=bad)
        self.assertEqual(memory_counts(self.db, self.mem), {})

    def test_07_reset_restores_open_status(self):
        self._seed()
        self.db.execute_query(self.mem, "MATCH (c:Case {id:'CASE_9002'}) SET c.status = 'dismissed'", caller="test")
        self._seed(reset=True)
        status = {c["case_id"]: c["status"] for c in list_case_summaries(self.db, self.mem)}
        self.assertEqual(status["CASE_9002"], "open")

    def test_08_wipe_refuses_protected_graphs(self):
        for name in ("txn", "labels"):
            with self.assertRaises(ValueError):
                wipe_memory_graph(self.db, name)

    def test_09_helpers_and_real_seed_spec_shape(self):
        self.assertEqual(hit_id_for("cycle", ["TX_2", "TX_1"]), hit_id_for("cycle", ["TX_1", "TX_2"]))
        self.assertTrue(hit_id_for("cycle", ["TX_1"]).startswith("HIT_cycle_"))
        self.assertEqual(compute_signature(["cycle"], {"A": "personal", "B": "personal"}), "cycle|personal:2|s")
        ids = [c["case_id"] for c in SEED_CASES]
        self.assertEqual(ids, ["CASE_0001", "CASE_0002", "CASE_0003"])
        for c in SEED_CASES:
            for h in c["hits"]:
                self.assertTrue(all(t.startswith("TX_") and len(t) == 10 for t in h["tx_ids"]))


if __name__ == "__main__":
    unittest.main()
