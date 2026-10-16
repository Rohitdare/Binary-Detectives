"""Fan-in transaction detector for RingTrace.

Identifies multiple distinct sender accounts transferring to the same receiver
within a rolling time window (e.g., 48 hours).

Key Principles & Invariants:
- Zero ground-truth leakage: Operates strictly against the 'txn' graph.
- Complete evidence: Retains all transaction IDs, including parallel transfers
  between the same accounts. Distinct senders are counted uniquely.
- Business context preservation: Accounts are never classified as suspicious merely
  because their type is 'personal', nor are 'merchant' accounts automatically deemed
  benign. Account type is preserved as context, and suspicion follows explicit,
  documented heuristic criteria.
- Configurable structuring range: Treats amounts in (42,500, 49,500) as a
  configurable, simulator-derived near-threshold structuring indicator, not an
  inflexible universal legal standard.
- Stable deduplication: Hit IDs are derived deterministically from the receiver account
  and the sorted set of transaction IDs in the burst.
"""
import hashlib
from typing import Any, Dict, List, Optional, Set, Tuple

try:
    from app.db import FalkorDBClient
    from app.queries import (
        COUNT_ACCOUNT_INCOMING_TOTAL,
        FIND_FAN_IN_CANDIDATES,
        GET_ACCOUNT_INCOMING_TRANSFERS,
    )
except ImportError:
    from backend.app.db import FalkorDBClient
    from backend.app.queries import (
        COUNT_ACCOUNT_INCOMING_TOTAL,
        FIND_FAN_IN_CANDIDATES,
        GET_ACCOUNT_INCOMING_TRANSFERS,
    )


class FanInDetectionResult(list):
    """List of fan_in hit candidates augmented with truncation metadata."""

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


def extract_fan_in_bursts(
    txs: List[Dict[str, Any]],
    window_seconds: int = 172800,  # 48 hours
    min_senders: int = 8,
) -> List[List[Dict[str, Any]]]:
    """Extract non-overlapping maximal bursts of incoming transfers within a rolling window.

    A burst is formed when >= min_senders distinct sources send funds to the receiver
    within window_seconds. Parallel transfers between the same sender and receiver are
    fully preserved.
    """
    if not txs or min_senders < 2:
        return []

    # Sort strictly by timestamp ASC
    sorted_txs = sorted(txs, key=lambda t: t["ts"])
    n = len(sorted_txs)
    bursts: List[List[Dict[str, Any]]] = []
    i = 0

    while i < n:
        # Find all qualifying windows starting at or around i
        best_window = None
        best_distinct_senders = 0

        # Scan rightward within window_seconds
        j = i
        current_senders: Set[str] = set()
        while j < n and (sorted_txs[j]["ts"] - sorted_txs[i]["ts"]) <= window_seconds:
            current_senders.add(sorted_txs[j]["src"])
            j += 1

        if len(current_senders) >= min_senders:
            candidate_window = sorted_txs[i:j]
            # Greedily expand rightward if subsequent transactions remain within window of the burst
            # or represent the same cluster
            best_window = candidate_window
            best_distinct_senders = len(current_senders)

        if best_window:
            bursts.append(best_window)
            # Advance past this burst window to identify separate, distinct burst episodes
            i = j
        else:
            i += 1

    return bursts


def evaluate_fan_in_suspicion(
    receiver_type: str,
    distinct_senders: int,
    tx_count: int,
    time_span_seconds: int,
    structuring_share: float,
    total_amount: float,
) -> bool:
    """Evaluate whether a fan_in burst is suspicious under explicit, documented rules.

    Explicit Rules:
    1. Structuring alert: If structuring_share >= 0.25 (significant proportion of transfers
       in the simulator-derived near-threshold band), the pattern is suspicious regardless
       of whether the receiver is personal, merchant, or payroll.
    2. Rapid high-concentration convergence: If distinct_senders >= 8 within <= 24 hours (86,400s)
       and the receiver is NOT a verified merchant with zero structuring, it is suspicious.
    3. Benign merchant retail: If receiver_type == 'merchant' and structuring_share == 0.0,
       it reflects normal retail counterparty aggregation and is NOT suspicious.
    4. Benign personal pooling: If receiver_type == 'personal' but structuring_share == 0.0
       and transfers are diffuse (> 24 hours), it is NOT marked suspicious solely because
       the account is personal.
    """
    # Rule 1: High structuring concentration is suspicious across all account types
    if structuring_share >= 0.25:
        return True

    # Rule 3: Verified merchant with zero structuring is benign retail activity
    if receiver_type == "merchant" and structuring_share == 0.0:
        return False

    # Rule 2: Fast convergence (< 24 hours) with multiple senders on non-merchant
    if time_span_seconds <= 86400 and distinct_senders >= 8 and receiver_type != "merchant":
        return True

    # Moderate structuring (>= 15%) combined with high counterparty count (>= 8)
    if structuring_share >= 0.15 and distinct_senders >= 8:
        return True

    return False


