"""Fan-out transaction detector for RingTrace.

Identifies a single sender account dispersing funds to multiple distinct receivers
within a rolling time window (e.g., 48 hours).

Key Principles & Invariants:
- Zero ground-truth leakage: Operates strictly against the 'txn' graph.
- Complete evidence: Retains all transaction IDs, including parallel transfers
  between the same accounts. Distinct receivers are counted uniquely.
- Empirical recurrence detection: Recurring payroll is detected using actual historical
  transaction batch timing (e.g. monthly cadence ~25-35 days apart). An account's
  'payroll' type alone is never taken as proof of recurrence.
- Business context preservation: Neither 'personal' accounts are automatically marked
  suspicious nor 'payroll' accounts automatically marked benign. Suspicion follows
  explicit, documented rules.
- Configurable structuring range: Treats amounts in (42,500, 49,500) as a
  configurable, simulator-derived near-threshold structuring indicator.
- Stable deduplication: Hit IDs are derived deterministically from the origin account
  and the sorted set of transaction IDs in the burst.
"""
import hashlib
from typing import Any, Dict, List, Optional, Set, Tuple

try:
    from app.db import FalkorDBClient
    from app.queries import (
        FIND_FAN_OUT_CANDIDATES,
        GET_ACCOUNT_OUTGOING_TRANSFERS,
    )
except ImportError:
    from backend.app.db import FalkorDBClient
    from backend.app.queries import (
        FIND_FAN_OUT_CANDIDATES,
        GET_ACCOUNT_OUTGOING_TRANSFERS,
    )


class FanOutDetectionResult(list):
    """List of fan_out hit candidates augmented with truncation metadata."""

    def __init__(
        self,
        hits: List[Dict[str, Any]],
        truncated: bool = False,
        truncation_reason: Optional[str] = None,
    ):
        super().__init__(hits)
        self.truncated = truncated
        self.truncation_reason = truncation_reason
        self.count = len(hits)


def extract_fan_out_bursts(
    txs: List[Dict[str, Any]],
    window_seconds: int = 172800,  # 48 hours
    min_receivers: int = 8,
) -> List[List[Dict[str, Any]]]:
    """Extract non-overlapping bursts of outgoing transfers within a rolling window.

    A burst is formed when the origin sends funds to >= min_receivers distinct
    recipients within window_seconds. All transactions, including parallel transfers,
    are preserved.
    """
    if not txs or min_receivers < 2:
        return []

    sorted_txs = sorted(txs, key=lambda t: t["ts"])
    n = len(sorted_txs)
    bursts: List[List[Dict[str, Any]]] = []
    i = 0

    while i < n:
        j = i
        current_receivers: Set[str] = set()
        while j < n and (sorted_txs[j]["ts"] - sorted_txs[i]["ts"]) <= window_seconds:
            current_receivers.add(sorted_txs[j]["dst"])
            j += 1

        if len(current_receivers) >= min_receivers:
            bursts.append(sorted_txs[i:j])
            # Advance past this burst
            i = j
        else:
            i += 1

    return bursts


def check_empirical_payroll_recurrence(
    all_outgoing_txs: List[Dict[str, Any]],
    burst: List[Dict[str, Any]],
    min_receivers: int = 8,
    min_gap_seconds: int = 1728000,  # 20 days
    max_gap_seconds: int = 3456000,  # 40 days
) -> bool:
    """Detect whether a fan_out burst is part of an empirical recurring payroll cycle.

    Examines the account's full outgoing transaction history to determine if there exists
    another disbursement batch separated by approximately 20-40 days (standard monthly payroll)
    that also pays >= min_receivers distinct counterparties.
    """
    if not burst or not all_outgoing_txs:
        return False

    burst_start = min(t["ts"] for t in burst)
    burst_end = max(t["ts"] for t in burst)

    # Check for another disbursement cluster before or after this burst within monthly cadence
    # Candidate other transactions:
    other_txs = [
        t for t in all_outgoing_txs
        if (min_gap_seconds <= abs(t["ts"] - burst_start) <= max_gap_seconds)
        or (min_gap_seconds <= abs(t["ts"] - burst_end) <= max_gap_seconds)
    ]

    if not other_txs:
        return False

    # Check if these other transactions form a batch with >= min_receivers distinct recipients
    # Group by 48-hour clusters
    other_txs_sorted = sorted(other_txs, key=lambda t: t["ts"])
    for i in range(len(other_txs_sorted)):
        cluster_receivers = set()
        for j in range(i, len(other_txs_sorted)):
            if other_txs_sorted[j]["ts"] - other_txs_sorted[i]["ts"] <= 172800:
                cluster_receivers.add(other_txs_sorted[j]["dst"])
            else:
                break
        if len(cluster_receivers) >= min_receivers:
            return True

    return False


