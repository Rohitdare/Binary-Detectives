#!/usr/bin/env python3
"""
RingTrace synthetic transaction simulator.

Writes AMLSim-style output with ground truth:
  accounts.csv, transactions.csv, alerts.csv, alert_accounts.csv,
  alert_transactions.csv, meta.json

Design rules:
  * Fully deterministic: one random.Random(seed), counter-based IDs.
  * Heavy-tailed background activity, community structure, merchants and
    payroll accounts that create BENIGN fan-in / fan-out.
  * Fraud instances are planted many times per pattern with varied sizes,
    amounts and timing, so amount alone does not separate them.
  * Benign look-alikes and near-misses are labeled is_fraud=False.
  * Every labeled instance uses its own accounts (labels stay disjoint).
Detectors must never read alerts*.csv. Only the evaluator does.
"""
import argparse
import csv
import hashlib
import json
import math
import os
import random
from collections import defaultdict
from datetime import datetime, timezone
from itertools import accumulate

GENERATOR_VERSION = "1.0"
BASE_DATE = datetime(2026, 1, 1, tzinfo=timezone.utc)
CHANNELS = ["UPI", "NEFT", "IMPS", "RTGS"]
FRAUD_PATTERNS = [
    "cycle", "fan_in", "fan_out", "relay_chain",
    "scatter_gather", "gather_scatter", "bipartite", "dense_cluster",
]
# benign kind -> fraud pattern it resembles
BENIGN_KINDS = {
    "payroll_fan_out": "fan_out",
    "merchant_fan_in": "fan_in",
    "slow_family_cycle": "cycle",
    "near_miss_fan_in": "fan_in",
    "near_miss_relay": "relay_chain",
    "unordered_cycle": "cycle",
}
HOUR_W = [1, 1, 1, 1, 1, 2, 3, 5, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 7, 6, 4, 3, 2, 1]
H = 3600
D = 86400


