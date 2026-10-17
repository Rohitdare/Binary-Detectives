"""Simulator Adapter for RingTrace.

Parses, validates, and transforms raw simulator output into verified domain objects.
"""
import csv
import os
from typing import Dict, List, Set, Tuple


class ValidationError(Exception):
    """Raised when simulator data fails validation or integrity checks."""
    pass


class SimulatorAdapter:
    """Validates and prepares simulator artifacts for RingTrace."""

    VALID_ACCOUNT_TYPES = {"personal", "merchant", "payroll"}
    VALID_TX_TYPES = {"UPI", "NEFT", "IMPS", "RTGS"}

    def __init__(self, data_dir: str):
        self.data_dir = data_dir

    def _read_csv(self, filename: str) -> List[Dict[str, str]]:
        path = os.path.join(self.data_dir, filename)
        if not os.path.exists(path):
            raise FileNotFoundError(f"Missing expected simulator file: {path}")
        with open(path, mode="r", newline="", encoding="utf-8") as f:
            return list(csv.DictReader(f))

    def load_and_validate_accounts(self) -> List[Dict]:
        raw = self._read_csv("accounts.csv")
        accounts, seen = [], set()
        for i, r in enumerate(raw, 1):
            aid, typ = r.get("account_id", "").strip(), r.get("type", "").strip()
            if not aid.startswith("ACC_") or aid in seen:
                raise ValidationError(f"Invalid or duplicate account_id '{aid}' at row {i}")
            if typ not in self.VALID_ACCOUNT_TYPES:
                raise ValidationError(f"Invalid type '{typ}' at row {i}")
            seen.add(aid)
            accounts.append({
                "id": aid,
                "type": typ,
                "community": int(r.get("community", 0)),
                "created": r.get("created_date", "").strip()
            })
        return accounts

    def load_and_validate_transactions(self, valid_acc_ids: Set[str]) -> List[Dict]:
        raw = self._read_csv("transactions.csv")
        txs, seen = [], set()
        for i, r in enumerate(raw, 1):
            tid, s, d = r.get("tx_id", "").strip(), r.get("src", "").strip(), r.get("dst", "").strip()
            if not tid.startswith("TX_") or tid in seen:
                raise ValidationError(f"Invalid or duplicate tx_id '{tid}' at row {i}")
            if s not in valid_acc_ids or d not in valid_acc_ids or s == d:
                raise ValidationError(f"Invalid transaction endpoints ({s} -> {d}) at row {i}")
            amt = float(r.get("amount", 0.0))
            if amt <= 0:
                raise ValidationError(f"Invalid amount {amt} at row {i}")
            ttyp = r.get("tx_type", "").strip()
            if ttyp not in self.VALID_TX_TYPES:
                raise ValidationError(f"Invalid tx_type '{ttyp}' at row {i}")
            seen.add(tid)
            txs.append({
                "tx_id": tid, "src": s, "dst": d, "amount": amt,
                "ts": int(r.get("ts_epoch", 0)), "step": int(r.get("step", 0)), "tx_type": ttyp
            })
        return txs

    def load_and_validate_labels(self, valid_acc_ids: Set[str], valid_tx_ids: Set[str]) -> Tuple[List[Dict], List[Dict]]:
        raw_alerts = self._read_csv("alerts.csv")
        raw_members = self._read_csv("alert_accounts.csv")
        raw_atxs = self._read_csv("alert_transactions.csv")

        tx_by_alert: Dict[str, List[str]] = {}
        for r in raw_atxs:
            aid, tid = r.get("alert_id", "").strip(), r.get("tx_id", "").strip()
            if tid not in valid_tx_ids:
                raise ValidationError(f"Alert '{aid}' references unknown tx '{tid}'")
            tx_by_alert.setdefault(aid, []).append(tid)

        alerts = []
        for r in raw_alerts:
            aid = r.get("alert_id", "").strip()
            atxs = tx_by_alert.get(aid, [])
            if len(atxs) < 2:
                raise ValidationError(f"Alert '{aid}' has fewer than 2 transactions")
            alerts.append({
                "alert_id": aid,
                "pattern": r.get("pattern", "").strip(),
                "kind": r.get("kind", "").strip(),
                "is_fraud": r.get("is_fraud", "").strip().lower() == "true",
                "tx_ids": atxs
            })

        members = []
        for r in raw_members:
            aid, acc = r.get("alert_id", "").strip(), r.get("account_id", "").strip()
            if acc not in valid_acc_ids:
                raise ValidationError(f"Alert '{aid}' references unknown account '{acc}'")
            members.append({"alert_id": aid, "account_id": acc, "role": r.get("role", "").strip()})

        return alerts, members
