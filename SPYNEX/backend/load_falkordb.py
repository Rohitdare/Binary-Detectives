#!/usr/bin/env python3
"""
Load simulator output into FalkorDB.

Graphs:
  txn     (:Account {id, type, community, created}) -[:SENT {tx_id, amount, ts, step, tx_type}]-> (:Account)
  labels  (:LabelAlert {id, pattern, kind, is_fraud, tx_ids}) -[:HAS_ACCOUNT {role}]-> (:LabelAccount {id})
          Evaluator only. Detectors and agent tools never open this graph.

Replay: by default the LAST 10% of transactions (by time) are NOT loaded. They are saved
to <data>/replay.csv for the live-replay worker. Use --full to load everything.

Idempotent: MERGE on account id and tx_id, so reruns do not duplicate. Use --reset to drop first.
"""
import argparse
import csv
import os
import sys
import time

from falkordb import FalkorDB

BATCH = 5000


def read_csv(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def batches(seq, n=BATCH):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def try_query(g, q, what):
    try:
        g.query(q)
    except Exception as e:  # index may already exist or syntax differs by version
        print(f"  note: {what}: {e}", file=sys.stderr)


def load_txn(g, data_dir, replay_fraction, full):
    accounts = read_csv(os.path.join(data_dir, "accounts.csv"))
    txs = read_csv(os.path.join(data_dir, "transactions.csv"))
    txs.sort(key=lambda r: (int(r["ts_epoch"]), r["tx_id"]))
    cut = len(txs) if full else int(len(txs) * (1 - replay_fraction))
    loaded, replay = txs[:cut], txs[cut:]

    try_query(g, "CREATE INDEX FOR (a:Account) ON (a.id)", "account index")
    try_query(g, "CREATE INDEX FOR ()-[t:SENT]-() ON (t.tx_id)", "edge index (needs recent FalkorDB)")

    acc_rows = [dict(id=a["account_id"], type=a["type"], community=int(a["community"]),
                     created=a["created_date"]) for a in accounts]
    for b in batches(acc_rows):
        g.query("UNWIND $rows AS r MERGE (a:Account {id:r.id}) "
                "SET a.type=r.type, a.community=r.community, a.created=r.created", {"rows": b})

    tx_rows = [dict(tx_id=t["tx_id"], src=t["src"], dst=t["dst"], amount=float(t["amount"]),
                    ts=int(t["ts_epoch"]), step=int(t["step"]), tx_type=t["tx_type"]) for t in loaded]
    t_start = time.time()
    for b in batches(tx_rows):
        g.query("UNWIND $rows AS r "
                "MATCH (a:Account {id:r.src}), (b:Account {id:r.dst}) "
                "MERGE (a)-[t:SENT {tx_id:r.tx_id}]->(b) "
                "SET t.amount=r.amount, t.ts=r.ts, t.step=r.step, t.tx_type=r.tx_type", {"rows": b})
    print(f"  loaded {len(tx_rows)} transactions in {time.time() - t_start:.1f}s")

    if replay:
        path = os.path.join(data_dir, "replay.csv")
        with open(path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(txs[0].keys()), lineterminator="\n")
            w.writeheader()
            w.writerows(replay)
        print(f"  held back {len(replay)} transactions for live replay: {path}")
    return len(accounts), len(tx_rows)


def load_labels(g, data_dir):
    alerts = read_csv(os.path.join(data_dir, "alerts.csv"))
    members = read_csv(os.path.join(data_dir, "alert_accounts.csv"))
    tx_by_alert = {}
    for r in read_csv(os.path.join(data_dir, "alert_transactions.csv")):
        tx_by_alert.setdefault(r["alert_id"], []).append(r["tx_id"])
    try_query(g, "CREATE INDEX FOR (a:LabelAlert) ON (a.id)", "label alert index")
    try_query(g, "CREATE INDEX FOR (a:LabelAccount) ON (a.id)", "label account index")
    rows = [dict(alert_id=a["alert_id"], pattern=a["pattern"], kind=a["kind"],
                 is_fraud=a["is_fraud"] == "true", tx_ids=tx_by_alert.get(a["alert_id"], []))
            for a in alerts]
    g.query("UNWIND $rows AS r MERGE (al:LabelAlert {id:r.alert_id}) "
            "SET al.pattern=r.pattern, al.kind=r.kind, al.is_fraud=r.is_fraud, al.tx_ids=r.tx_ids",
            {"rows": rows})
    for b in batches(members):
        g.query("UNWIND $rows AS r MATCH (al:LabelAlert {id:r.alert_id}) "
                "MERGE (a:LabelAccount {id:r.account_id}) "
                "MERGE (al)-[m:HAS_ACCOUNT]->(a) SET m.role=r.role", {"rows": b})
    print(f"  loaded {len(alerts)} alerts and {len(members)} memberships into labels graph")


def count(g, q):
    return g.query(q).result_set[0][0]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data", default="data/sim")
    p.add_argument("--host", default="localhost")
    p.add_argument("--port", type=int, default=6379)
    p.add_argument("--graph", default="txn")
    p.add_argument("--labels-graph", default="labels")
    p.add_argument("--replay-fraction", type=float, default=0.10)
    p.add_argument("--full", action="store_true", help="load every transaction, no replay file")
    p.add_argument("--reset", action="store_true", help="delete both graphs first")
    a = p.parse_args()

    db = FalkorDB(host=a.host, port=a.port)
    g, gl = db.select_graph(a.graph), db.select_graph(a.labels_graph)
    if a.reset:
        for graph in (g, gl):
            try:
                graph.delete()
            except Exception:
                pass
        g, gl = db.select_graph(a.graph), db.select_graph(a.labels_graph)

    n_acc, n_tx = load_txn(g, a.data, a.replay_fraction, a.full)
    load_labels(gl, a.data)

    got_nodes = count(g, "MATCH (a:Account) RETURN count(a)")
    got_edges = count(g, "MATCH ()-[t:SENT]->() RETURN count(t)")
    ok = got_nodes == n_acc and got_edges == n_tx
    print(f"reconcile: accounts {got_nodes}/{n_acc}, transactions {got_edges}/{n_tx} -> {'OK' if ok else 'MISMATCH'}")

    # label leakage guard: txn graph must carry no label properties
    leak = count(g, "MATCH (a:Account) WHERE a.is_fraud IS NOT NULL OR a.alert_id IS NOT NULL RETURN count(a)")
    assert leak == 0, "label properties found in txn graph"
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
