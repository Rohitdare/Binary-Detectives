"""Explainable case priority scoring. Scores are triage points, not probabilities."""
import math
from typing import Any, Dict, Iterable, Mapping

PATTERN_SEVERITY = {
    "cycle": 30, "fan_in": 24, "fan_out": 22, "relay_chain": 32,
    "scatter_gather": 28, "gather_scatter": 26, "bipartite": 20,
    "dense_cluster": 18, "hub_account": 0,
}


def score_case(
    hits: Iterable[Mapping[str, Any]],
    transactions: Iterable[Mapping[str, Any]],
    account_count: int,
    account_types: Mapping[str, str] | None = None,
) -> Dict[str, Any]:
    """Return a capped 0–100 breakdown using pattern, amount, speed and corroboration."""
    hit_rows = list(hits)
    tx_by_id = {}
    if transactions:
        for tx in transactions:
            if isinstance(tx, dict) and tx.get("tx_id"):
                tx_by_id[str(tx["tx_id"])] = tx
    for hit in hit_rows:
        for tx in hit.get("transactions", []):
            if isinstance(tx, dict) and tx.get("tx_id") and str(tx["tx_id"]) not in tx_by_id:
                tx_by_id[str(tx["tx_id"])] = tx

    patterns = {str(hit.get("pattern", "")) for hit in hit_rows if hit.get("pattern")}
    severity_base = min(35, max((PATTERN_SEVERITY.get(pattern, 10) for pattern in patterns), default=0))
    account_types = account_types or {}
    origin_ids = {
        account_id
        for hit in hit_rows
        for account_id, role in (hit.get("account_roles") or {}).items()
        if role in {"origin", "source"}
    }
    if not origin_ids:
        for hit in hit_rows:
            raw_accs = hit.get("account_ids") or hit.get("accounts") or []
            if raw_accs:
                origin_ids.add(str(raw_accs[0]))

    business_origin = any(account_types.get(account_id) in {"merchant", "payroll"} for account_id in origin_ids)
    severity = max(0, min(35, severity_base - (10 if business_origin else 0)))

    total_amount = sum(float(tx.get("amount", 0.0) or 0.0) for tx in tx_by_id.values())
    amount = min(20, max(0, round(5 * math.log10(1 + max(0.0, total_amount) / 1000))))

    times = [int(tx["ts"]) for tx in tx_by_id.values() if tx.get("ts") is not None]
    duration = max(times) - min(times) if len(times) > 1 else 0
    if not times:
        velocity = 0
    else:
        velocity = 15 if duration <= 3600 else 11 if duration <= 86400 else 6 if duration <= 7 * 86400 else 2

    account_score = 0 if account_count <= 0 else min(10, max(0, round(2 * math.log2(account_count))))
    corroboration = min(20, max(0, len(patterns - {"hub_account"}) - 1) * 10)
    if "hub_account" in patterns and corroboration < 20:
        corroboration = min(20, corroboration + 5)

    total = min(100, max(0, severity + amount + velocity + account_score + corroboration))
    return {
        "severity": severity,
        "amount": amount,
        "velocity": velocity,
        "account_count": account_score,
        "corroboration": corroboration,
        "total": total,
        "score_type": "triage_priority_not_probability",
        "origin_context_adjustment": -10 if business_origin else 0,
        "total_amount": round(total_amount, 2),
        "duration_seconds": duration,
        "severity_label": "high" if total >= 70 else "medium" if total >= 40 else "low",
    }
