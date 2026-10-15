"""Data Loader for RingTrace FalkorDB graphs."""
import csv
import os
import time
from typing import Dict, List, Optional

try:
    from app.db import FalkorDBClient
    from app.queries import (
        COUNT_ACCOUNTS, COUNT_LABEL_ALERTS, COUNT_LABEL_MEMBERS, COUNT_SENT,
        CREATE_ACCOUNT_INDEX, CREATE_LABEL_ACCOUNT_INDEX, CREATE_LABEL_ALERT_INDEX,
        CREATE_SENT_INDEX, LABEL_LEAKAGE_CHECK, MERGE_ACCOUNTS, MERGE_LABEL_ALERTS,
        MERGE_LABEL_MEMBERS, MERGE_TRANSACTIONS
    )
    from app.simulator_adapter import SimulatorAdapter, ValidationError
except ImportError:
    from backend.app.db import FalkorDBClient
    from backend.app.queries import (
        COUNT_ACCOUNTS, COUNT_LABEL_ALERTS, COUNT_LABEL_MEMBERS, COUNT_SENT,
        CREATE_ACCOUNT_INDEX, CREATE_LABEL_ACCOUNT_INDEX, CREATE_LABEL_ALERT_INDEX,
        CREATE_SENT_INDEX, LABEL_LEAKAGE_CHECK, MERGE_ACCOUNTS, MERGE_LABEL_ALERTS,
        MERGE_LABEL_MEMBERS, MERGE_TRANSACTIONS
    )
    from backend.app.simulator_adapter import SimulatorAdapter, ValidationError

BATCH_SIZE = 5000


def batch_iter(items: List, n: int = BATCH_SIZE):
    for i in range(0, len(items), n):
        yield items[i:i + n]


class RingTraceDataLoader:
    """Manages importation of validated simulator records into FalkorDB."""

    def __init__(self, db: Optional[FalkorDBClient] = None):
        self.db = db or FalkorDBClient()

    def _try_query(self, graph: str, q: str, caller: str):
        try:
            self.db.execute_query(graph, q, caller=caller)
        except Exception:
            pass

    def load_dataset(
        self,
        data_dir: str,
        txn_graph: str = "txn",
        labels_graph: str = "labels",
        replay_fraction: float = 0.10,
        full: bool = False,
        reset: bool = False,
    ) -> Dict:
        """Validate, load, reconcile, and audit dataset into FalkorDB."""
        t_start = time.time()
        adapter = SimulatorAdapter(data_dir)

        accounts = adapter.load_and_validate_accounts()
        account_ids = {a["id"] for a in accounts}
        transactions = adapter.load_and_validate_transactions(account_ids)
        tx_ids = {t["tx_id"] for t in transactions}
        alerts, alert_members = adapter.load_and_validate_labels(account_ids, tx_ids)

        transactions.sort(key=lambda r: (r["ts"], r["tx_id"]))
        cut = len(transactions) if full else int(len(transactions) * (1 - replay_fraction))
        loaded_txs, replay_txs = transactions[:cut], transactions[cut:]

        if reset:
            self.db.delete_graph(txn_graph, caller="load:reset")
            self.db.delete_graph(labels_graph, caller="load:reset")

        # 1. Ingest Transaction Graph
        self._try_query(txn_graph, CREATE_ACCOUNT_INDEX, "load:index_account")
        self._try_query(txn_graph, CREATE_SENT_INDEX, "load:index_sent")
        for b in batch_iter(accounts):
            self.db.execute_query(txn_graph, MERGE_ACCOUNTS, {"rows": b}, "load:merge_accounts")
        for b in batch_iter(loaded_txs):
            self.db.execute_query(txn_graph, MERGE_TRANSACTIONS, {"rows": b}, "load:merge_transactions")

        if replay_txs:
            with open(os.path.join(data_dir, "replay.csv"), "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=["tx_id", "src", "dst", "amount", "ts", "step", "tx_type"], lineterminator="\n")
                w.writeheader()
                w.writerows(replay_txs)

        # 2. Ingest Labels Graph
        self._try_query(labels_graph, CREATE_LABEL_ALERT_INDEX, "load:index_label_alert")
        self._try_query(labels_graph, CREATE_LABEL_ACCOUNT_INDEX, "load:index_label_account")
        for b in batch_iter(alerts):
            self.db.execute_query(labels_graph, MERGE_LABEL_ALERTS, {"rows": b}, "load:merge_alerts")
        for b in batch_iter(alert_members):
            self.db.execute_query(labels_graph, MERGE_LABEL_MEMBERS, {"rows": b}, "load:merge_members")

        # 3. Reconciliation & Audit
        acc_count = self.db.execute_query(txn_graph, COUNT_ACCOUNTS, caller="reconcile:accounts").result_set[0][0]
        tx_count = self.db.execute_query(txn_graph, COUNT_SENT, caller="reconcile:transactions").result_set[0][0]
        if acc_count != len(accounts) or tx_count != len(loaded_txs):
            raise ValidationError(f"Reconciliation mismatch! Accs: {acc_count}/{len(accounts)}, Txs: {tx_count}/{len(loaded_txs)}")

        leakage = self.db.execute_query(txn_graph, LABEL_LEAKAGE_CHECK, caller="audit:leakage").result_set[0][0]
        if leakage > 0:
            raise ValidationError(f"Label leakage detected! Found {leakage} nodes with label properties in {txn_graph}")

        return {
            "status": "success",
            "duration_sec": round(time.time() - t_start, 2),
            "txn_graph": txn_graph,
            "labels_graph": labels_graph,
            "accounts_loaded": acc_count,
            "transactions_loaded": tx_count,
            "transactions_held_back": len(replay_txs),
            "alerts_loaded": len(alerts),
            "alert_members_loaded": len(alert_members),
            "label_leakage_detected": 0
        }