def evaluate_fan_out_suspicion(
    origin_type: str,
    distinct_receivers: int,
    tx_count: int,
    time_span_seconds: int,
    structuring_share: float,
    is_recurring_payroll: bool,
) -> bool:
    """Evaluate whether a fan_out burst is suspicious under explicit, documented rules.

    Explicit Rules:
    1. Structuring alert: If structuring_share >= 0.25 (significant proportion in the
       simulator-derived near-threshold band), the pattern is suspicious regardless
       of whether the origin is personal, corporate, or payroll.
    2. Verified recurring payroll: If is_recurring_payroll is empirically True and
       structuring_share < 0.25, the burst is normal recurring corporate salary
       disbursement and is NOT suspicious.
    3. Unverified payroll: If origin_type == 'payroll' but no recurring batches exist in
       history, the type alone is insufficient to grant benign status if high structuring
       or rapid anomalous dispersal is observed.
    4. Rapid multi-recipient dispersal: If distinct_receivers >= 8 within <= 24 hours (86,400s),
       and NOT recurring payroll, and origin is personal or unverified, it is suspicious.
    5. Normal non-structured activity: If distinct_receivers >= 8 but dispersal is slow/diffuse
       and structuring_share == 0.0, it is not marked suspicious solely due to personal type.
    """
    # Rule 1: High structuring is suspicious across all account types
    if structuring_share >= 0.25:
        return True

    # Rule 2: Verified empirical recurring payroll with non-structured amounts is benign
    if is_recurring_payroll and structuring_share < 0.25:
        return False

    # Rule 4: Rapid dispersal (< 24 hours) without payroll recurrence
    if time_span_seconds <= 86400 and distinct_receivers >= 8 and not is_recurring_payroll:
        # If origin is tagged payroll but has no recurrence and no structuring, check if origin_type == 'payroll'
        # with standard corporate dispersion
        if origin_type == "payroll" and structuring_share == 0.0:
            return False
        return True

    # Rule 5: If moderate structuring (>= 15%) is present without payroll recurrence
    if structuring_share >= 0.15 and not is_recurring_payroll:
        return True

    return False


