"""Phase 3: Case Identity and Memory-Graph Persistence Tests — RingTrace Member A.

Tests verify stable case identity, deterministic signatures, idempotent persistence,
Member A owned schema constraints, and zero overwrite of Member B's data/decisions.
All tests execute against isolated, throwaway test graphs (test_persist_<uuid>).
"""
import json
import os
import sys
import unittest
import uuid
from typing import Any, Dict, List

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(TESTS_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.cases.builder import build_cases, persist_cases
from app.cases.scorer import score_case
from app.db import FalkorDBClient
from app.queries import GET_CASE_BY_ID, GET_CASE_HITS, GET_CASE_DECISIONS


def make_hit(
    hit_id: str,
    pattern: str,
    accounts: List[str],
    tx_ids: List[str],
    ts: int = 1_700_000_000,
    amount: float = 50_000.0,
    measurements: Dict[str, Any] | None = None,
    explanation: str = "Test detection hit",
) -> Dict[str, Any]:
    """Helper to generate well-formed detector hits matching the contract."""
    transactions = [
        {
            "tx_id": tid,
            "src": accounts[i % len(accounts)],
            "dst": accounts[(i + 1) % len(accounts)],
            "amount": amount,
            "ts": ts + i * 3600,
            "step": 1,
            "tx_type": "UPI",
        }
        for i, tid in enumerate(tx_ids)
    ]
    return {
        "hit_id": hit_id,
        "pattern": pattern,
        "account_ids": list(accounts),
        "account_roles": {accounts[0]: "origin", accounts[-1]: "sink"},
        "tx_ids": list(tx_ids),
        "transactions": transactions,
        "measurements": dict(measurements or {"suspicious": True, "confidence": 0.95}),
        "explanation": explanation,
    }


class TestCasePersistence(unittest.TestCase):
    """Test suite verifying Case Identity & Memory-Graph Persistence (Phase 3)."""

    def setUp(self):
        self.db = FalkorDBClient()
        self.graph_name = f"test_persist_{uuid.uuid4().hex[:12]}"

    def tearDown(self):
        try:
            self.db.delete_graph(self.graph_name, caller="test:persistence_cleanup")
        except Exception:
            pass

    def test_01_persisting_case_creates_expected_nodes(self):
        """Requirement 1: Persisting a case creates expected Case, Hit, and AccountRef nodes."""
        hit = make_hit(
            hit_id="HIT_CYC_001",
            pattern="cycle",
            accounts=["ACC_ALPHA", "ACC_BETA"],
            tx_ids=["TX_CYC_1", "TX_CYC_2"],
            measurements={"suspicious": True, "length": 2, "retention_ratio": 0.92},
        )
        built = build_cases([hit])
        cases = built["cases"]
        self.assertEqual(len(cases), 1)
        case = cases[0]

        count = persist_cases(cases, db=self.db, graph_name=self.graph_name)
        self.assertEqual(count, 1)

        # 1. Assert (:Case) node properties
        case_rows = self.db.execute_query(
            self.graph_name,
            "MATCH (c:Case) RETURN c.id, c.patterns, c.score, c.status, c.signature, c.updated_at, c.severity",
            caller="test:assert_case_nodes",
        ).result_set
        self.assertEqual(len(case_rows), 1)
        c_id, c_patterns, c_score, c_status, c_sig, c_updated, c_sev = case_rows[0]
        self.assertEqual(c_id, case["case_id"])
        self.assertEqual(c_patterns, ["cycle"])
        self.assertEqual(c_score, case["score"])
        self.assertEqual(c_status, "open")
        self.assertEqual(c_sig, case["signature"])
        self.assertTrue(c_updated.endswith("Z"))
        self.assertEqual(c_sev, case["severity"])

        # 2. Assert (:Hit) node properties
        hit_rows = self.db.execute_query(
            self.graph_name,
            "MATCH (h:Hit) RETURN h.hit_id, h.pattern, h.tx_ids, h.measurements",
            caller="test:assert_hit_nodes",
        ).result_set
        self.assertEqual(len(hit_rows), 1)
        h_id, h_pat, h_txs, h_meas_raw = hit_rows[0]
        self.assertEqual(h_id, "HIT_CYC_001")
        self.assertEqual(h_pat, "cycle")
        self.assertEqual(sorted(h_txs), ["TX_CYC_1", "TX_CYC_2"])
        h_meas = json.loads(h_meas_raw)
        self.assertTrue(h_meas["suspicious"])
        self.assertEqual(h_meas["length"], 2)
        self.assertEqual(h_meas["retention_ratio"], 0.92)

        # 3. Assert (:AccountRef) nodes
        acc_rows = self.db.execute_query(
            self.graph_name,
            "MATCH (a:AccountRef) RETURN a.id ORDER BY a.id",
            caller="test:assert_account_nodes",
        ).result_set
        self.assertEqual([row[0] for row in acc_rows], ["ACC_ALPHA", "ACC_BETA"])

    def test_02_expected_involves_and_has_hit_relationships_created(self):
        """Requirement 2: Expected INVOLVES and HAS_HIT relationships are created."""
        hit = make_hit(
            hit_id="HIT_RELAY_001",
            pattern="relay_chain",
            accounts=["ACC_1", "ACC_2", "ACC_3"],
            tx_ids=["TX_R1", "TX_R2"],
        )
        built = build_cases([hit])
        persist_cases(built["cases"], db=self.db, graph_name=self.graph_name)
        case_id = built["cases"][0]["case_id"]

        # Check INVOLVES relationships
        involves_rows = self.db.execute_query(
            self.graph_name,
            "MATCH (c:Case {id: $cid})-[r:INVOLVES]->(a:AccountRef) RETURN a.id ORDER BY a.id",
            {"cid": case_id},
            caller="test:assert_involves",
        ).result_set
        self.assertEqual([row[0] for row in involves_rows], ["ACC_1", "ACC_2", "ACC_3"])

        # Check HAS_HIT relationships
        has_hit_rows = self.db.execute_query(
            self.graph_name,
            "MATCH (c:Case {id: $cid})-[r:HAS_HIT]->(h:Hit) RETURN h.hit_id",
            {"cid": case_id},
            caller="test:assert_has_hit",
        ).result_set
        self.assertEqual(len(has_hit_rows), 1)
        self.assertEqual(has_hit_rows[0][0], "HIT_RELAY_001")

    def test_03_persisting_same_case_twice_creates_no_duplicate_nodes_or_relationships(self):
        """Requirement 3: Persisting the same case multiple times creates zero duplicate nodes or edges."""
        hit = make_hit(
            hit_id="HIT_IDEM_1",
            pattern="cycle",
            accounts=["ACC_X", "ACC_Y"],
            tx_ids=["TX_X1"],
        )
        case = build_cases([hit])["cases"][0]

        # Persist 3 times in succession
        for _ in range(3):
            persist_cases([case], db=self.db, graph_name=self.graph_name)

        # Verify exact node counts
        case_count = self.db.execute_query(
            self.graph_name, "MATCH (c:Case) RETURN count(c)", caller="test:count_cases"
        ).result_set[0][0]
        hit_count = self.db.execute_query(
            self.graph_name, "MATCH (h:Hit) RETURN count(h)", caller="test:count_hits"
        ).result_set[0][0]
        acc_count = self.db.execute_query(
            self.graph_name, "MATCH (a:AccountRef) RETURN count(a)", caller="test:count_accs"
        ).result_set[0][0]

        self.assertEqual(case_count, 1)
        self.assertEqual(hit_count, 1)
        self.assertEqual(acc_count, 2)

        # Verify exact relationship counts
        involves_count = self.db.execute_query(
            self.graph_name, "MATCH ()-[r:INVOLVES]->() RETURN count(r)", caller="test:count_involves"
        ).result_set[0][0]
        has_hit_count = self.db.execute_query(
            self.graph_name, "MATCH ()-[r:HAS_HIT]->() RETURN count(r)", caller="test:count_has_hit"
        ).result_set[0][0]

        self.assertEqual(involves_count, 2)
        self.assertEqual(has_hit_count, 1)

    def test_04_case_ids_remain_stable_when_identical_evidence_is_rescanned(self):
        """Requirement 4: Case IDs remain stable when identical evidence is rescanned."""
        hit_a = make_hit("H_A", "cycle", ["ACC_M", "ACC_N"], ["TX_1"])
        hit_b = make_hit("H_B", "relay_chain", ["ACC_N", "ACC_P"], ["TX_2"])

        # Scan 1: input order [hit_a, hit_b]
        res1 = build_cases([hit_a, hit_b])
        # Scan 2: input order reversed [hit_b, hit_a]
        res2 = build_cases([hit_b, hit_a])
        # Scan 3: identical evidence again
        res3 = build_cases([hit_a, hit_b])

        id1 = res1["cases"][0]["case_id"]
        id2 = res2["cases"][0]["case_id"]
        id3 = res3["cases"][0]["case_id"]

        self.assertTrue(id1.startswith("CASE_"))
        self.assertEqual(id1, id2, "Case ID must be order-invariant across identical hit sets.")
        self.assertEqual(id1, id3, "Case ID must be deterministic across repeated scans.")

        # Persist scan 1 then scan 2
        persist_cases(res1["cases"], db=self.db, graph_name=self.graph_name)
        persist_cases(res2["cases"], db=self.db, graph_name=self.graph_name)

        final_cases = self.db.execute_query(
            self.graph_name, "MATCH (c:Case) RETURN c.id", caller="test:stable_ids"
        ).result_set
        self.assertEqual(len(final_cases), 1)
        self.assertEqual(final_cases[0][0], id1)

    def test_05_multiple_distinct_cases_do_not_accidentally_merge(self):
        """Requirement 5: Multiple distinct cases processed in the same scan do not merge."""
        hit_cluster_1 = make_hit("HIT_C1", "cycle", ["ACC_1", "ACC_2"], ["TX_C1"])
        hit_cluster_2 = make_hit("HIT_C2", "fan_in", ["ACC_3", "ACC_4", "ACC_5"], ["TX_C2"])

        built = build_cases([hit_cluster_1, hit_cluster_2])
        self.assertEqual(len(built["cases"]), 2)

        persist_cases(built["cases"], db=self.db, graph_name=self.graph_name)

        # Assert 2 distinct cases exist in FalkorDB
        case_rows = self.db.execute_query(
            self.graph_name, "MATCH (c:Case) RETURN c.id ORDER BY c.id", caller="test:distinct_cases"
        ).result_set
        self.assertEqual(len(case_rows), 2)
        c1_id = next(c["case_id"] for c in built["cases"] if "ACC_1" in c["account_ids"])
        c2_id = next(c["case_id"] for c in built["cases"] if "ACC_3" in c["account_ids"])
        self.assertNotEqual(c1_id, c2_id)

        # Assert no shared Hit nodes between cases
        shared_hits = self.db.execute_query(
            self.graph_name,
            "MATCH (c1:Case)-[:HAS_HIT]->(h:Hit)<-[:HAS_HIT]-(c2:Case) "
            "WHERE c1.id <> c2.id RETURN count(h)",
            caller="test:shared_hits",
        ).result_set[0][0]
        self.assertEqual(shared_hits, 0)

        # Assert no shared AccountRef nodes between distinct clusters
        shared_accs = self.db.execute_query(
            self.graph_name,
            "MATCH (c1:Case)-[:INVOLVES]->(a:AccountRef)<-[:INVOLVES]-(c2:Case) "
            "WHERE c1.id <> c2.id RETURN count(a)",
            caller="test:shared_accs",
        ).result_set[0][0]
        self.assertEqual(shared_accs, 0)

    def test_06_existing_case_evidence_updated_when_new_hits_arrive(self):
        """Requirement 6: Existing case evidence is updated when new hits arrive."""
        hit1 = make_hit("HIT_INITIAL", "cycle", ["ACC_A", "ACC_B"], ["TX_1"], amount=10_000.0)
        case_v1 = build_cases([hit1])["cases"][0]
        initial_score = case_v1["score"]

        persist_cases([case_v1], db=self.db, graph_name=self.graph_name)

        # Second scan discovers additional corroborating pattern on the same accounts
        hit2 = make_hit(
            "HIT_SUBSEQUENT",
            "relay_chain",
            ["ACC_A", "ACC_B"],
            ["TX_2"],
            amount=50_000.0,
            measurements={"retention_ratio": 0.98, "suspicious": True},
        )
        case_v2 = build_cases([hit1, hit2])["cases"][0]

        # Case ID is stable since accounts match
        self.assertEqual(case_v1["case_id"], case_v2["case_id"])
        self.assertIn("relay_chain", case_v2["patterns"])
        self.assertGreater(case_v2["score"], initial_score)

        # Persist updated case
        persist_cases([case_v2], db=self.db, graph_name=self.graph_name)

        # Verify Case node count remains 1
        case_rows = self.db.execute_query(
            self.graph_name,
            "MATCH (c:Case {id: $cid}) RETURN c.patterns, c.score",
            {"cid": case_v1["case_id"]},
            caller="test:updated_case",
        ).result_set
        self.assertEqual(len(case_rows), 1)
        patterns_in_db, score_in_db = case_rows[0]
        self.assertEqual(sorted(patterns_in_db), ["cycle", "relay_chain"])
        self.assertEqual(score_in_db, case_v2["score"])

        # Verify both hits are now linked to the case
        hits_in_db = self.db.execute_query(
            self.graph_name,
            "MATCH (c:Case {id: $cid})-[:HAS_HIT]->(h:Hit) RETURN h.hit_id, h.pattern ORDER BY h.hit_id",
            {"cid": case_v1["case_id"]},
            caller="test:updated_hits",
        ).result_set
        self.assertEqual(len(hits_in_db), 2)
        self.assertEqual([row[0] for row in hits_in_db], ["HIT_INITIAL", "HIT_SUBSEQUENT"])

    def test_07_repeated_hits_and_account_references_no_duplicate_records(self):
        """Requirement 7: Repeated hits and account references do not create duplicate graph records."""
        # Two hits in the same case sharing an account
        hit1 = make_hit("H_SHARE_1", "cycle", ["SHARED_ACC", "ACC_OTHER_1"], ["TX_S1"])
        hit2 = make_hit("H_SHARE_2", "hub_account", ["SHARED_ACC", "ACC_OTHER_2"], ["TX_S2"])

        cases = build_cases([hit1, hit2])["cases"]
        self.assertEqual(len(cases), 1)

        # Persist twice
        persist_cases(cases, db=self.db, graph_name=self.graph_name)
        persist_cases(cases, db=self.db, graph_name=self.graph_name)

        # Assert SHARED_ACC has exactly 1 AccountRef node
        shared_acc_nodes = self.db.execute_query(
            self.graph_name,
            "MATCH (a:AccountRef {id: 'SHARED_ACC'}) RETURN count(a)",
            caller="test:shared_acc_nodes",
        ).result_set[0][0]
        self.assertEqual(shared_acc_nodes, 1)

        # Assert exactly 1 INVOLVES edge from the case to SHARED_ACC
        involves_edges = self.db.execute_query(
            self.graph_name,
            "MATCH (c:Case)-[r:INVOLVES]->(a:AccountRef {id: 'SHARED_ACC'}) RETURN count(r)",
            caller="test:shared_involves",
        ).result_set[0][0]
        self.assertEqual(involves_edges, 1)

        # Assert each hit node is strictly unique
        h1_count = self.db.execute_query(
            self.graph_name,
            "MATCH (h:Hit {hit_id: 'H_SHARE_1'}) RETURN count(h)",
            caller="test:hit1_unique",
        ).result_set[0][0]
        self.assertEqual(h1_count, 1)

    def test_08_scorer_score_and_signature_preserved_correctly(self):
        """Requirement 8: The scorer's score and signature are preserved and queryable."""
        account_types = {"ACC_ORIGIN": "personal", "ACC_DEST": "merchant"}
        hit = make_hit(
            "HIT_SIG_01",
            "fan_in",
            ["ACC_ORIGIN", "ACC_DEST"],
            ["TX_SIG_1"],
            amount=75_000.0,
        )
        built = build_cases([hit], account_types=account_types)
        case = built["cases"][0]

        # Signature format: {sorted_patterns}:{account_type_mix}:{size_bucket}
        expected_sig = "fan_in:merchant:1,personal:1:1-5"
        self.assertEqual(case["signature"], expected_sig)

        persist_cases([case], db=self.db, graph_name=self.graph_name)

        # Read back from graph
        row = self.db.execute_query(
            self.graph_name,
            "MATCH (c:Case {id: $cid}) RETURN c.score, c.signature, c.payload",
            {"cid": case["case_id"]},
            caller="test:score_sig_verify",
        ).result_set[0]

        db_score, db_sig, db_payload_str = row
        self.assertEqual(db_score, case["score"])
        self.assertEqual(db_sig, expected_sig)

        # Verify score breakdown in payload
        payload = json.loads(db_payload_str)
        self.assertIn("score_breakdown", payload)
        bd = payload["score_breakdown"]
        for key in ("severity", "amount", "velocity", "account_count", "corroboration", "total"):
            self.assertIn(key, bd)
        self.assertEqual(bd["total"], case["score"])

    def test_09_member_b_nodes_and_status_not_overwritten(self):
        """Requirement 9: Member B's Decision, Investigation, Finding, and decision status are preserved."""
        hit = make_hit("HIT_B_TEST", "cycle", ["ACC_MEMBER_A", "ACC_MEMBER_B"], ["TX_MB_1"])
        case = build_cases([hit])["cases"][0]
        case_id = case["case_id"]

        # 1. Member A initial persistence -> status = 'open'
        persist_cases([case], db=self.db, graph_name=self.graph_name)

        # 2. Simulate Member B taking decisions and creating nodes
        # Member B escalates the case
        self.db.execute_query(
            self.graph_name,
            "MATCH (c:Case {id: $cid}) SET c.status = 'escalated'",
            {"cid": case_id},
            caller="test:member_b_escalate",
        )
        # Member B records a Decision
        self.db.execute_query(
            self.graph_name,
            "MATCH (c:Case {id: $cid}) "
            "CREATE (d:Decision {decision_id: 'DEC_0001', decision: 'escalate', note: 'High risk shell company cycle', actor: 'analyst_1', ts: '2026-02-12T10:00:00Z'}) "
            "CREATE (c)-[:DECIDED]->(d)",
            {"cid": case_id},
            caller="test:member_b_decision",
        )
        # Member B creates an Investigation with a Finding
        self.db.execute_query(
            self.graph_name,
            "MATCH (c:Case {id: $cid}) "
            "CREATE (inv:Investigation {id: 'INV_0001', ts: '2026-02-12T10:05:00Z', assessment: 'Confirmed shell activity'}) "
            "CREATE (inv)-[:ABOUT]->(c) "
            "CREATE (f:Finding {id: 'FIND_0001', text: 'Circular flow without commercial purpose', evidence_ids: ['TX_MB_1']}) "
            "CREATE (inv)-[:FOUND]->(f)",
            {"cid": case_id},
            caller="test:member_b_investigation",
        )

        # 3. Member A rescans / persists detection updates
        persist_cases([case], db=self.db, graph_name=self.graph_name)

        # 4. Assert Member B's status was NOT reset to 'open'
        status_in_db = self.db.execute_query(
            self.graph_name,
            "MATCH (c:Case {id: $cid}) RETURN c.status",
            {"cid": case_id},
            caller="test:assert_status_preserved",
        ).result_set[0][0]
        self.assertEqual(status_in_db, "escalated", "Member B status update must NEVER be overwritten by rescans.")

        # 5. Assert Decision node and relationship remain intact
        dec_rows = self.db.execute_query(
            self.graph_name,
            "MATCH (c:Case {id: $cid})-[:DECIDED]->(d:Decision) RETURN d.decision_id, d.decision, d.actor",
            {"cid": case_id},
            caller="test:assert_decision_intact",
        ).result_set
        self.assertEqual(len(dec_rows), 1)
        self.assertEqual(dec_rows[0], ["DEC_0001", "escalate", "analyst_1"])

        # 6. Assert Investigation node and relationships remain intact
        inv_rows = self.db.execute_query(
            self.graph_name,
            "MATCH (inv:Investigation)-[:ABOUT]->(c:Case {id: $cid}) RETURN inv.id, inv.assessment",
            {"cid": case_id},
            caller="test:assert_inv_intact",
        ).result_set
        self.assertEqual(len(inv_rows), 1)
        self.assertEqual(inv_rows[0], ["INV_0001", "Confirmed shell activity"])

        # 7. Assert Finding node and relationship remain intact
        find_rows = self.db.execute_query(
            self.graph_name,
            "MATCH (:Investigation {id: 'INV_0001'})-[:FOUND]->(f:Finding) RETURN f.id, f.text",
            caller="test:assert_finding_intact",
        ).result_set
        self.assertEqual(len(find_rows), 1)
        self.assertEqual(find_rows[0], ["FIND_0001", "Circular flow without commercial purpose"])

    def test_10_invalid_or_empty_persistence_error_handling(self):
        """Requirement 10: Invalid or empty persistence handled per project error conventions."""
        # 1. Empty cases iterable returns 0 safely without error or queries
        count = persist_cases([], db=self.db, graph_name=self.graph_name)
        self.assertEqual(count, 0)

        hit = make_hit("HIT_ERR", "cycle", ["A", "B"], ["TX_E"])
        case = build_cases([hit])["cases"][0]

        # 2. Connection failure to unresolvable host raises Exception per FalkorDB client
        with self.assertRaises(Exception):
            bad_client = FalkorDBClient(host="invalid-host-unresolvable", port=6379)
            persist_cases([case], db=bad_client, graph_name=self.graph_name)

        # 3. Query failure during persistence propagates error per database client convention
        from unittest.mock import patch
        with patch.object(self.db, "execute_query", side_effect=RuntimeError("FalkorDB transaction timeout")):
            with self.assertRaises(RuntimeError):
                persist_cases([case], db=self.db, graph_name=self.graph_name)


if __name__ == "__main__":
    unittest.main()