class Sim:
    def __init__(self, args):
        self.a = args
        self.r = random.Random(args.seed)
        self.t0 = int(BASE_DATE.timestamp())
        self.total = args.days * D
        self.accounts = []
        self.txs = []
        self.alerts = []
        self.used = set()
        self.counters = defaultdict(int)
        self._uid = 0

    # ------------------------------------------------------------ helpers
    @staticmethod
    def iso(ts):
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    def amt(self, median=15000, sigma=0.7, lo=3000, hi=150000):
        return min(max(self.r.lognormvariate(math.log(median), sigma), lo), hi)

    def rand_ts(self):
        day = self.r.randrange(self.a.days)
        hour = self.r.choices(range(24), weights=HOUR_W)[0]
        return self.t0 + day * D + hour * H + self.r.randrange(H)

    def add_tx(self, src, dst, amount, ts):
        assert src != dst
        self._uid += 1
        self.txs.append(dict(uid=self._uid, src=src, dst=dst,
                             amount=round(max(amount, 1.0), 2), ts=int(ts),
                             tx_type=self.r.choice(CHANNELS)))
        return self._uid

    def pick(self, n, kind="personal"):
        pool = [x["account_id"] for x in self.accounts
                if x["type"] == kind and x["account_id"] not in self.used]
        if len(pool) < n:
            raise SystemExit(f"Not enough free '{kind}' accounts (need {n}, have {len(pool)}). "
                             "Raise --accounts or lower instance counts.")
        chosen = self.r.sample(pool, n)
        self.used.update(chosen)
        return chosen

    def emit(self, pattern, kind, is_fraud, roles, rel):
        """rel = list of (src, dst, amount, offset_seconds). Place at a random start."""
        span = max(o for _, _, _, o in rel)
        if span >= self.total:
            raise SystemExit("--days too small for pattern span")
        start = self.t0 + self.r.randint(0, self.total - span - 1)
        uids = [self.add_tx(s, d, a, start + off) for s, d, a, off in rel]
        self.counters[kind] += 1
        self.alerts.append(dict(
            alert_id=f"ALERT_{kind}_{self.counters[kind]:03d}", pattern=pattern,
            kind=kind, is_fraud=is_fraud, roles=roles, uids=uids))

    # --------------------------------------------------------- background
    def make_accounts(self):
        r = self.r
        n = self.a.accounts
        ncomm = max(5, n // 150)
        for i in range(n):
            x = r.random()
            typ = "merchant" if x < 0.05 else "payroll" if x < 0.06 else "personal"
            send_w = min(r.paretovariate(1.5), 50.0)
            self.accounts.append(dict(
                account_id=f"ACC_{i + 1:05d}", type=typ, community=r.randrange(ncomm),
                created=self.t0 - r.randint(30, 1800) * D, send_w=send_w,
                recv_w=send_w * (20 if typ == "merchant" else 1)))

    def background(self):
        r, accs = self.r, self.accounts
        n_tx = int(len(accs) * self.a.tx_per_account)
        ids = [x["account_id"] for x in accs]
        send_cum = list(accumulate(x["send_w"] for x in accs))
        glob_cum = list(accumulate(x["recv_w"] for x in accs))
        by_comm = defaultdict(list)
        for x in accs:
            by_comm[x["community"]].append(x)
        comm_ids = {c: [y["account_id"] for y in v] for c, v in by_comm.items()}
        comm_cum = {c: list(accumulate(y["recv_w"] for y in v)) for c, v in by_comm.items()}
        for si in r.choices(range(len(accs)), cum_weights=send_cum, k=n_tx):
            s = accs[si]
            if r.random() < 0.75:
                d = r.choices(comm_ids[s["community"]], cum_weights=comm_cum[s["community"]])[0]
            else:
                d = r.choices(ids, cum_weights=glob_cum)[0]
            if d == s["account_id"]:
                continue
            amount = min(max(r.lognormvariate(math.log(1500), 1.1), 50), 250000)
            self.add_tx(s["account_id"], d, amount, self.rand_ts())

    def payroll_runs(self):
        """Natural benign fan-out: payroll accounts pay employees every 30 days."""
        r = self.r
        personal = [x["account_id"] for x in self.accounts if x["type"] == "personal"]
        for acc in [x for x in self.accounts if x["type"] == "payroll"]:
            staff = r.sample(personal, r.randint(15, 60))
            salary = r.uniform(20000, 45000)
            day = r.randint(0, 5)
            while day < self.a.days:
                base = self.t0 + day * D + 10 * H
                for e in staff:
                    self.add_tx(acc["account_id"], e, salary * r.uniform(0.8, 1.2),
                                base + r.randint(0, H))
                day += 30

    # ------------------------------------------------------ fraud patterns
    def inj_cycle(self):
        r = self.r
        k = r.randint(3, 5)
        nodes = self.pick(k)
        a, off, rel = self.amt(), 0, []
        for i in range(k):
            rel.append((nodes[i], nodes[(i + 1) % k], a, off))
            a *= r.uniform(0.90, 0.99)
            off += r.randint(600, 12 * H)
        roles = [(nodes[0], "origin")] + [(n, "intermediary") for n in nodes[1:]]
        self.emit("cycle", "cycle", True, roles, rel)

    def inj_fan_in(self):
        r = self.r
        n = r.randint(8, 25)
        ids = self.pick(n + 1)
        tgt, srcs = ids[0], ids[1:]
        window = r.randint(2 * H, 48 * H)
        structuring = r.random() < 0.4
        base = self.amt()
        rel = [(s, tgt, 50000 * r.uniform(0.85, 0.99) if structuring else base * r.uniform(0.3, 1.0),
                r.randint(0, window)) for s in srcs]
        self.emit("fan_in", "fan_in", True, [(tgt, "sink")] + [(s, "source") for s in srcs], rel)

    def inj_fan_out(self):
        r = self.r
        n = r.randint(8, 25)
        ids = self.pick(n + 1)
        src, dsts = ids[0], ids[1:]
        window = r.randint(2 * H, 48 * H)
        base = self.amt()
        rel = [(src, d, base * r.uniform(0.3, 1.0), r.randint(0, window)) for d in dsts]
        self.emit("fan_out", "fan_out", True, [(src, "origin")] + [(d, "recipient") for d in dsts], rel)

    def inj_relay_chain(self):
        r = self.r
        hops = r.randint(3, 6)
        nodes = self.pick(hops + 1)
        a, off, rel = self.amt() * 2, 0, []
        for i in range(hops):
            rel.append((nodes[i], nodes[i + 1], a, off))
            a *= r.uniform(0.85, 0.98)
            off += r.randint(300, 6 * H)
        roles = [(nodes[0], "origin")] + [(n, "relay") for n in nodes[1:-1]] + [(nodes[-1], "sink")]
        self.emit("relay_chain", "relay_chain", True, roles, rel)

    def inj_scatter_gather(self):
        r = self.r
        k = r.randint(3, 6)
        ids = self.pick(k + 2)
        origin, sink, mids = ids[0], ids[1], ids[2:]
        part = self.amt() * 2 / k
        rel = []
        for m in mids:
            t1 = r.randint(0, 6 * H)
            a1 = part * r.uniform(0.9, 1.1)
            rel.append((origin, m, a1, t1))
            rel.append((m, sink, a1 * r.uniform(0.90, 0.98), t1 + r.randint(1800, 24 * H)))
        roles = [(origin, "origin"), (sink, "sink")] + [(m, "intermediary") for m in mids]
        self.emit("scatter_gather", "scatter_gather", True, roles, rel)

    def inj_gather_scatter(self):
        r = self.r
        n_in, n_out = r.randint(5, 12), r.randint(5, 12)
        ids = self.pick(n_in + n_out + 1)
        hub, ins, outs = ids[0], ids[1:1 + n_in], ids[1 + n_in:]
        rel, total = [], 0.0
        for s in ins:
            a = self.amt() * r.uniform(0.3, 0.8)
            total += a
            rel.append((s, hub, a, r.randint(0, 24 * H)))
        out_start = 24 * H + r.randint(1800, 6 * H)
        for d in outs:
            rel.append((hub, d, total / n_out * r.uniform(0.85, 0.98), out_start + r.randint(0, 24 * H)))
        roles = [(hub, "hub")] + [(s, "source") for s in ins] + [(d, "recipient") for d in outs]
        self.emit("gather_scatter", "gather_scatter", True, roles, rel)

    def inj_bipartite(self):
        r = self.r
        s_n, t_n = r.randint(3, 5), r.randint(3, 5)
        ids = self.pick(s_n + t_n)
        S, T = ids[:s_n], ids[s_n:]
        rel = []
        for s in S:
            for t in r.sample(T, r.randint(2, t_n)):
                rel.append((s, t, self.amt() * r.uniform(0.3, 0.8), r.randint(0, 48 * H)))
        roles = [(s, "source_group") for s in S] + [(t, "target_group") for t in T]
        self.emit("bipartite", "bipartite", True, roles, rel)

    def inj_dense_cluster(self):
        r = self.r
        n = r.randint(5, 10)
        nodes = self.pick(n)
        pairs = {(i - 1, i) for i in range(1, n)}  # chain keeps it connected
        for i in range(n):
            for j in range(i + 1, n):
                if r.random() < 0.5:
                    pairs.add((i, j))
        rel = []
        for i, j in sorted(pairs):
            for _ in range(r.randint(1, 3)):
                a, b = (i, j) if r.random() < 0.5 else (j, i)
                rel.append((nodes[a], nodes[b], self.amt() * r.uniform(0.2, 0.8), r.randint(0, 4 * D)))
        self.emit("dense_cluster", "dense_cluster", True, [(x, "member") for x in nodes], rel)

    # ----------------------------------------------- benign / near-misses
    def ben_payroll_fan_out(self):
        r = self.r
        emp = self.pick(1, "payroll")[0]
        staff = self.pick(r.randint(15, 40))
        pay = r.uniform(20000, 45000)
        rel = [(emp, s, pay * r.uniform(0.7, 1.3), r.randint(0, H)) for s in staff]
        self.emit("fan_out", "payroll_fan_out", False,
                  [(emp, "employer")] + [(s, "employee") for s in staff], rel)

    def ben_merchant_fan_in(self):
        r = self.r
        m = self.pick(1, "merchant")[0]
        cust = self.pick(r.randint(15, 40))
        rel = [(c, m, min(max(r.lognormvariate(math.log(800), 0.8), 50), 20000), r.randint(0, D))
               for c in cust]
        self.emit("fan_in", "merchant_fan_in", False,
                  [(m, "merchant")] + [(c, "customer") for c in cust], rel)

    def ben_slow_family_cycle(self):
        r = self.r
        nodes = self.pick(3)
        a, off, rel = self.amt() * 0.3, 0, []
        for i in range(3):
            rel.append((nodes[i], nodes[(i + 1) % 3], a, off))
            a *= r.uniform(0.2, 0.6)
            off += r.randint(8, 20) * D
        self.emit("cycle", "slow_family_cycle", False, [(n, "member") for n in nodes], rel)

    def ben_near_miss_fan_in(self):
        r = self.r
        n = r.randint(3, 5)
        ids = self.pick(n + 1)
        tgt, srcs = ids[0], ids[1:]
        base, window = self.amt(), r.randint(2 * H, 48 * H)
        rel = [(s, tgt, base * r.uniform(0.3, 1.0), r.randint(0, window)) for s in srcs]
        self.emit("fan_in", "near_miss_fan_in", False,
                  [(tgt, "sink")] + [(s, "source") for s in srcs], rel)

    def ben_near_miss_relay(self):
        r = self.r
        nodes = self.pick(4)
        a, off, rel = self.amt() * 2, 0, []
        for i in range(3):
            rel.append((nodes[i], nodes[i + 1], a, off))
            a *= r.uniform(0.2, 0.5)
            off += r.randint(3, 10) * D
        self.emit("relay_chain", "near_miss_relay", False, [(n, "member") for n in nodes], rel)

    def ben_unordered_cycle(self):
        """Structural cycle whose timestamps are not time-respecting from any start."""
        r = self.r
        k = r.randint(3, 4)
        nodes = self.pick(k)
        while True:
            ranks = r.sample(range(k), k)
            if sum(1 for i in range(k) if ranks[i] > ranks[(i + 1) % k]) >= 2:
                break
        gap, a = r.randint(H, 12 * H), self.amt()
        rel = [(nodes[i], nodes[(i + 1) % k], a * r.uniform(0.9, 0.99), ranks[i] * gap) for i in range(k)]
        self.emit("cycle", "unordered_cycle", False, [(n, "member") for n in nodes], rel)

    # --------------------------------------------------------------- run
    def run(self):
        self.make_accounts()
        self.background()
        self.payroll_runs()
        for p in FRAUD_PATTERNS:
            for _ in range(self.a.fraud_per_pattern):
                getattr(self, "inj_" + p)()
        for kind in BENIGN_KINDS:
            for _ in range(self.a.benign_per_kind):
                getattr(self, "ben_" + kind)()

    # ------------------------------------------------------------- output
    def write(self, out):
        os.makedirs(out, exist_ok=True)
        self.txs.sort(key=lambda t: (t["ts"], t["uid"]))
        uid2id = {}
        for i, t in enumerate(self.txs, 1):
            t["tx_id"] = f"TX_{i:07d}"
            uid2id[t["uid"]] = t["tx_id"]

        def w(name, header, rows):
            with open(os.path.join(out, name), "w", newline="") as f:
                cw = csv.writer(f, lineterminator="\n")
                cw.writerow(header)
                cw.writerows(rows)

        w("accounts.csv", ["account_id", "type", "community", "created_date"],
          [[x["account_id"], x["type"], x["community"], self.iso(x["created"])[:10]] for x in self.accounts])
        w("transactions.csv", ["tx_id", "src", "dst", "amount", "ts", "ts_epoch", "step", "tx_type"],
          [[t["tx_id"], t["src"], t["dst"], f'{t["amount"]:.2f}', self.iso(t["ts"]), t["ts"],
            (t["ts"] - self.t0) // D, t["tx_type"]] for t in self.txs])
        by_uid = {t["uid"]: t for t in self.txs}
        arows, mrows, trows = [], [], []
        for al in self.alerts:
            tss = [by_uid[u]["ts"] for u in al["uids"]]
            arows.append([al["alert_id"], al["pattern"], al["kind"], str(al["is_fraud"]).lower(),
                          len(al["roles"]), len(al["uids"]), self.iso(min(tss)), self.iso(max(tss))])
            mrows += [[al["alert_id"], acc, role] for acc, role in al["roles"]]
            trows += [[al["alert_id"], uid2id[u]] for u in al["uids"]]
        w("alerts.csv", ["alert_id", "pattern", "kind", "is_fraud", "n_accounts", "n_tx",
                         "start_ts", "end_ts"], arows)
        w("alert_accounts.csv", ["alert_id", "account_id", "role"], mrows)
        w("alert_transactions.csv", ["alert_id", "tx_id"], trows)
        return uid2id

    def validate(self):
        ids = [t["tx_id"] for t in self.txs]
        assert len(ids) == len(set(ids)), "duplicate tx_id"
        acc_ids = {x["account_id"] for x in self.accounts}
        end = self.t0 + self.total
        for t in self.txs:
            assert t["src"] != t["dst"], "self loop"
            assert t["src"] in acc_ids and t["dst"] in acc_ids, "unknown account"
            assert t["amount"] > 0, "bad amount"
            assert self.t0 <= t["ts"] < end, f"ts out of range {t}"
        seen = set()
        for al in self.alerts:
            members = {a for a, _ in al["roles"]}
            assert not (members & seen), f"account reused across alerts in {al['alert_id']}"
            seen |= members
            assert len(al["uids"]) >= 2, "alert with <2 tx"
        return True


def main():
    p = argparse.ArgumentParser(description="RingTrace transaction simulator")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--accounts", type=int, default=3000)
    p.add_argument("--days", type=int, default=90)
    p.add_argument("--tx-per-account", type=float, default=12.0)
    p.add_argument("--fraud-per-pattern", type=int, default=10)
    p.add_argument("--benign-per-kind", type=int, default=6)
    p.add_argument("--out", default="data/sim")
    args = p.parse_args()

    sim = Sim(args)
    sim.run()
    sim.write(args.out)
    sim.validate()

    with open(os.path.join(args.out, "transactions.csv"), "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    counts = defaultdict(int)
    for al in sim.alerts:
        counts[al["kind"]] += 1
    meta = dict(generator_version=GENERATOR_VERSION, args=vars(args),
                accounts=len(sim.accounts), transactions=len(sim.txs),
                alerts=len(sim.alerts), alerts_by_kind=dict(counts),
                transactions_sha256=digest)
    with open(os.path.join(args.out, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
