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
    from app.detectors.windowing import extract_overlapping_bursts, normalize_transaction_rows
    from app.queries import (
        FIND_FAN_IN_CANDIDATES,
        GET_ACCOUNT_INCOMING_TRANSFERS,
    )
except ImportError:
    from backend.app.db import FalkorDBClient
    from backend.app.detectors.windowing import extract_overlapping_bursts, normalize_transaction_rows
    from backend.app.queries import (
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
        invalid_rows_skipped: int = 0,
        truncation_reasons: Optional[List[str]] = None,
    ):
        super().__init__(hits)
        self.truncated = truncated
        self.truncation_reason = truncation_reason
        self.count = len(hits)
        self.invalid_rows_skipped = invalid_rows_skipped
        self.truncation_reasons = truncation_reasons or ([truncation_reason] if truncation_reason else [])


def extract_fan_in_bursts(
    txs: List[Dict[str, Any]],
    window_seconds: int = 172800,  # 48 hours
    min_senders: int = 8,
) -> List[List[Dict[str, Any]]]:
    """Extract merged maximal bursts of incoming transfers within rolling windows.

    A burst is formed when >= min_senders distinct sources send funds to the receiver
    within window_seconds. Parallel transfers between the same sender and receiver are
    fully preserved.
    """
    return extract_overlapping_bursts(
        txs, window_seconds, min_senders, counterparty_key="src"
    )


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

    # Merchant retail remains a benign context only when there is no structuring
    # signal; the independent structuring rule above still applies to merchants.
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
    edge_snapshot: Optional[Tuple[List[Dict[str, Any]], bool, int]] = None,
    account_types: Optional[Dict[str, str]] = None,
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
    truncation_reasons: List[str] = []
    invalid_rows_skipped = 0

    candidate_limit = max(limit * 10, 1000)
    snapshot_rows: Dict[str, List[Dict[str, Any]]] = {}
    if edge_snapshot is not None:
        snapshot_edges, snapshot_truncated, snapshot_invalid = edge_snapshot
        invalid_rows_skipped += snapshot_invalid
        if snapshot_invalid:
            is_truncated = True
            truncation_reasons.append("invalid_transaction_rows")
        if snapshot_truncated:
            is_truncated = True
            truncation_reasons.append("edge_read_limit")
        by_receiver: Dict[str, List[Dict[str, Any]]] = {}
        for edge in snapshot_edges:
            by_receiver.setdefault(edge["dst"], []).append(edge)
        candidate_rows = [[receiver, (account_types or {}).get(receiver, "personal"),
                           len({edge["src"] for edge in txs}), len(txs)]
                          for receiver, txs in by_receiver.items()
                          if len({edge["src"] for edge in txs}) >= min_senders]
        candidate_rows.sort(key=lambda row: (-row[2], row[0]))
        cand_truncated = len(candidate_rows) > candidate_limit
        candidate_rows = candidate_rows[:candidate_limit]
        snapshot_rows = by_receiver
    else:
        cand_res = client.execute_query(
            graph_name,
            FIND_FAN_IN_CANDIDATES,
            {"min_senders": min_senders, "limit": candidate_limit + 1},
            caller="detector:fan_in:candidates",
        )
        candidate_rows = cand_res.result_set if cand_res and cand_res.result_set else []
        cand_truncated = len(candidate_rows) > candidate_limit
    if cand_truncated:
        candidate_rows = candidate_rows[:candidate_limit]
        is_truncated = True
        truncation_reason = "candidate_limit_reached"
        truncation_reasons.append("candidate_limit_reached")

    # Step 2: For each candidate receiver, analyze incoming transfers
    for row in candidate_rows:
        dst_id = str(row[0])
        dst_type = str(row[1]) if row[1] else "personal"
        total_tx_count = int(row[3] or 0)

        # Fetch incoming transfers ordered by timestamp
        if edge_snapshot is not None:
            snapshot_txs = sorted(snapshot_rows.get(dst_id, []), key=lambda edge: (edge["ts"], edge["tx_id"]))
            raw_txs = [[edge["tx_id"], edge["src"], edge["dst"], edge["amount"], edge["ts"], edge["step"], edge["tx_type"]]
                       for edge in snapshot_txs[-max_txs_per_account:]]
        else:
            tx_res = client.execute_query(
                graph_name,
                GET_ACCOUNT_INCOMING_TRANSFERS,
                {"account_id": dst_id, "limit": max_txs_per_account},
                caller="detector:fan_in:transfers",
            )
            raw_txs = tx_res.result_set if tx_res and tx_res.result_set else []

        if not raw_txs:
            if total_tx_count:
                is_truncated = True
                truncation_reason = truncation_reason or "account_history_read_empty"
                truncation_reasons.append("account_history_read_empty")
            continue

        account_tx_truncated = (len(raw_txs) < total_tx_count) if edge_snapshot is None else (snapshot_truncated or len(snapshot_rows[dst_id]) > max_txs_per_account)
        if account_tx_truncated:
            is_truncated = True
            truncation_reason = truncation_reason or "account_history_limit_reached"
            truncation_reasons.append("account_history_limit_reached")

        tx_list, invalid_rows = normalize_transaction_rows(raw_txs)
        if invalid_rows:
            invalid_rows_skipped += invalid_rows
            is_truncated = True
            truncation_reason = truncation_reason or "invalid_transaction_rows"
            truncation_reasons.append("invalid_transaction_rows")

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
            if structuring_share >= 0.25:
                suspicion_rationale = f"{structuring_share:.1%} of transfers fall in the configured near-threshold band."
            elif dst_type != "merchant" and time_span <= 86400 and len(distinct_senders) >= 8:
                suspicion_rationale = "At least eight senders converged within 24 hours."
            elif structuring_share >= 0.15 and len(distinct_senders) >= 8:
                suspicion_rationale = f"Moderate near-threshold share ({structuring_share:.1%}) with at least eight senders."
            elif dst_type == "merchant" and structuring_share == 0.0:
                suspicion_rationale = "Merchant context with no near-threshold signal; pattern retained for context."
            else:
                suspicion_rationale = "Structural fan-in only; no configured suspicion signal was met."

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
                    "suspicion_indeterminate": False,
                    "suspicion_rationale": suspicion_rationale,
                },
                "explanation": explanation,
            }
            hits.append(hit)

    # Prefer hits with explicit suspicious signals so benign high-volume
    # merchants do not crowd the most useful results out of the response.
    hits.sort(key=lambda hit: (
        not hit["measurements"]["suspicious"],
        -hit["measurements"]["structuring_share"],
        -hit["measurements"]["distinct_senders"],
        hit["measurements"]["time_span_seconds"],
        -hit["measurements"]["total_amount"],
    ))
    if len(hits) > limit:
        is_truncated = True
        truncation_reason = truncation_reason or "result_limit_reached"
        truncation_reasons.append("result_limit_reached")

    if cand_truncated:
        is_truncated = True
        truncation_reason = truncation_reason or "candidate_limit_reached"
        if "candidate_limit_reached" not in truncation_reasons:
            truncation_reasons.append("candidate_limit_reached")

    return FanInDetectionResult(
        hits[:limit],
        truncated=is_truncated,
        truncation_reason=truncation_reason,
        invalid_rows_skipped=invalid_rows_skipped,
        truncation_reasons=list(dict.fromkeys(truncation_reasons)),
    )
