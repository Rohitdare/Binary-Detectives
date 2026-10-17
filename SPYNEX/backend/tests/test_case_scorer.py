"""Focused unit tests for Phase 2 Case Scorer in RingTrace.

Verifies:
1. The score never falls below 0 or exceeds 100.
2. Each of the five components respects its allocated maximum.
3. The total equals the sum of the five component values.
4. Scores of 39, 40, 69, and 70 map to the correct severity.
5. Repeated scoring of identical input produces identical output.
6. Payroll and merchant origins receive the agreed pattern-severity reduction (-10).
7. Additional distinct patterns contribute to corroboration (+10 each after the first).
8. Duplicate hits of the same pattern do not falsely increase distinct-pattern corroboration.
9. A hub-account signal contributes only as supporting evidence (+5 corroboration, 0 severity).
10. Empty or minimal valid input follows the existing contract without exceptions.

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
    from app.cases.scorer import PATTERN_SEVERITY, score_case
except ImportError:
    from backend.app.cases.scorer import PATTERN_SEVERITY, score_case


def hit(
    hit_id: str,
    pattern: str = "cycle",
    accounts: list[str] | None = None,
    tx_id: str = "TX_01",
    ts: int = 1700000000,
    amount: float = 10000.0,
    roles: dict[str, str] | None = None,
) -> dict:
    accs = list(accounts or ["ACC_SRC", "ACC_DST"])
    role_map = dict(roles or {accs[0]: "origin"})
    return {
        "hit_id": hit_id,
        "pattern": pattern,
        "account_ids": accs,
        "account_roles": role_map,
        "tx_ids": [tx_id],
        "transactions": [
            {
                "tx_id": tx_id,
                "src": accs[0],
                "dst": accs[-1],
                "amount": amount,
                "ts": ts,
                "tx_type": "UPI",
            }
        ],
        "measurements": {"suspicious": True},
        "explanation": f"{pattern} hit on {hit_id}",
    }


class TestCaseScorer(unittest.TestCase):
    """Phase 2: Case priority scoring test suite."""

    def test_1_score_bounds_never_exceeds_100_or_falls_below_0(self):
        """The total score and all breakdown components stay within [0, 100]."""
        # Test extreme high input
        extreme_hits = [
            hit("H1", "relay_chain", ["A", "B"], "TX1", ts=1000, amount=1e14),
            hit("H2", "cycle", ["B", "C"], "TX2", ts=1001, amount=1e14),
            hit("H3", "scatter_gather", ["C", "D"], "TX3", ts=1002, amount=1e14),
            hit("H4", "gather_scatter", ["D", "E"], "TX4", ts=1003, amount=1e14),
            hit("H5", "hub_account", ["E", "F"], "TX5", ts=1004, amount=1e14),
        ]
        txs = [h["transactions"][0] for h in extreme_hits]
        score_high = score_case(extreme_hits, txs, account_count=1000)

        self.assertLessEqual(score_high["total"], 100)
        self.assertGreaterEqual(score_high["total"], 0)
        self.assertLessEqual(score_high["severity"], 35)
        self.assertLessEqual(score_high["amount"], 20)
        self.assertLessEqual(score_high["velocity"], 15)
        self.assertLessEqual(score_high["account_count"], 10)
        self.assertLessEqual(score_high["corroboration"], 20)

        # Test minimal/zero input
        score_zero = score_case([], [], account_count=0)
        self.assertEqual(score_zero["total"], 0)
        self.assertGreaterEqual(score_zero["total"], 0)
        self.assertEqual(score_zero["severity"], 0)
        self.assertEqual(score_zero["amount"], 0)
        self.assertEqual(score_zero["velocity"], 0)
        self.assertEqual(score_zero["account_count"], 0)
        self.assertEqual(score_zero["corroboration"], 0)

    def test_2_each_component_respects_allocated_maximum(self):
        """Each of the 5 scoring components strictly respects its allocated maximum."""
        # Max severity in table is relay_chain (32) <= 35
        for pattern, base in PATTERN_SEVERITY.items():
            s = score_case([hit("H", pattern)], [], account_count=1)
            self.assertLessEqual(s["severity"], 35, f"Pattern {pattern} exceeded severity 35")

        # Amount maximum is 20 (even with 100 billion INR)
        s_amount = score_case([hit("H", "cycle", amount=1e11)], [], account_count=1)
        self.assertLessEqual(s_amount["amount"], 20)

        # Velocity maximum is 15 (duration <= 1 hour)
        h_fast = hit("H", "cycle", ts=1000)
        h_fast["transactions"].append({"tx_id": "TX2", "amount": 1000, "ts": 1050})
        s_vel = score_case([h_fast], h_fast["transactions"], account_count=2)
        self.assertLessEqual(s_vel["velocity"], 15)

        # Account count maximum is 10 (even with 10,000 accounts)
        s_acc = score_case([hit("H", "cycle")], [], account_count=10000)
        self.assertLessEqual(s_acc["account_count"], 10)

        # Corroboration maximum is 20 (even with 9 patterns)
        multi_hits = [hit(f"H_{p}", p) for p in PATTERN_SEVERITY.keys()]
        s_corr = score_case(multi_hits, [], account_count=20)
        self.assertLessEqual(s_corr["corroboration"], 20)

    def test_3_total_equals_sum_of_five_components(self):
        """Total score strictly equals the sum of the five component values."""
        test_scenarios = [
            ([hit("H1", "cycle", ["A", "B"], amount=50000, ts=1000)], 2, {}),
            ([hit("H1", "relay_chain", ["A", "B"], amount=500000, ts=1000),
              hit("H2", "fan_in", ["B", "C"], amount=48000, ts=1050)], 3, {"A": "merchant"}),
            ([hit("H1", "dense_cluster", ["A", "B"], amount=1000, ts=1000),
              hit("H2", "hub_account", ["B", "C"], amount=1000, ts=50000)], 4, {}),
            ([], 0, {}),
        ]
        for hits, acc_count, acc_types in test_scenarios:
            txs = [tx for h in hits for tx in h.get("transactions", [])]
            res = score_case(hits, txs, account_count=acc_count, account_types=acc_types)
            component_sum = (
                res["severity"]
                + res["amount"]
                + res["velocity"]
                + res["account_count"]
                + res["corroboration"]
            )
            self.assertEqual(
                res["total"],
                component_sum,
                f"Mismatch: total={res['total']} vs sum={component_sum} in {res}",
            )

    def test_4_severity_threshold_boundaries_39_40_69_70(self):
        """Scores 39, 40, 69, and 70 map precisely to low, medium, medium, and high."""
        # 1. Direct severity mapping function verification
        def get_severity(score: int) -> str:
            return "high" if score >= 70 else "medium" if score >= 40 else "low"

        self.assertEqual(get_severity(39), "low")
        self.assertEqual(get_severity(40), "medium")
        self.assertEqual(get_severity(69), "medium")
        self.assertEqual(get_severity(70), "high")

        # 2. Case engineered to score exactly 39 (low)
        # bipartite (20) + amount 100 INR (0) + velocity <= 1h (15) + 4 accounts (4) + corroboration (0) = 39
        hit_39 = hit("H39", "bipartite", ["A", "B", "C", "D"], tx_id="TX_39", amount=100.0, ts=1000)
        res_39 = score_case([hit_39], hit_39["transactions"], account_count=4)
        self.assertEqual(res_39["total"], 39)
        self.assertEqual(res_39["severity_label"], "low")

        # 3. Case engineered to score exactly 40 (medium)
        # bipartite (20) + amount 3000 INR (3) + velocity <= 1h (15) + 2 accounts (2) + corroboration (0) = 40
        hit_40 = hit("H40", "bipartite", ["A", "B"], tx_id="TX_40", amount=3000.0, ts=1000)
        res_40 = score_case([hit_40], hit_40["transactions"], account_count=2)
        self.assertEqual(res_40["total"], 40)
        self.assertEqual(res_40["severity_label"], "medium")

        # 4. Case engineered to score exactly 69 (medium)
        # cycle (30) + fan_in (corroboration 10) + amount 15000 INR (6) + velocity <= 1h (15) + 16 accounts (8) = 69
        h_69a = hit("H69A", "cycle", ["A", "B"], tx_id="TX_69A", amount=15000.0, ts=1000)
        h_69b = hit("H69B", "fan_in", ["B", "C"], tx_id="TX_69B", amount=0.0, ts=1050)
        res_69 = score_case([h_69a, h_69b], h_69a["transactions"] + h_69b["transactions"], account_count=16)
        self.assertEqual(res_69["total"], 69)
        self.assertEqual(res_69["severity_label"], "medium")

        # 5. Case engineered to score exactly 70 (high)
        # cycle (30) + fan_in (corroboration 10) + amount 25000 INR (7) + velocity <= 1h (15) + 16 accounts (8) = 70
        h_70a = hit("H70A", "cycle", ["A", "B"], tx_id="TX_70A", amount=25000.0, ts=1000)
        h_70b = hit("H70B", "fan_in", ["B", "C"], tx_id="TX_70B", amount=0.0, ts=1050)
        res_70 = score_case([h_70a, h_70b], h_70a["transactions"] + h_70b["transactions"], account_count=16)
        self.assertEqual(res_70["total"], 70)
        self.assertEqual(res_70["severity_label"], "high")

    def test_5_repeated_scoring_identical_input(self):
        """Repeated scoring of identical input produces 100% identical outputs."""
        hits = [
            hit("H1", "cycle", ["ACC_1", "ACC_2"], "TX1", ts=100, amount=45000),
            hit("H2", "relay_chain", ["ACC_2", "ACC_3"], "TX2", ts=200, amount=44000),
        ]
        txs = [h["transactions"][0] for h in hits]

        runs = [score_case(hits, txs, account_count=3, account_types={"ACC_1": "personal"}) for _ in range(5)]
        first = runs[0]
        for run in runs[1:]:
            self.assertEqual(run, first)

    def test_6_payroll_and_merchant_origin_reduction(self):
        """Payroll and merchant origin accounts receive the agreed -10 pattern severity reduction."""
        # Baseline personal origin: relay_chain = 32
        data_personal = hit("H", "relay_chain", ["A", "B"], "TX1", roles={"A": "origin"})
        score_personal = score_case([data_personal], data_personal["transactions"], 2, {"A": "personal"})
        self.assertEqual(score_personal["severity"], 32)
        self.assertEqual(score_personal["origin_context_adjustment"], 0)

        # Payroll origin: relay_chain = 32 - 10 = 22
        score_payroll = score_case([data_personal], data_personal["transactions"], 2, {"A": "payroll"})
        self.assertEqual(score_payroll["severity"], 22)
        self.assertEqual(score_payroll["origin_context_adjustment"], -10)

        # Merchant origin: relay_chain = 32 - 10 = 22
        score_merchant = score_case([data_personal], data_personal["transactions"], 2, {"A": "merchant"})
        self.assertEqual(score_merchant["severity"], 22)
        self.assertEqual(score_merchant["origin_context_adjustment"], -10)

        # Non-origin account having payroll does NOT reduce severity
        data_non_origin = hit("H", "relay_chain", ["A", "B"], "TX1", roles={"A": "origin", "B": "sink"})
        score_sink_payroll = score_case([data_non_origin], data_non_origin["transactions"], 2, {"B": "payroll"})
        self.assertEqual(score_sink_payroll["severity"], 32)
        self.assertEqual(score_sink_payroll["origin_context_adjustment"], 0)

    def test_7_additional_distinct_patterns_contribute_to_corroboration(self):
        """Each additional distinct pattern adds +10 to corroboration (capped at 20)."""
        # 1 pattern alone (cycle) -> corroboration 0
        s1 = score_case([hit("H1", "cycle")], [], account_count=2)
        self.assertEqual(s1["corroboration"], 0)

        # 2 distinct patterns (cycle + fan_in) -> corroboration 10
        s2 = score_case([hit("H1", "cycle"), hit("H2", "fan_in")], [], account_count=3)
        self.assertEqual(s2["corroboration"], 10)

        # 3 distinct patterns (cycle + fan_in + relay_chain) -> corroboration 20
        s3 = score_case(
            [hit("H1", "cycle"), hit("H2", "fan_in"), hit("H3", "relay_chain")],
            [],
            account_count=4,
        )
        self.assertEqual(s3["corroboration"], 20)

        # 4 distinct patterns -> capped at 20
        s4 = score_case(
            [hit("H1", "cycle"), hit("H2", "fan_in"), hit("H3", "relay_chain"), hit("H4", "scatter_gather")],
            [],
            account_count=5,
        )
        self.assertEqual(s4["corroboration"], 20)

    def test_8_duplicate_hits_of_same_pattern_do_not_falsely_increase_corroboration(self):
        """Multiple hits of the SAME pattern do not count as independent pattern corroboration."""
        # 4 separate hits all of pattern 'cycle'
        cycle_hits = [
            hit("H1", "cycle", ["A", "B", "C"], "T1"),
            hit("H2", "cycle", ["B", "C", "D"], "T2"),
            hit("H3", "cycle", ["C", "D", "E"], "T3"),
            hit("H4", "cycle", ["D", "E", "F"], "T4"),
        ]
        score = score_case(cycle_hits, [], account_count=6)
        self.assertEqual(
            score["corroboration"],
            0,
            "Multiple hits of the same pattern must NOT increase corroboration",
        )

        # 3 cycle hits + 2 fan_in hits (2 distinct patterns) -> exactly 10
        mixed_hits = cycle_hits[:3] + [
            hit("H5", "fan_in", ["X", "Y"], "T5"),
            hit("H6", "fan_in", ["Y", "Z"], "T6"),
        ]
        score_mixed = score_case(mixed_hits, [], account_count=8)
        self.assertEqual(
            score_mixed["corroboration"],
            10,
            "Only the distinct pattern count should drive corroboration",
        )

    def test_9_hub_account_signal_contributes_only_as_supporting_evidence(self):
        """hub_account adds +5 corroboration and has 0 base severity; cannot independently make a high severity case."""
        hub_only = hit("H_HUB", "hub_account", ["HUB_1", "HUB_2"], "TX_H")
        score_hub = score_case([hub_only], hub_only["transactions"], account_count=2)

        self.assertEqual(score_hub["severity"], 0, "hub_account has 0 base pattern severity")
        self.assertEqual(score_hub["corroboration"], 5, "hub_account adds +5 corroboration boost")
        self.assertLess(score_hub["total"], 40, "hub_account alone cannot create a medium or high case")
        self.assertEqual(score_hub["severity_label"], "low")

        # Corroborating a cycle hit (+5)
        cycle_hit = hit("H_CYC", "cycle", ["A", "B", "C"], "TX_C")
        score_cycle_alone = score_case([cycle_hit], cycle_hit["transactions"], 3)
        self.assertEqual(score_cycle_alone["corroboration"], 0)

        score_cycle_hub = score_case([cycle_hit, hub_only], cycle_hit["transactions"] + hub_only["transactions"], 3)
        self.assertEqual(score_cycle_hub["corroboration"], 5)

        # Corroborating two patterns (cycle + fan_in = 10, plus hub = 15)
        fan_hit = hit("H_FAN", "fan_in", ["B", "C"], "TX_F")
        score_two_plus_hub = score_case(
            [cycle_hit, fan_hit, hub_only],
            cycle_hit["transactions"] + fan_hit["transactions"] + hub_only["transactions"],
            4,
        )
        self.assertEqual(score_two_plus_hub["corroboration"], 15)

    def test_10_empty_and_minimal_valid_input(self):
        """Empty or minimal valid inputs follow contract cleanly without exceptions."""
        # Completely empty input
        score_empty = score_case([], [], 0)
        self.assertEqual(score_empty["severity"], 0)
        self.assertEqual(score_empty["amount"], 0)
        self.assertEqual(score_empty["velocity"], 0)
        self.assertEqual(score_empty["account_count"], 0)
        self.assertEqual(score_empty["corroboration"], 0)
        self.assertEqual(score_empty["total"], 0)
        self.assertEqual(score_empty["severity_label"], "low")
        self.assertEqual(score_empty["score_type"], "triage_priority_not_probability")
        self.assertEqual(score_empty["origin_context_adjustment"], 0)
        self.assertEqual(score_empty["total_amount"], 0.0)
        self.assertEqual(score_empty["duration_seconds"], 0)

        # Minimal valid input: 1 hit with 1 transaction and 1 account
        minimal_hit = {"pattern": "cycle", "account_ids": ["A1"], "transactions": [{"tx_id": "T1", "amount": 500, "ts": 1000}]}
        score_min = score_case([minimal_hit], [], 1)
        self.assertGreater(score_min["total"], 0)
        self.assertEqual(score_min["severity"], 30)
        self.assertEqual(score_min["amount"], 1)  # 5 * log10(1 + 0.5) = 0.88 -> 1
        self.assertEqual(score_min["velocity"], 15)  # 1 transaction, duration 0 <= 3600
        self.assertEqual(score_min["account_count"], 0)  # 2 * log2(1) = 0
        self.assertEqual(score_min["corroboration"], 0)
        self.assertEqual(score_min["total"], 46)
        self.assertEqual(score_min["severity_label"], "medium")


if __name__ == "__main__":
    unittest.main()
