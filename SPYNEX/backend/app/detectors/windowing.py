"""Shared bounded sliding-window helpers for transaction burst detectors."""
from collections import Counter
import math
from typing import Any, Dict, List


def extract_overlapping_bursts(
    transactions: List[Dict[str, Any]],
    window_seconds: int,
    minimum_counterparties: int,
    counterparty_key: str,
) -> List[List[Dict[str, Any]]]:
    """Return merged maximal qualifying windows without discarding overlaps.

    A two-pointer scan visits every transaction start in O(n log n) including the
    stable sort. Adjacent windows are merged only when their combined time span
    still fits the configured window, so two overlapping but distinct episodes
    remain separate and may share evidence transactions.
    """
    if not transactions or minimum_counterparties < 2:
        return []

    ordered = sorted(transactions, key=lambda tx: (int(tx["ts"]), str(tx.get("tx_id", ""))))
    counts: Counter[str] = Counter()
    right = 0
    windows: List[List[int]] = []

    for left, tx in enumerate(ordered):
        left_ts = int(tx["ts"])
        while right < len(ordered) and int(ordered[right]["ts"]) - left_ts <= window_seconds:
            counts[str(ordered[right][counterparty_key])] += 1
            right += 1

        if len(counts) >= minimum_counterparties:
            candidate_end = right - 1
            if (windows
                    and left_ts <= int(ordered[windows[-1][1]]["ts"])
                    and int(ordered[candidate_end]["ts"]) - int(ordered[windows[-1][0]]["ts"]) <= window_seconds):
                windows[-1][1] = max(windows[-1][1], candidate_end)
            else:
                windows.append([left, candidate_end])

        key = str(tx[counterparty_key])
        counts[key] -= 1
        if counts[key] <= 0:
            del counts[key]

    return [ordered[start:end + 1] for start, end in windows]


def normalize_transaction_rows(rows: List[Any]) -> tuple[List[Dict[str, Any]], int]:
    """Convert FalkorDB transaction rows, skipping malformed or unusable evidence."""
    normalized: List[Dict[str, Any]] = []
    invalid_count = 0
    for row in rows:
        try:
            if row is None or len(row) < 5:
                raise ValueError("short transaction row")
            tx_id, src, dst = (str(row[index]) if row[index] is not None else "" for index in range(3))
            amount = float(row[3])
            ts = int(row[4])
            if not tx_id or not src or not dst or not math.isfinite(amount) or amount < 0:
                raise ValueError("missing identifiers or invalid amount")
            if amount == 0:
                continue
            step = int(row[5] or 0) if len(row) > 5 else 0
            tx_type = str(row[6] or "") if len(row) > 6 else ""
            normalized.append({
                "tx_id": tx_id,
                "src": src,
                "dst": dst,
                "amount": amount,
                "ts": ts,
                "step": step,
                "tx_type": tx_type,
            })
        except (TypeError, ValueError, OverflowError):
            invalid_count += 1
    return normalized, invalid_count