def detect_fan_in(
    min_senders: int = 8,
    window_seconds: int = 172800,  # 48 hours
    limit: int = 50,
    graph_name: str = "txn",
    db: Optional[FalkorDBClient] = None,
    structuring_range: Tuple[float, float] = (42500.0, 49500.0),
    max_txs_per_account: int = 5000,
) -> FanInDetectionResult:
    """Detect fan-in patterns in FalkorDB within rolling time windows.

    Args:
        min_senders: Minimum distinct sender accounts required in a window (default: 8).
        window_seconds: Rolling window width in seconds (default: 48h = 172,800s).
        limit: Maximum number of hit candidates to return (1-200).
        graph_name: Graph name to search (defaults to 'txn').
        db: Optional existing FalkorDBClient instance.
        structuring_range: Simulator-derived amount bounds for near-threshold structuring.
        max_txs_per_account: Safety query limit for incoming transactions per account.

    Returns:
        FanInDetectionResult containing structured Hit objects and truncation metadata.
    """
    if min_senders < 2:
        raise ValueError(f"min_senders must be at least 2 (got {min_senders}).")
    if window_seconds < 60:
        raise ValueError(f"window_seconds must be at least 60s (got {window_seconds}).")
    if limit < 1 or limit > 200:
        raise ValueError(f"limit must be between 1 and 200 (got {limit}).")

    client = db or FalkorDBClient()
    hits: List[Dict[str, Any]] = []
    seen_hit_ids: Set[str] = set()
    is_truncated = False
    truncation_reason = None

    candidate_limit = max(limit * 5, 250)
    cand_res = client.execute_query(
        graph_name,
        FIND_FAN_IN_CANDIDATES,
        {"min_senders": min_senders, "limit": candidate_limit + 1},
        caller="detector:fan_in:candidates",
    )

    if not cand_res or not cand_res.result_set:
        return FanInDetectionResult([], truncated=False)

    candidate_rows = cand_res.result_set
    cand_truncated = len(candidate_rows) > candidate_limit
    if cand_truncated:
        candidate_rows = candidate_rows[:candidate_limit]

    # Step 2: For each candidate receiver, analyze incoming transfers
    for row in candidate_rows:
        dst_id = str(row[0])
        dst_type = str(row[1]) if row[1] else "personal"

        # Check total incoming transaction volume to detect safety truncation
        count_res = client.execute_query(
            graph_name,
            COUNT_ACCOUNT_INCOMING_TOTAL,
            {"account_id": dst_id},
            caller="detector:fan_in:count",
        )
        total_tx_count = count_res.result_set[0][0] if (count_res and count_res.result_set) else 0

        # Fetch incoming transfers ordered by timestamp
        tx_res = client.execute_query(
            graph_name,
            GET_ACCOUNT_INCOMING_TRANSFERS,
            {"account_id": dst_id, "limit": max_txs_per_account},
            caller="detector:fan_in:transfers",
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
        bursts = extract_fan_in_bursts(
            tx_list,
            window_seconds=window_seconds,
            min_senders=min_senders,
        )

        for burst in bursts:
            distinct_senders = sorted(list({t["src"] for t in burst}))
            tx_ids = [t["tx_id"] for t in burst]
            amounts = [t["amount"] for t in burst]
            timestamps = [t["ts"] for t in burst]

            total_amt = round(sum(amounts), 2)
            time_span = max(0, max(timestamps) - min(timestamps))

            # Structuring calculation
            s_low, s_high = structuring_range
            structuring_count = sum(1 for a in amounts if s_low <= a <= s_high)
            structuring_share = round(structuring_count / len(amounts), 4)

            # Small transfer share (< 50,000 threshold indicator)
            small_count = sum(1 for a in amounts if a < 50000.0)
            small_transfer_share = round(small_count / len(amounts), 4)

            # Evaluate suspicion
            is_suspicious = evaluate_fan_in_suspicion(
                receiver_type=dst_type,
                distinct_senders=len(distinct_senders),
                tx_count=len(burst),
                time_span_seconds=time_span,
                structuring_share=structuring_share,
                total_amount=total_amt,
            )

            # Stable deterministic hit_id
            sig = f"fan_in:{dst_id}:" + ",".join(sorted(tx_ids))
            hit_id = f"HIT_fan_in_{hashlib.sha256(sig.encode('utf-8')).hexdigest()[:10]}"

            if hit_id in seen_hit_ids:
                continue
            seen_hit_ids.add(hit_id)

            explanation = (
                f"Account {dst_id} ({dst_type}) received {len(burst)} transfers totaling "
                f"₹{total_amt:,.2f} from {len(distinct_senders)} distinct senders within {time_span}s "
                f"(structuring share: {structuring_share:.1%}, small-transfer share: {small_transfer_share:.1%})."
            )

            hit = {
                "hit_id": hit_id,
                "pattern": "fan_in",
                "account_ids": [dst_id] + distinct_senders,
                "tx_ids": tx_ids,
                "transactions": burst,
                "measurements": {
                    "distinct_senders": len(distinct_senders),
                    "tx_count": len(burst),
                    "total_amount": total_amt,
                    "time_span_seconds": time_span,
                    "structuring_share": structuring_share,
                    "small_transfer_share": small_transfer_share,
                    "receiver_account_type": dst_type,
                    "suspicious": is_suspicious,
                    "account_tx_truncated": account_tx_truncated,
                },
                "explanation": explanation,
            }
            hits.append(hit)

            if len(hits) >= limit:
                is_truncated = True
                truncation_reason = "result_limit_reached"
                break

        if len(hits) >= limit:
            break

    if not is_truncated and cand_truncated:
        is_truncated = True
        truncation_reason = "candidate_limit_reached"

    return FanInDetectionResult(
        hits[:limit],
        truncated=is_truncated,
        truncation_reason=truncation_reason,
    )
