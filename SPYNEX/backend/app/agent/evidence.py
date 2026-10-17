"""Collect evidence facts returned by tools for answer validation."""
from decimal import Decimal, InvalidOperation
import re
from typing import Any, Dict, Iterable, Set

from app.agent.validator import RE_ACCOUNT_ID, RE_CASE_ID, RE_TRANSACTION_ID

RE_SAR_ID = re.compile(r"\bSAR_[A-Za-z0-9_-]+\b")
RE_AMOUNT = re.compile(r"(?:₹|\bINR\s*|\bRs\.?\s*)(\d[\d,]*(?:\.\d{1,2})?)", re.I)
AMOUNT_KEYS = {"amount", "total_amount", "total_outflow", "total_volume", "incoming_amount", "outgoing_amount", "amounts"}


def normalize_amount(value: Any):
    if isinstance(value, bool) or value is None:
        return None
    try:
        cleaned = str(value).replace(",", "").strip()
        amount = Decimal(cleaned)
        return amount.quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return None


class EvidenceStore:
    def __init__(self):
        self.account_ids: Set[str] = set()
        self.tx_ids: Set[str] = set()
        self.case_ids: Set[str] = set()
        self.sar_ids: Set[str] = set()
        self.amounts: Set[Decimal] = set()

    def add(self, tool_result: Any) -> None:
        def visit(value: Any, key: str = ""):
            if isinstance(value, dict):
                for child_key, child in value.items():
                    child_key = str(child_key).lower()
                    if child_key in {"summary", "error", "args", "note", "thought"}:
                        continue
                    visit(child, child_key)
                return
            if isinstance(value, (list, tuple, set)):
                for child in value:
                    visit(child, key)
                return
            if value is None:
                return
            if isinstance(value, str):
                self.account_ids.update(RE_ACCOUNT_ID.findall(value))
                self.tx_ids.update(RE_TRANSACTION_ID.findall(value))
                self.case_ids.update(RE_CASE_ID.findall(value))
                self.sar_ids.update(RE_SAR_ID.findall(value))
                for match in RE_AMOUNT.findall(value):
                    normalized = normalize_amount(match)
                    if normalized is not None:
                        self.amounts.add(normalized)
            if key in AMOUNT_KEYS or key.endswith("_amount") or key.endswith("_volume"):
                if isinstance(value, (int, float, str)):
                    normalized = normalize_amount(value)
                    if normalized is not None:
                        self.amounts.add(normalized)

        visit(tool_result)

    def has_id(self, value: str) -> bool:
        return value in self.account_ids or value in self.tx_ids or value in self.case_ids or value in self.sar_ids

    def has_amount(self, value: Any) -> bool:
        normalized = normalize_amount(value)
        return normalized is not None and normalized in self.amounts

    def summary(self) -> Dict[str, Any]:
        return {
            "account_ids": sorted(self.account_ids),
            "tx_ids": sorted(self.tx_ids),
            "case_ids": sorted(self.case_ids),
            "sar_ids": sorted(self.sar_ids),
            "amounts": sorted(float(amount) for amount in self.amounts),
        }
