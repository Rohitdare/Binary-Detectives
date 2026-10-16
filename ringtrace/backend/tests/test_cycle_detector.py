"""Comprehensive automated tests for RingTrace Cycle Detection.

Tests run against an isolated synthetic test graph in FalkorDB, ensuring
production graphs ('txn', 'labels') remain completely untouched.
"""
import inspect
import os
import sys
import unittest
import uuid
from types import SimpleNamespace

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from fastapi.testclient import TestClient
from app.db import FalkorDBClient
from app.detectors import cycle as cycle_module
from app.detectors.cycle import (
    canonicalize_cycle_edges,
    check_time_ordering,
    detect_cycles,
)
from app.main import app


class TestCycleDetector(unittest.TestCase):
    """Test suite covering cycle detection algorithms, boundaries, and API integration."""

    test_graph_name: str
    db: FalkorDBClient

    @classmethod
    def setUpClass(cls):
        cls.db = FalkorDBClient()
        cls.test_graph_name = f"test_cycles_{uuid.uuid4().hex[:8]}"

        # Setup isolated test graph topology:
        # 1. Directed 3-cycle: N1 -> N2 -> N3 -> N1 (time-ordered: 1000 -> 2000 -> 3000)
        # 2. Directed 4-cycle: M1 -> M2 -> M3 -> M4 -> M1 (time-ordered: 5000 -> 6000 -> 7000 -> 8000)
        # 3. Directed open chain (no return): C1 -> C2 -> C3 -> C4
        # 4. Same accounts reverse cycle: R1 -> R2 -> R3 -> R1 AND R1 -> R3 -> R2 -> R1
        # 5. Parallel edge cycle: P1 -> P2 -> P3 -> P1 (with two alternative edges for P1->P2)
        # 6. Zero-amount cycle: Z1 -> Z2 -> Z3 -> Z1 (with amount 0.0)
        setup_nodes = """
        CREATE (:Account {id: 'N1'}), (:Account {id: 'N2'}), (:Account {id: 'N3'}),
               (:Account {id: 'M1'}), (:Account {id: 'M2'}), (:Account {id: 'M3'}), (:Account {id: 'M4'}),
               (:Account {id: 'C1'}), (:Account {id: 'C2'}), (:Account {id: 'C3'}), (:Account {id: 'C4'}),
               (:Account {id: 'R1'}), (:Account {id: 'R2'}), (:Account {id: 'R3'}),
               (:Account {id: 'P1'}), (:Account {id: 'P2'}), (:Account {id: 'P3'}),
               (:Account {id: 'Z1'}), (:Account {id: 'Z2'}), (:Account {id: 'Z3'})
        """
        cls.db.execute_query(cls.test_graph_name, setup_nodes, caller="test:setup_nodes")

        # 1. 3-cycle: N1 -> N2 -> N3 -> N1
        edges_3_cycle = """
        MATCH (n1:Account {id: 'N1'}), (n2:Account {id: 'N2'}), (n3:Account {id: 'N3'})
        CREATE (n1)-[:SENT {tx_id: 'TX_N1_N2', amount: 5000.0, ts: 1000, step: 1, tx_type: 'UPI'}]->(n2),
               (n2)-[:SENT {tx_id: 'TX_N2_N3', amount: 4800.0, ts: 2000, step: 1, tx_type: 'NEFT'}]->(n3),
               (n3)-[:SENT {tx_id: 'TX_N3_N1', amount: 4600.0, ts: 3000, step: 2, tx_type: 'IMPS'}]->(n1)
        """
        cls.db.execute_query(cls.test_graph_name, edges_3_cycle, caller="test:setup_3_cycle")

        # 2. 4-cycle: M1 -> M2 -> M3 -> M4 -> M1
        edges_4_cycle = """
        MATCH (m1:Account {id: 'M1'}), (m2:Account {id: 'M2'}), (m3:Account {id: 'M3'}), (m4:Account {id: 'M4'})
        CREATE (m1)-[:SENT {tx_id: 'TX_M1_M2', amount: 10000.0, ts: 5000, step: 3, tx_type: 'RTGS'}]->(m2),
               (m2)-[:SENT {tx_id: 'TX_M2_M3', amount: 9500.0, ts: 6000, step: 3, tx_type: 'RTGS'}]->(m3),
               (m3)-[:SENT {tx_id: 'TX_M3_M4', amount: 9200.0, ts: 7000, step: 4, tx_type: 'RTGS'}]->(m4),
               (m4)-[:SENT {tx_id: 'TX_M4_M1', amount: 9000.0, ts: 8000, step: 4, tx_type: 'RTGS'}]->(m1)
        """
        cls.db.execute_query(cls.test_graph_name, edges_4_cycle, caller="test:setup_4_cycle")

        # 3. Open chain: C1 -> C2 -> C3 -> C4
        edges_chain = """
        MATCH (c1:Account {id: 'C1'}), (c2:Account {id: 'C2'}), (c3:Account {id: 'C3'}), (c4:Account {id: 'C4'})
        CREATE (c1)-[:SENT {tx_id: 'TX_C1_C2', amount: 100.0, ts: 100, step: 0, tx_type: 'UPI'}]->(c2),
               (c2)-[:SENT {tx_id: 'TX_C2_C3', amount: 90.0, ts: 200, step: 0, tx_type: 'UPI'}]->(c3),
               (c3)-[:SENT {tx_id: 'TX_C3_C4', amount: 80.0, ts: 300, step: 0, tx_type: 'UPI'}]->(c4)
        """
        cls.db.execute_query(cls.test_graph_name, edges_chain, caller="test:setup_chain")

        # 4. Opposite direction cycles on same accounts R1, R2, R3
        # Forward: R1 -> R2 -> R3 -> R1
        # Reverse: R1 -> R3 -> R2 -> R1
        edges_opposite = """
        MATCH (r1:Account {id: 'R1'}), (r2:Account {id: 'R2'}), (r3:Account {id: 'R3'})
        CREATE (r1)-[:SENT {tx_id: 'TX_R1_R2', amount: 2000.0, ts: 10000, step: 5, tx_type: 'UPI'}]->(r2),
               (r2)-[:SENT {tx_id: 'TX_R2_R3', amount: 1950.0, ts: 11000, step: 5, tx_type: 'UPI'}]->(r3),
               (r3)-[:SENT {tx_id: 'TX_R3_R1', amount: 1900.0, ts: 12000, step: 5, tx_type: 'UPI'}]->(r1),
               (r1)-[:SENT {tx_id: 'TX_R1_R3', amount: 3000.0, ts: 20000, step: 6, tx_type: 'NEFT'}]->(r3),
               (r3)-[:SENT {tx_id: 'TX_R3_R2', amount: 2900.0, ts: 21000, step: 6, tx_type: 'NEFT'}]->(r2),
               (r2)-[:SENT {tx_id: 'TX_R2_R1', amount: 2800.0, ts: 22000, step: 6, tx_type: 'NEFT'}]->(r1)
        """
        cls.db.execute_query(cls.test_graph_name, edges_opposite, caller="test:setup_opposite")

        # 5. Parallel edge cycle: P1 -> P2 -> P3 -> P1
        edges_parallel = """
        MATCH (p1:Account {id: 'P1'}), (p2:Account {id: 'P2'}), (p3:Account {id: 'P3'})
        CREATE (p1)-[:SENT {tx_id: 'TX_P1_P2_A', amount: 4000.0, ts: 30000, step: 7, tx_type: 'UPI'}]->(p2),
               (p1)-[:SENT {tx_id: 'TX_P1_P2_B', amount: 4000.0, ts: 30100, step: 7, tx_type: 'UPI'}]->(p2),
               (p2)-[:SENT {tx_id: 'TX_P2_P3', amount: 3900.0, ts: 31000, step: 7, tx_type: 'UPI'}]->(p3),
               (p3)-[:SENT {tx_id: 'TX_P3_P1', amount: 3800.0, ts: 32000, step: 7, tx_type: 'UPI'}]->(p1)
        """
        cls.db.execute_query(cls.test_graph_name, edges_parallel, caller="test:setup_parallel")

        # 6. Zero/missing amount cycle: Z1 -> Z2 -> Z3 -> Z1
        edges_zero = """
        MATCH (z1:Account {id: 'Z1'}), (z2:Account {id: 'Z2'}), (z3:Account {id: 'Z3'})
        CREATE (z1)-[:SENT {tx_id: 'TX_Z1_Z2', amount: 0.0, ts: 40000, step: 8, tx_type: 'UPI'}]->(z2),
               (z2)-[:SENT {tx_id: 'TX_Z2_Z3', amount: 50.0, ts: 41000, step: 8, tx_type: 'UPI'}]->(z3),
               (z3)-[:SENT {tx_id: 'TX_Z3_Z1', amount: 45.0, ts: 42000, step: 8, tx_type: 'UPI'}]->(z1)
        """
        cls.db.execute_query(cls.test_graph_name, edges_zero, caller="test:setup_zero")

    @classmethod
    def tearDownClass(cls):
        # Clean up only the isolated test graph
        try:
            cls.db.delete_graph(cls.test_graph_name, caller="test:teardown")
        except Exception:
            pass

    def test_01_known_3_cycle_detected(self):
        """1. A known directed three-account cycle is detected with complete evidence."""
        cycles = detect_cycles(
            min_length=3, max_length=3, limit=10, graph_name=self.test_graph_name, db=self.db
        )
        c = next((x for x in cycles if "N1" in x["accounts"]), None)
        self.assertIsNotNone(c, "Expected known cycle on N1, N2, N3 to be detected")
        self.assertEqual(c["cycle_length"], 3)
        self.assertEqual(c["pattern_type"], "cycle")
        self.assertEqual(c["candidate_type"], "cycle_candidate")
        self.assertEqual(c["total_flow"], 14400.0)
        self.assertEqual(c["time_span"], 2000)
        self.assertAlmostEqual(c["retention"], 4600.0 / 5000.0, places=2)
        self.assertAlmostEqual(c["amount_conservation_ratio"], 4600.0 / 5000.0, places=2)

    def test_02_chain_with_no_return_edge_not_reported(self):
        """2. A directed chain with no return edge is NOT reported as a cycle."""
        cycles = detect_cycles(
            min_length=3, max_length=5, limit=50, graph_name=self.test_graph_name, db=self.db
        )
        all_accounts = [acc for c in cycles for acc in c["accounts"]]
        for chain_node in ("C1", "C2", "C3", "C4"):
            self.assertNotIn(chain_node, all_accounts)

    def test_03_same_cycle_from_different_starts_gives_one_candidate(self):
        """3. Canonical edge rotation maps cyclic permutations to exactly one candidate."""
        # Test unit function directly
        e1 = [
            {"tx_id": "TX_B", "src": "B", "dst": "C"},
            {"tx_id": "TX_C", "src": "C", "dst": "A"},
            {"tx_id": "TX_A", "src": "A", "dst": "B"},
        ]
        e2 = [
            {"tx_id": "TX_A", "src": "A", "dst": "B"},
            {"tx_id": "TX_B", "src": "B", "dst": "C"},
            {"tx_id": "TX_C", "src": "C", "dst": "A"},
        ]
        r1, a1, id1 = canonicalize_cycle_edges(e1)
        r2, a2, id2 = canonicalize_cycle_edges(e2)
        self.assertEqual(id1, id2)
        self.assertEqual(a1, ["A", "B", "C"])
        self.assertEqual([e["tx_id"] for e in r1], ["TX_A", "TX_B", "TX_C"])

    def test_04_different_directed_cycles_same_accounts_stay_separate(self):
        """4. Different directed cycles on the same account set stay separate."""
        cycles = detect_cycles(
            min_length=3, max_length=3, limit=50, graph_name=self.test_graph_name, db=self.db
        )
        r_cycles = [c for c in cycles if set(c["accounts"]) == {"R1", "R2", "R3"}]
        self.assertEqual(len(r_cycles), 2, "Expected 2 distinct directed cycles on {R1, R2, R3}")
        c_ids = {c["cycle_id"] for c in r_cycles}
        self.assertEqual(len(c_ids), 2, "Each cycle must have a unique canonical ID")

    def test_05_multiple_transactions_between_same_accounts(self):
        """5. Parallel transactions create distinct candidate entries."""
        cycles = detect_cycles(
            min_length=3, max_length=3, limit=50, graph_name=self.test_graph_name, db=self.db
        )
        p_cycles = [c for c in cycles if set(c["accounts"]) == {"P1", "P2", "P3"}]
        self.assertEqual(len(p_cycles), 2, "Expected 2 candidates due to parallel edge on P1->P2")
        edge_sets = [{t["tx_id"] for t in c["transactions"]} for c in p_cycles]
        self.assertIn("TX_P1_P2_A", edge_sets[0] | edge_sets[1])
        self.assertIn("TX_P1_P2_B", edge_sets[0] | edge_sets[1])

    def test_06_length_filtering_and_bounds_validation(self):
        """6. Length bounds are enforced and invalid parameters are rejected with 422/ValueError."""
        # 4-cycle query finds M1..M4, excludes N1..N3
        c4 = detect_cycles(
            min_length=4, max_length=4, limit=10, graph_name=self.test_graph_name, db=self.db
        )
        self.assertTrue(all(c["cycle_length"] == 4 for c in c4))

        # Invalid bounds raise ValueError
        with self.assertRaises(ValueError):
            detect_cycles(min_length=2)
        with self.assertRaises(ValueError):
            detect_cycles(max_length=6)
        with self.assertRaises(ValueError):
            detect_cycles(min_length=5, max_length=4)

    def test_07_zero_or_missing_amount_guarded(self):
        """7. Edges with non-positive amounts are safely excluded and never divide by zero."""
        cycles = detect_cycles(
            min_length=3, max_length=5, limit=50, graph_name=self.test_graph_name, db=self.db
        )
        all_accounts = [acc for c in cycles for acc in c["accounts"]]
        for z_node in ("Z1", "Z2", "Z3"):
            self.assertNotIn(z_node, all_accounts, "Cycle with 0-amount edge should be skipped")

    def test_08_empty_graph_and_db_failure_handling(self):
        """8. Empty graphs return empty list; DB failures raise a clean exception."""
        empty_graph = f"test_empty_{uuid.uuid4().hex[:8]}"
        try:
            self.db.execute_query(empty_graph, "RETURN 1", caller="test:init_empty")
            cycles = detect_cycles(
                min_length=3, max_length=5, limit=10, graph_name=empty_graph, db=self.db
            )
            self.assertEqual(cycles, [])
        finally:
            self.db.delete_graph(empty_graph, caller="test:cleanup_empty")

        from unittest.mock import MagicMock
        mock_client = MagicMock()
        mock_client.execute_query.side_effect = ConnectionError("FalkorDB unavailable")
        with self.assertRaises(ConnectionError):
            detect_cycles(min_length=3, max_length=3, limit=10, graph_name="txn", db=mock_client)

    def test_09_result_limit_and_truncation_flag(self):
        """9. Result limit is strictly respected and sets truncation flag accurately."""
        # There are multiple cycles in test graph; limit=1 must cap and flag truncated
        res = detect_cycles(
            min_length=3, max_length=5, limit=1, graph_name=self.test_graph_name, db=self.db
        )
        self.assertEqual(len(res), 1)
        self.assertTrue(res.truncated)
        self.assertEqual(res.truncation_reason, "result_limit")

    def test_10_api_evidence_matches_graph_component(self):
        """10. API response provides ordered edges matching frontend graph requirements."""
        client = TestClient(app)
        res = client.get(f"/api/detectors/cycles?min_length=3&max_length=3&limit=5")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertIn("truncated", data)
        self.assertIn("truncation_reason", data)
        self.assertIn("cycles", data)

        for c in data["cycles"]:
            self.assertIn("cycle_id", c)
            self.assertIn("accounts", c)
            self.assertIn("transactions", c)
            self.assertIn("total_flow", c)
            self.assertIn("time_span", c)
            self.assertIn("retention", c)
            for tx in c["transactions"]:
                self.assertIn("tx_id", tx)
                self.assertIn("src", tx)
                self.assertIn("dst", tx)
                self.assertIn("amount", tx)
                self.assertIn("ts", tx)
                self.assertIn("tx_type", tx)

    def test_11_detector_never_touches_ground_truth(self):
        """11. Detection module does not reference 'labels' graph or 'alerts*.csv'."""
        source = inspect.getsource(cycle_module)
        self.assertNotIn("labels", source.lower(), "Detector must never reference labels graph")
        self.assertNotIn("alerts.csv", source, "Detector must never reference alerts.csv")
        self.assertNotIn("alert_accounts.csv", source, "Detector must never reference alert_accounts.csv")
        self.assertNotIn("alert_transactions.csv", source, "Detector must never reference alert_transactions.csv")

    def test_12_cycle_classifies_fast_candidate_as_suspicious_with_evidence(self):
        """Fast cycles are review candidates and retain their actual transactions."""
        from unittest.mock import MagicMock

        client = MagicMock()
        client.execute_query.return_value = SimpleNamespace(result_set=[
            ["A", "B", "TX_AB", 10000, 1000, 1, "UPI"],
            ["B", "C", "TX_BC", 9500, 2000, 1, "UPI"],
            ["C", "A", "TX_CA", 9000, 3000, 1, "UPI"],
        ])
        results = detect_cycles(min_length=3, max_length=3, db=client)

        self.assertEqual(len(results), 1)
        self.assertTrue(results[0]["suspicious"])
        self.assertEqual({tx["tx_id"] for tx in results[0]["transactions"]}, {"TX_AB", "TX_BC", "TX_CA"})
        self.assertIn("review criteria", results[0]["explanation"])
        self.assertEqual(results.edges_scanned, 3)
        query, params = client.execute_query.call_args.args[1:3]
        self.assertIn("LIMIT $limit", query)
        self.assertGreater(params["limit"], 3)

    def test_13_slow_cycle_is_reported_but_not_marked_suspicious(self):
        """A slow look-alike remains visible without being called suspicious."""
        from unittest.mock import MagicMock

        client = MagicMock()
        client.execute_query.return_value = SimpleNamespace(result_set=[
            ["A", "B", "TX_AB", 10000, 1000, 1, "UPI"],
            ["B", "C", "TX_BC", 9500, 45500, 1, "UPI"],
            ["C", "A", "TX_CA", 9000, 91000, 1, "UPI"],
        ])
        results = detect_cycles(min_length=3, max_length=3, db=client)

        self.assertEqual(len(results), 1)
        self.assertFalse(results[0]["suspicious"])
        self.assertIn("cycle candidate only", results[0]["explanation"])


if __name__ == "__main__":
    unittest.main()
