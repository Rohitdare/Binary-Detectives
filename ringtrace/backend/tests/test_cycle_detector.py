"""Comprehensive automated tests for RingTrace Cycle Detection.

Tests run against an isolated synthetic test graph in FalkorDB, ensuring
production graphs ('txn', 'labels') remain completely untouched.
"""
import os
import sys
import unittest
import uuid
from typing import Optional

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from fastapi.testclient import TestClient
from app.db import FalkorDBClient
from app.detectors.cycle import detect_cycles, check_time_ordering
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
        # 1. Directed 3-cycle: N1 -> N2 -> N3 -> N1
        # 2. Directed 4-cycle: M1 -> M2 -> M3 -> M4 -> M1
        # 3. Directed open chain (no return): C1 -> C2 -> C3 -> C4
        setup_cypher = """
        CREATE (:Account {id: 'N1'}), (:Account {id: 'N2'}), (:Account {id: 'N3'}),
               (:Account {id: 'M1'}), (:Account {id: 'M2'}), (:Account {id: 'M3'}), (:Account {id: 'M4'}),
               (:Account {id: 'C1'}), (:Account {id: 'C2'}), (:Account {id: 'C3'}), (:Account {id: 'C4'})
        """
        cls.db.execute_query(cls.test_graph_name, setup_cypher, caller="test:setup_nodes")

        # 3-cycle transactions (time-ordered: 1000 -> 2000 -> 3000)
        edges_3_cycle = """
        MATCH (n1:Account {id: 'N1'}), (n2:Account {id: 'N2'}), (n3:Account {id: 'N3'})
        CREATE (n1)-[:SENT {tx_id: 'TX_N1_N2', amount: 5000.0, ts: 1000, step: 1, tx_type: 'UPI'}]->(n2),
               (n2)-[:SENT {tx_id: 'TX_N2_N3', amount: 4800.0, ts: 2000, step: 1, tx_type: 'NEFT'}]->(n3),
               (n3)-[:SENT {tx_id: 'TX_N3_N1', amount: 4600.0, ts: 3000, step: 2, tx_type: 'IMPS'}]->(n1)
        """
        cls.db.execute_query(cls.test_graph_name, edges_3_cycle, caller="test:setup_3_cycle")

        # 4-cycle transactions (M1 -> M2 -> M3 -> M4 -> M1)
        edges_4_cycle = """
        MATCH (m1:Account {id: 'M1'}), (m2:Account {id: 'M2'}), (m3:Account {id: 'M3'}), (m4:Account {id: 'M4'})
        CREATE (m1)-[:SENT {tx_id: 'TX_M1_M2', amount: 10000.0, ts: 5000, step: 3, tx_type: 'RTGS'}]->(m2),
               (m2)-[:SENT {tx_id: 'TX_M2_M3', amount: 9500.0, ts: 6000, step: 3, tx_type: 'RTGS'}]->(m3),
               (m3)-[:SENT {tx_id: 'TX_M3_M4', amount: 9200.0, ts: 7000, step: 4, tx_type: 'RTGS'}]->(m4),
               (m4)-[:SENT {tx_id: 'TX_M4_M1', amount: 9000.0, ts: 8000, step: 4, tx_type: 'RTGS'}]->(m1)
        """
        cls.db.execute_query(cls.test_graph_name, edges_4_cycle, caller="test:setup_4_cycle")

        # Open chain (no return edge: C1 -> C2 -> C3 -> C4)
        edges_chain = """
        MATCH (c1:Account {id: 'C1'}), (c2:Account {id: 'C2'}), (c3:Account {id: 'C3'}), (c4:Account {id: 'C4'})
        CREATE (c1)-[:SENT {tx_id: 'TX_C1_C2', amount: 100.0, ts: 100, step: 0, tx_type: 'UPI'}]->(c2),
               (c2)-[:SENT {tx_id: 'TX_C2_C3', amount: 90.0, ts: 200, step: 0, tx_type: 'UPI'}]->(c3),
               (c3)-[:SENT {tx_id: 'TX_C3_C4', amount: 80.0, ts: 300, step: 0, tx_type: 'UPI'}]->(c4)
        """
        cls.db.execute_query(cls.test_graph_name, edges_chain, caller="test:setup_chain")

    @classmethod
    def tearDownClass(cls):
        # Clean up only the isolated test graph
        try:
            cls.db.delete_graph(cls.test_graph_name, caller="test:teardown")
        except Exception:
            pass

    def test_01_known_3_cycle_detected(self):
        """1. A known directed three-account cycle is detected."""
        cycles = detect_cycles(min_length=3, max_length=3, limit=10, graph_name=self.test_graph_name, db=self.db)
        self.assertEqual(len(cycles), 1)
        c = cycles[0]
        self.assertEqual(c["cycle_length"], 3)
        self.assertEqual(c["accounts"], ["N1", "N2", "N3"])
        self.assertEqual(c["pattern_type"], "cycle")
        self.assertEqual(c["candidate_type"], "cycle_candidate")

    def test_02_directed_chain_not_reported_as_cycle(self):
        """2. A simple directed chain with no return edge is NOT reported as a cycle."""
        cycles = detect_cycles(min_length=3, max_length=5, limit=50, graph_name=self.test_graph_name, db=self.db)
        all_accounts = [acc for c in cycles for acc in c["accounts"]]
        for chain_node in ("C1", "C2", "C3", "C4"):
            self.assertNotIn(chain_node, all_accounts)

    def test_03_length_filtering(self):
        """3. Cycles shorter or longer than configured bounds are excluded."""
        # Query 4-cycles only: should find M1..M4, exclude N1..N3
        cycles_4 = detect_cycles(min_length=4, max_length=4, limit=10, graph_name=self.test_graph_name, db=self.db)
        self.assertEqual(len(cycles_4), 1)
        self.assertEqual(cycles_4[0]["cycle_length"], 4)
        self.assertEqual(cycles_4[0]["accounts"], ["M1", "M2", "M3", "M4"])

        # Query 3-cycles only: should find N1..N3, exclude M1..M4
        cycles_3 = detect_cycles(min_length=3, max_length=3, limit=10, graph_name=self.test_graph_name, db=self.db)
        self.assertEqual(len(cycles_3), 1)
        self.assertEqual(cycles_3[0]["cycle_length"], 3)
        self.assertEqual(cycles_3[0]["accounts"], ["N1", "N2", "N3"])

    def test_04_limit_respected(self):
        """4. Results respect configured maximum length and result limit."""
        # Both 3-cycle and 4-cycle exist, but limit=1 must cap result to 1
        cycles = detect_cycles(min_length=3, max_length=5, limit=1, graph_name=self.test_graph_name, db=self.db)
        self.assertEqual(len(cycles), 1)

    def test_05_rotational_deduplication(self):
        """5. Rotations of the same directed cycle are not returned as duplicates."""
        cycles = detect_cycles(min_length=3, max_length=3, limit=50, graph_name=self.test_graph_name, db=self.db)
        # In N1->N2->N3->N1, there are 3 possible rotations: N1-N2-N3, N2-N3-N1, N3-N1-N2.
        # Only the canonical rotation (starting with min account ID N1) should be returned once.
        self.assertEqual(len(cycles), 1)
        self.assertEqual(cycles[0]["accounts"][0], "N1")

    def test_06_reported_evidence_integrity(self):
        """6. The reported evidence corresponds to the actual edges in the cycle."""
        cycles = detect_cycles(min_length=3, max_length=3, limit=10, graph_name=self.test_graph_name, db=self.db)
        c = cycles[0]
        txs = c["transactions"]
        self.assertEqual(len(txs), 3)

        tx_ids = [t["tx_id"] for t in txs]
        self.assertEqual(tx_ids, ["TX_N1_N2", "TX_N2_N3", "TX_N3_N1"])

        # Check metrics
        self.assertEqual(c["total_amount"], 14400.0)  # 5000 + 4800 + 4600
        self.assertEqual(c["min_amount"], 4600.0)
        self.assertEqual(c["max_amount"], 5000.0)
        self.assertAlmostEqual(c["amount_conservation_ratio"], 0.92, places=2)
        self.assertTrue(c["is_time_ordered"])  # 1000 <= 2000 <= 3000
        self.assertEqual(c["duration_seconds"], 2000)

    def test_07_empty_graph_returns_empty(self):
        """7. Empty graphs return an empty result without crashing."""
        empty_graph = f"test_empty_{uuid.uuid4().hex[:8]}"
        try:
            self.db.execute_query(empty_graph, "RETURN 1", caller="test:init_empty")
            cycles = detect_cycles(min_length=3, max_length=5, limit=10, graph_name=empty_graph, db=self.db)
            self.assertEqual(cycles, [])
        finally:
            self.db.delete_graph(empty_graph, caller="test:cleanup_empty")

    def test_08_invalid_parameters_rejected(self):
        """8. Invalid parameters are rejected with ValueError."""
        with self.assertRaises(ValueError):
            detect_cycles(min_length=2)  # below 3
        with self.assertRaises(ValueError):
            detect_cycles(max_length=6)  # above 5
        with self.assertRaises(ValueError):
            detect_cycles(min_length=5, max_length=4)  # min > max
        with self.assertRaises(ValueError):
            detect_cycles(limit=0)  # below 1
        with self.assertRaises(ValueError):
            detect_cycles(limit=250)  # above 200

    def test_09_database_failure_handling(self):
        """9. Database failures are handled without crashing."""
        from unittest.mock import MagicMock
        mock_client = MagicMock()
        mock_client.execute_query.side_effect = ConnectionError("FalkorDB connection failed")
        with self.assertRaises(ConnectionError):
            detect_cycles(min_length=3, max_length=3, limit=10, graph_name="txn", db=mock_client)

    def test_10_api_cycle_detector_endpoint(self):
        """10. Verify FastAPI endpoint integration."""
        client = TestClient(app)
        # Valid request
        res = client.get("/api/detectors/cycles?min_length=3&max_length=4&limit=5")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertIn("count", data)
        self.assertIn("cycles", data)
        self.assertIsInstance(data["cycles"], list)

        # Invalid bounds request (min_length > max_length)
        bad_res = client.get("/api/detectors/cycles?min_length=5&max_length=3")
        self.assertEqual(bad_res.status_code, 400)


if __name__ == "__main__":
    unittest.main()
