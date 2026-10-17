"""Unit and integration test suite for the 8 MCP Graph Tools (Member B, Step 2)."""
import os
import sys
import unittest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.db import FalkorDBClient
from app.mcp_server.tools import (
    expand_neighborhood,
    find_similar_cases,
    get_case,
    propose_action,
    record_finding,
    run_algorithm,
    shortest_path,
    trace_funds,
)
from app.memory.graph import MEMORY_GRAPH, TXN_GRAPH


class TestMCPTools(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = FalkorDBClient()
        cls.mem_graph = MEMORY_GRAPH
        cls.txn_graph = TXN_GRAPH

    # -----------------------------------------------------------------------
    # Tool 1: get_case tests
    # -----------------------------------------------------------------------
    def test_01_get_case_existing(self):
        res = get_case("CASE_0001", db=self.db, memory_graph=self.mem_graph)
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["case_id"], "CASE_0001")
        self.assertEqual(res["case_status"], "open")
        self.assertGreaterEqual(res["score"], 70)
        self.assertIn("cycle", res["patterns"])
        self.assertGreater(len(res["hits"]), 0)
        self.assertGreater(len(res["accounts"]), 0)
        self.assertIn("evidence", res)
        self.assertIn("ACC_01911", res["evidence"]["account_ids"])

    def test_02_get_case_nonexistent(self):
        res = get_case("CASE_9999", db=self.db, memory_graph=self.mem_graph)
        self.assertEqual(res["status"], "error")
        self.assertIn("does not exist", res["summary"])

    # -----------------------------------------------------------------------
    # Tool 2: expand_neighborhood tests
    # -----------------------------------------------------------------------
    def test_03_expand_neighborhood_1_hop(self):
        res = expand_neighborhood("ACC_01911", hops=1, limit=20, db=self.db, txn_graph=self.txn_graph)
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["account_id"], "ACC_01911")
        self.assertEqual(res["hops"], 1)
        self.assertGreater(len(res["nodes"]), 0)
        self.assertGreater(len(res["edges"]), 0)
        self.assertIn("ACC_01911", res["evidence"]["account_ids"])
        self.assertGreater(len(res["evidence"]["tx_ids"]), 0)

    def test_04_expand_neighborhood_2_hops(self):
        res = expand_neighborhood("ACC_01911", hops=2, limit=20, db=self.db, txn_graph=self.txn_graph)
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["hops"], 2)
        self.assertGreater(res["total_nodes"], 0)

    # -----------------------------------------------------------------------
    # Tool 3: trace_funds tests
    # -----------------------------------------------------------------------
    def test_05_trace_funds_forward(self):
        res = trace_funds("ACC_01911", direction="forward", max_hops=2, db=self.db, txn_graph=self.txn_graph)
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["direction"], "forward")
        self.assertGreater(len(res["reached_accounts"]), 0)
        self.assertIn("paths", res)
        self.assertIn("ACC_01911", res["evidence"]["account_ids"])

    def test_06_trace_funds_backward(self):
        res = trace_funds("ACC_01911", direction="backward", max_hops=2, db=self.db, txn_graph=self.txn_graph)
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["direction"], "backward")
        self.assertIn("total_initial_amount", res)

    # -----------------------------------------------------------------------
    # Tool 4: shortest_path tests
    # -----------------------------------------------------------------------
    def test_07_shortest_path_exists(self):
        # In CASE_0001, ACC_01911 sent to ACC_02464 which sent to ACC_02729
        res = shortest_path("ACC_01911", "ACC_02729", db=self.db, txn_graph=self.txn_graph)
        self.assertEqual(res["status"], "success")
        self.assertTrue(res["found"])
        self.assertGreaterEqual(res["length"], 1)
        self.assertIn("path_nodes", res)
        self.assertIn("TX_0014054", res["evidence"]["tx_ids"])

    def test_08_shortest_path_same_node(self):
        res = shortest_path("ACC_01911", "ACC_01911", db=self.db, txn_graph=self.txn_graph)
        self.assertEqual(res["status"], "success")
        self.assertTrue(res["found"])
        self.assertEqual(res["length"], 0)

    # -----------------------------------------------------------------------
    # Tool 5: run_algorithm tests
    # -----------------------------------------------------------------------
    def test_09_run_algorithm_pagerank(self):
        res = run_algorithm("pagerank", scope=["ACC_01911", "ACC_02464"], db=self.db, txn_graph=self.txn_graph)
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["algorithm"], "pagerank")
        self.assertGreater(len(res["top_ranked"]), 0)

    def test_10_run_algorithm_community(self):
        res = run_algorithm("community", db=self.db, txn_graph=self.txn_graph)
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["algorithm"], "community")
        self.assertGreater(res["cluster_count"], 0)

    def test_11_run_algorithm_invalid(self):
        res = run_algorithm("nonexistent_algo", db=self.db, txn_graph=self.txn_graph)
        self.assertEqual(res["status"], "error")
        self.assertIn("Unsupported algorithm", res["summary"])

    # -----------------------------------------------------------------------
    # Tool 6: find_similar_cases tests
    # -----------------------------------------------------------------------
    def test_12_find_similar_cases(self):
        # CASE_0002 and CASE_0003 share all 15 payroll recipient accounts and origin ACC_02975!
        res = find_similar_cases("CASE_0002", limit=5, db=self.db, memory_graph=self.mem_graph)
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["case_id"], "CASE_0002")
        self.assertGreater(res["similar_count"], 0)
        matched_ids = [item["case_id"] for item in res["items"]]
        self.assertIn("CASE_0003", matched_ids)
        # Check that CASE_0003 was matched via shared_accounts
        match_0003 = next(item for item in res["items"] if item["case_id"] == "CASE_0003")
        self.assertEqual(match_0003["match_type"], "shared_accounts")
        self.assertGreaterEqual(match_0003["shared_count"], 15)

    # -----------------------------------------------------------------------
    # Tool 7: record_finding tests
    # -----------------------------------------------------------------------
    def test_13_record_finding(self):
        finding_text = "Rapid funds circulation: money returned to origin ACC_01911 within 20 hours."
        res = record_finding(
            case_id="CASE_0001",
            text=finding_text,
            evidence_ids=["ACC_01911", "TX_0014054"],
            db=self.db,
            memory_graph=self.mem_graph,
        )
        self.assertEqual(res["status"], "success")
        self.assertTrue(res["finding_id"].startswith("FIND_CASE_0001_"))
        self.assertEqual(res["text"], finding_text)
        self.assertIn("ACC_01911", res["evidence"]["account_ids"])
        self.assertIn("TX_0014054", res["evidence"]["tx_ids"])

    def test_14_record_finding_invalid_case(self):
        res = record_finding("CASE_8888", "Some observation", db=self.db, memory_graph=self.mem_graph)
        self.assertEqual(res["status"], "error")
        self.assertIn("does not exist", res["summary"])

    # -----------------------------------------------------------------------
    # Tool 8: propose_action tests
    # -----------------------------------------------------------------------
    def test_15_propose_action(self):
        res = propose_action(
            case_id="CASE_0001",
            type="escalate",
            reason="High conservation cycle indicates layered placement and layering.",
            db=self.db,
            memory_graph=self.mem_graph,
        )
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["type"], "escalate")
        self.assertEqual(res["action_status"], "pending")
        self.assertTrue(res["action_id"].startswith("ACT_"))

    def test_16_propose_action_invalid_type(self):
        res = propose_action("CASE_0001", "freeze_immediately", "Reason here", db=self.db, memory_graph=self.mem_graph)
        self.assertEqual(res["status"], "error")
        self.assertIn("Invalid action type", res["summary"])


if __name__ == "__main__":
    unittest.main()