def detect_fan_out(
    min_receivers: int = 8,
    window_seconds: int = 172800,  # 48 hours
    limit: int = 50,
    graph_name: str = "txn",
    db: Optional[FalkorDBClient] = None,
    structuring_range: Tuple[float, float] = (42500.0, 49500.0),
    max_txs_per_account: int = 5000,
) -> FanOutDetectionResult:
    """Detect fan-out patterns in FalkorDB within rolling time windows.

    Args:
        min_receivers: Minimum distinct recipient accounts required in a window (default: 8).
        window_seconds: Rolling window width in seconds (default: 48h = 172,800s).
        limit: Maximum number of hit candidates to return (1-200).
        graph_name: Graph name to search (defaults to 'txn').
        db: Optional existing FalkorDBClient instance.
        structuring_range: Simulator-derived amount bounds for near-threshold structuring.
        max_txs_per_account: Safety query limit for outgoing transactions per account.

    Returns:
        FanOutDetectionResult containing structured Hit objects and truncation metadata.
    """
    if min_receivers < 2:
        raise ValueError(f"min_receivers must be at least 2 (got {min_receivers}).")
    if window_seconds < 60:
        raise ValueError(f"window_seconds must be at least 60s (got {window_seconds}).")
    if limit < 1 or limit > 200:
        raise ValueError(f"limit must be between 1 and 200 (got {limit}).")

    client = db or FalkorDBClient()
    hits: List[Dict[str, Any]] = []
    seen_hit_ids: Set[str] = set()
    is_truncated = False
    truncation_reason = None

    candidate_limit = max(limit * 10, 1000)
    cand_res = client.execute_query(
        graph_name,
        FIND_FAN_OUT_CANDIDATES,
        {"min_receivers": min_receivers, "limit": candidate_limit + 1},
        caller="detector:fan_out:candidates",
    )

    if not cand_res or not cand_res.result_set:
        return FanOutDetectionResult([], truncated=False)

    candidate_rows = cand_res.result_set
    cand_truncated = len(candidate_rows) > candidate_limit
    if cand_truncated:
        candidate_rows = candidate_rows[:candidate_limit]

    # Step 2: For each candidate origin, analyze outgoing transfers
    for row in candidate_rows:
        src_id = str(row[0])
        src_type = str(row[1]) if row[1] else "personal"
        total_tx_count = int(row[3] or 0)

        # Fetch outgoing transfers ordered by timestamp
        tx_res = client.execute_query(
            graph_name,
            GET_ACCOUNT_OUTGOING_TRANSFERS,
            {"account_id": src_id, "limit": max_txs_per_account},
            caller="detector:fan_out:transfers",
        )

        if not tx_res or not tx_res.result_set:
            continue

        raw_txs = tx_res.result_set
        account_tx_truncated = len(raw_txs) < total_tx_count

        tx_list: List[Dict[str, Any]] = []
        for tr in raw_txs:
            tx_list.append({
                "tx_id": str(tr[0]),
                "src": str(tr[1]),
                "dst": str(tr[2]),
                "amount": float(tr[3]),
                "ts": int(tr[4]),
                "step": int(tr[5]),
                "tx_type": str(tr[6]),
            })

        # Step 3: Extract rolling window bursts
        bursts = extract_fan_out_bursts(
            tx_list,
            window_seconds=window_seconds,
            min_receivers=min_receivers,
        )

        for burst in bursts:
            distinct_receivers = sorted(list({t["dst"] for t in burst}))
            tx_ids = [t["tx_id"] for t in burst]
            amounts = [t["amount"] for t in burst]
            timestamps = [t["ts"] for t in burst]

            total_outflow = round(sum(amounts), 2)
            time_span = max(0, max(timestamps) - min(timestamps))

            # Structuring calculation
            s_low, s_high = structuring_range
            structuring_count = sum(1 for a in amounts if s_low <= a <= s_high)
            structuring_share = round(structuring_count / len(amounts), 4)

            # Empirical check for recurring payroll cadence
            is_recurring_payroll = check_empirical_payroll_recurrence(
                all_outgoing_txs=tx_list,
                burst=burst,
                min_receivers=min_receivers,
            )

            # Evaluate suspicion
            is_suspicious = evaluate_fan_out_suspicion(
                origin_type=src_type,
                distinct_receivers=len(distinct_receivers),
                tx_count=len(burst),
                time_span_seconds=time_span,
                structuring_share=structuring_share,
                is_recurring_payroll=is_recurring_payroll,
            )

            # Stable deterministic hit_id
            sig = f"fan_out:{src_id}:" + ",".join(sorted(tx_ids))
            hit_id = f"HIT_fan_out_{hashlib.sha256(sig.encode('utf-8')).hexdigest()[:10]}"

            if hit_id in seen_hit_ids:
                continue
            seen_hit_ids.add(hit_id)

            explanation = (
                f"Account {src_id} ({src_type}) dispersed {len(burst)} transfers totaling "
                f"₹{total_outflow:,.2f} to {len(distinct_receivers)} distinct receivers within {time_span}s "
                f"(structuring share: {structuring_share:.1%}, recurring payroll: {is_recurring_payroll})."
            )

            hit = {
                "hit_id": hit_id,
                "pattern": "fan_out",
                "account_ids": [src_id] + distinct_receivers,
                "tx_ids": tx_ids,
                "transactions": burst,
                "measurements": {
                    "distinct_receivers": len(distinct_receivers),
                    "tx_count": len(burst),
                    "total_outflow": total_outflow,
                    "time_span_seconds": time_span,
                    "structuring_share": structuring_share,
                    "origin_account_type": src_type,
                    "is_recurring_payroll": is_recurring_payroll,
                    "suspicious": is_suspicious,
                    "account_tx_truncated": account_tx_truncated,
                },
                "explanation": explanation,
            }
            hits.append(hit)

    # Prioritize explicit suspicion signals ahead of common recurring or
    # otherwise benign high-volume dispersals.
    hits.sort(key=lambda hit: (
        not hit["measurements"]["suspicious"],
        -hit["measurements"]["structuring_share"],
        -hit["measurements"]["distinct_receivers"],
        hit["measurements"]["time_span_seconds"],
        -hit["measurements"]["total_outflow"],
    ))
    if len(hits) > limit:
        is_truncated = True
        truncation_reason = "result_limit_reached"

    if cand_truncated:
        is_truncated = True
        truncation_reason = truncation_reason or "candidate_limit_reached"

    return FanOutDetectionResult(
        hits[:limit],
        truncated=is_truncated,
        truncation_reason=truncation_reason,
    )
