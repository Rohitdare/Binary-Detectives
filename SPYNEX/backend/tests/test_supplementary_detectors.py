"""Fixture-backed tests for the three supporting Member A detectors."""
import os
import sys
import unittest
import uuid

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(TESTS_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)
if TESTS_DIR not in sys.path:
    sys.path.insert(0, TESTS_DIR)

from app.db import FalkorDBClient
from app.detectors.bipartite import detect_bipartite
from app.detectors.dense_cluster import detect_dense_clusters
from app.detectors.hub_account import detect_hub_accounts
from test_graph_pattern_detectors import load_fixture, populate_graph


class TestSupplementaryDetectors(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = FalkorDBClient()

    def run_fixture(self, name, detector, **kwargs):
        graph = f"test_support_{uuid.uuid4().hex[:12]}"
        try:
            populate_graph(self.db, graph, load_fixture(name))
            return detector(graph_name=graph, db=self.db, **kwargs)
        finally:
            self.db.delete_graph(graph, caller="test:supplementary_detector_cleanup")

    def test_bipartite_requires_shared_targets_and_returns_evidence(self):
        hits = self.run_fixture("bipartite_positive.json", detect_bipartite)
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["measurements"]["source_count"], 3)
        self.assertEqual(hits[0]["measurements"]["target_count"], 3)
        self.assertEqual(len(hits[0]["tx_ids"]), 9)
        self.assertFalse(self.run_fixture("bipartite_negative.json", detect_bipartite))

    def test_dense_cluster_uses_internal_pair_density(self):
        hits = self.run_fixture("dense_cluster_positive.json", detect_dense_clusters)
        self.assertTrue(hits)
        self.assertEqual(hits[0]["measurements"]["account_count"], 5)
        self.assertEqual(hits[0]["measurements"]["density"], 1.0)
        self.assertFalse(self.run_fixture("dense_cluster_negative.json", detect_dense_clusters,
                                          minimum_density=0.21, min_internal_transactions=1))

    def test_hub_is_a_supporting_non_suspicious_signal_only(self):
        hits = self.run_fixture("hub_account_positive.json", detect_hub_accounts, minimum_z_score=2.5)
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["account_ids"][0], "H")
        self.assertTrue(hits[0]["measurements"]["supporting_signal_only"])
        self.assertFalse(hits[0]["measurements"]["suspicious"])
        self.assertFalse(self.run_fixture("hub_account_negative.json", detect_hub_accounts))


if __name__ == "__main__":
    unittest.main()
