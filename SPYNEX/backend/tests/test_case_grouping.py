"""Isolated unit tests for Phase 1 Case Grouping in RingTrace.

Verifies:
1. Two hits sharing an account merge into one group.
2. Three hits connected transitively merge into one group.
3. Two unrelated hits remain in separate groups.
4. Multiple transaction IDs and hit IDs survive grouping unchanged.
5. Repeated account IDs within a hit do not create additional accounts.
6. Empty input returns an empty result.
7. Repeating the same input produces the same grouping.
8. The account cap is tested according to the project's already-agreed policy.

These tests run purely in-memory with zero database or network calls.
"""
import os
import sys
import unittest

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(TESTS_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

try:
    from app.cases.builder import HitGroupResult, group_hits
except ImportError:
    from backend.app.cases.builder import HitGroupResult, group_hits


def make_hit(
    hit_id: str,
    pattern: str = "cycle",
    account_ids: list[str] | None = None,
    tx_ids: list[str] | None = None,
    transactions: list[dict] | None = None,
    measurements: dict | None = None,
    explanation: str = "Evidence explanation",
) -> dict:
    """Construct an in-memory Hit object matching RingTrace detector output."""
    acc_ids = list(account_ids or [])
    t_ids = list(tx_ids or [])
    tx_list = list(transactions or [])
    if not tx_list and t_ids:
        tx_list = [
            {
                "tx_id": tid,
                "src": acc_ids[0] if acc_ids else "ACC_SRC",
                "dst": acc_ids[-1] if acc_ids else "ACC_DST",
                "amount": 10000.0,
                "ts": 1700000000 + i * 60,
                "tx_type": "UPI",
            }
            for i, tid in enumerate(t_ids)
        ]
    return {
        "hit_id": hit_id,
        "pattern": pattern,
        "account_ids": acc_ids,
        "tx_ids": t_ids,
        "transactions": tx_list,
        "measurements": dict(measurements or {"suspicious": True}),
        "explanation": explanation,
    }


class TestCaseGrouping(unittest.TestCase):
    """Phase 1: Detector hit grouping test suite."""

    def test_1_two_hits_sharing_account_merge_into_one_group(self):
        """Two hits sharing an account merge into one group."""
        hit_1 = make_hit(
            hit_id="HIT_CYC_01",
            pattern="cycle",
            account_ids=["ACC_A", "ACC_B"],
            tx_ids=["TX_01"],
            transactions=[{"tx_id": "TX_01", "src": "ACC_A", "dst": "ACC_B", "amount": 25000.0, "ts": 100}],
            explanation="Cycle between A and B",
        )
        hit_2 = make_hit(
            hit_id="HIT_REL_01",
            pattern="relay_chain",
            account_ids=["ACC_B", "ACC_C"],
            tx_ids=["TX_02"],
            transactions=[{"tx_id": "TX_02", "src": "ACC_B", "dst": "ACC_C", "amount": 24000.0, "ts": 120}],
            explanation="Relay from B to C",
        )

        groups = group_hits([hit_1, hit_2])

        self.assertEqual(len(groups), 1, "Expected exactly 1 merged group")
        group = groups[0]

        # Assert actual IDs and evidence
        self.assertEqual(group["account_ids"], ["ACC_A", "ACC_B", "ACC_C"])
        self.assertEqual(group["account_count"], 3)
        self.assertEqual(set(group["hit_ids"]), {"HIT_CYC_01", "HIT_REL_01"})
        self.assertEqual(set(group["tx_ids"]), {"TX_01", "TX_02"})
        self.assertEqual(set(group["patterns"]), {"cycle", "relay_chain"})
        self.assertEqual(len(group["hits"]), 2)

    def test_2_three_hits_transitively_connected_merge_into_one_group(self):
        """Three hits connected transitively (A-B, B-C, C-D) merge into one group."""
        hit_a = make_hit("HIT_A", "cycle", ["ACC_1", "ACC_2"], ["TX_A"])
        hit_b = make_hit("HIT_B", "relay_chain", ["ACC_2", "ACC_3"], ["TX_B"])
        hit_c = make_hit("HIT_C", "fan_in", ["ACC_3", "ACC_4"], ["TX_C"])

        # Note: hit_a and hit_c share NO accounts directly; hit_b connects them
        groups = group_hits([hit_a, hit_b, hit_c])

        self.assertEqual(len(groups), 1, "Transitive connections must unify into 1 group")
        group = groups[0]
        self.assertEqual(group["account_ids"], ["ACC_1", "ACC_2", "ACC_3", "ACC_4"])
        self.assertEqual(group["account_count"], 4)
        self.assertEqual(set(group["hit_ids"]), {"HIT_A", "HIT_B", "HIT_C"})
        self.assertEqual(set(group["tx_ids"]), {"TX_A", "TX_B", "TX_C"})
        self.assertEqual(set(group["patterns"]), {"cycle", "fan_in", "relay_chain"})

    def test_3_two_unrelated_hits_remain_in_separate_groups(self):
        """Two disjoint hits with no shared accounts remain in separate groups."""
        hit_1 = make_hit("HIT_CLUSTER_1", "fan_in", ["ACC_10", "ACC_11"], ["TX_10"])
        hit_2 = make_hit("HIT_CLUSTER_2", "fan_out", ["ACC_80", "ACC_81"], ["TX_80"])

        groups = group_hits([hit_1, hit_2])

        self.assertEqual(len(groups), 2, "Unrelated hits must produce separate groups")
        group_accounts = [g["account_ids"] for g in groups]
        self.assertIn(["ACC_10", "ACC_11"], group_accounts)
        self.assertIn(["ACC_80", "ACC_81"], group_accounts)

        # Confirm distinct hit IDs
        group_hit_ids = [g["hit_ids"] for g in groups]
        self.assertIn(["HIT_CLUSTER_1"], group_hit_ids)
        self.assertIn(["HIT_CLUSTER_2"], group_hit_ids)

    def test_4_multiple_transaction_ids_and_hit_ids_survive_unchanged(self):
        """Multiple transaction IDs, hit IDs, measurements, and explanations survive grouping unchanged."""
        hit_1 = make_hit(
            hit_id="HIT_COMPLEX_1",
            pattern="scatter_gather",
            account_ids=["ACC_SRC", "ACC_MID1", "ACC_MID2", "ACC_SINK"],
            tx_ids=["TX_001", "TX_002"],
            transactions=[
                {"tx_id": "TX_001", "src": "ACC_SRC", "dst": "ACC_MID1", "amount": 48000.0, "ts": 1000},
                {"tx_id": "TX_002", "src": "ACC_SRC", "dst": "ACC_MID2", "amount": 48000.0, "ts": 1010},
            ],
            measurements={"retention_ratio": 0.95, "suspicious": True, "intermediaries": 2},
            explanation="Scatter flow through 2 intermediaries",
        )
        hit_2 = make_hit(
            hit_id="HIT_COMPLEX_2",
            pattern="gather_scatter",
            account_ids=["ACC_SINK", "ACC_OUT1"],
            tx_ids=["TX_003", "TX_004"],
            transactions=[
                {"tx_id": "TX_003", "src": "ACC_SINK", "dst": "ACC_OUT1", "amount": 45000.0, "ts": 2000},
                {"tx_id": "TX_004", "src": "ACC_SINK", "dst": "ACC_OUT1", "amount": 47000.0, "ts": 2020},
            ],
            measurements={"burst_window_hours": 12, "suspicious": True},
            explanation="Gather-scatter concentration at ACC_SINK",
        )

        groups = group_hits([hit_1, hit_2])

        self.assertEqual(len(groups), 1)
        group = groups[0]

        # Verify all 4 transaction IDs survive unchanged
        self.assertEqual(group["tx_ids"], ["TX_001", "TX_002", "TX_003", "TX_004"])
        self.assertEqual(group["tx_count"], 4)

        # Verify full transaction records survive with amounts and timestamps
        tx_dict = {tx["tx_id"]: tx for tx in group["transactions"]}
        self.assertEqual(len(tx_dict), 4)
        self.assertEqual(tx_dict["TX_001"]["amount"], 48000.0)
        self.assertEqual(tx_dict["TX_003"]["amount"], 45000.0)

        # Verify all hit IDs survive
        self.assertEqual(set(group["hit_ids"]), {"HIT_COMPLEX_1", "HIT_COMPLEX_2"})

        # Verify original measurements and explanations survive intact on original hits
        hits_by_id = {h["hit_id"]: h for h in group["hits"]}
        self.assertEqual(hits_by_id["HIT_COMPLEX_1"]["measurements"]["retention_ratio"], 0.95)
        self.assertEqual(hits_by_id["HIT_COMPLEX_1"]["explanation"], "Scatter flow through 2 intermediaries")
        self.assertEqual(hits_by_id["HIT_COMPLEX_2"]["measurements"]["burst_window_hours"], 12)
        self.assertEqual(hits_by_id["HIT_COMPLEX_2"]["explanation"], "Gather-scatter concentration at ACC_SINK")

    def test_5_repeated_account_ids_within_hit_do_not_create_duplicates(self):
        """Repeated account IDs within a hit do not duplicate in group account_ids."""
        hit = make_hit(
            hit_id="HIT_REPEATED",
            pattern="cycle",
            account_ids=["ACC_1", "ACC_1", "ACC_2", "ACC_1", "ACC_2", "ACC_3"],
            tx_ids=["TX_R1"],
        )

        groups = group_hits([hit])

        self.assertEqual(len(groups), 1)
        group = groups[0]
        self.assertEqual(group["account_ids"], ["ACC_1", "ACC_2", "ACC_3"])
        self.assertEqual(group["account_count"], 3)

    def test_6_empty_input_returns_empty_result(self):
        """Empty input returns an empty result with zero groups."""
        groups = group_hits([])
        self.assertEqual(groups, [])
        self.assertEqual(len(groups), 0)
        self.assertIsInstance(groups, list)
        self.assertIsInstance(groups, HitGroupResult)
        self.assertEqual(groups.non_case_generating_hit_ids, [])
        self.assertEqual(groups.skipped_oversized_hit_ids, [])

    def test_7_repeating_same_input_produces_identical_grouping(self):
        """Repeating the same input (even with shuffled order) produces identical deterministic groupings."""
        hits = [
            make_hit("HIT_Z", "fan_out", ["ACC_M", "ACC_N"], ["TX_Z"]),
            make_hit("HIT_A", "cycle", ["ACC_X", "ACC_Y"], ["TX_A"]),
            make_hit("HIT_B", "relay_chain", ["ACC_Y", "ACC_Z"], ["TX_B"]),
            make_hit("HIT_C", "fan_in", ["ACC_Z", "ACC_W"], ["TX_C"]),
        ]

        result_1 = group_hits(hits)
        result_2 = group_hits(hits)
        result_3 = group_hits(list(reversed(hits)))

        # Assert identical group IDs and order
        self.assertEqual([g["group_id"] for g in result_1], [g["group_id"] for g in result_2])
        self.assertEqual([g["group_id"] for g in result_1], [g["group_id"] for g in result_3])

        # Assert identical structure and content
        self.assertEqual(result_1, result_2)
        self.assertEqual(result_1, result_3)

    def test_8_account_cap_and_oversized_policy(self):
        """Account cap partitions connected components exceeding cap, and skips oversized hits."""
        # Test 8a: Partitioning a connected component under max_accounts=5
        # Hit 1 has accounts ACC_1..ACC_3 (3 accounts)
        hit_1 = make_hit("HIT_PART_1", "fan_in", ["ACC_1", "ACC_2", "ACC_3"], ["TX_1"])
        # Hit 2 has accounts ACC_3..ACC_5 (3 accounts; merged with Hit 1 = 5 accounts <= 5)
        hit_2 = make_hit("HIT_PART_2", "relay_chain", ["ACC_3", "ACC_4", "ACC_5"], ["TX_2"])
        # Hit 3 has accounts ACC_5..ACC_7 (3 accounts; combined with Hit 1 & 2 = 7 accounts > 5)
        hit_3 = make_hit("HIT_PART_3", "fan_out", ["ACC_5", "ACC_6", "ACC_7"], ["TX_3"])

        groups = group_hits([hit_1, hit_2, hit_3], max_accounts=5)

        # Must partition into 2 groups, each <= 5 accounts
        self.assertEqual(len(groups), 2)
        for g in groups:
            self.assertLessEqual(g["account_count"], 5)
            self.assertLessEqual(len(g["account_ids"]), 5)

        # Confirm all 3 original hits survived across the partitioned groups
        all_hit_ids = {hid for g in groups for hid in g["hit_ids"]}
        self.assertEqual(all_hit_ids, {"HIT_PART_1", "HIT_PART_2", "HIT_PART_3"})

        # Test 8b: Single hit with accounts exceeding max_accounts is skipped as oversized
        big_hit = make_hit("HIT_TOO_BIG", "dense_cluster", [f"ACC_OVER_{i}" for i in range(10)], ["TX_BIG"])
        groups_oversized = group_hits([big_hit], max_accounts=5)

        self.assertEqual(len(groups_oversized), 0)
        self.assertEqual(groups_oversized.skipped_oversized_hit_ids, ["HIT_TOO_BIG"])

        # Test 8c: Validation on max_accounts boundary
        with self.assertRaises(ValueError):
            group_hits([hit_1], max_accounts=0)
        with self.assertRaises(ValueError):
            group_hits([hit_1], max_accounts=101)


if __name__ == "__main__":
    unittest.main()
