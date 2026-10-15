"""Directed transaction cycle detector for RingTrace.

Identifies closed directed money loops in the transaction graph without
relying on ground-truth label annotations. Uses canonical node rotation
at the query layer to prevent duplicate reporting of rotated cycles.
"""
import hashlib
from typing import Any, Dict, List, Optional, Tuple

try:
    from app.db import FalkorDBClient
    from app.queries import CYCLE_3_QUERY, CYCLE_4_QUERY, CYCLE_5_QUERY
except ImportError:
    from backend.app.db import FalkorDBClient
    from backend.app.queries import CYCLE_3_QUERY, CYCLE_4_QUERY, CYCLE_5_QUERY


def check_time_ordering(txs: List[Dict[str, Any]]) -> bool:
    """Check if there exists a cyclic starting edge such that timestamps are non-decreasing."""
    n = len(txs)
    if n <= 1:
        return True
    return any(
        all(txs[(start + j) % n]["ts"] <= txs[(start + j + 1) % n]["ts"] for j in range(n - 1))
        for start in range(n)
    )


def detect_cycles(
    min_length: int = 3,
    max_length: int = 5,
    limit: int = 50,
    graph_name: str = "txn",
    db: Optional[FalkorDBClient] = None,
) -> List[Dict[str, Any]]:
    """Detect directed transaction cycles in FalkorDB within specified length bounds.

    Args:
        min_length: Minimum cycle length (number of hops/edges), bounded between 3 and 5.
        max_length: Maximum cycle length (number of hops/edges), bounded between 3 and 5.
        limit: Maximum number of cycle candidates to return, bounded between 1 and 200.
        graph_name: FalkorDB graph name to search (defaults to 'txn').
        db: Optional existing FalkorDBClient instance.

    Returns:
        List of structured cycle candidate dictionaries containing ordered accounts,
        supporting transaction evidence, temporal features, and factual explanations.

    Raises:
        ValueError: If parameters are invalid or out of safe bounds.
    """
    # 1. Parameter Validation
    if not isinstance(min_length, int) or not isinstance(max_length, int) or not isinstance(limit, int):
        raise ValueError("min_length, max_length, and limit must be integers.")
    if min_length < 3 or min_length > 5:
        raise ValueError(f"min_length must be between 3 and 5 (got {min_length}).")
    if max_length < 3 or max_length > 5:
        raise ValueError(f"max_length must be between 3 and 5 (got {max_length}).")
    if min_length > max_length:
        raise ValueError(f"min_length ({min_length}) cannot exceed max_length ({max_length}).")
    if limit < 1 or limit > 200:
        raise ValueError(f"limit must be between 1 and 200 (got {limit}).")

    client = db or FalkorDBClient()
    queries_by_length = {
        3: CYCLE_3_QUERY,
        4: CYCLE_4_QUERY,
        5: CYCLE_5_QUERY,
    }

    candidates: List[Dict[str, Any]] = []
    seen_account_tuples = set()

    # Query requested lengths in order
    for cycle_len in range(min_length, max_length + 1):
        if len(candidates) >= limit:
            break

        query = queries_by_length[cycle_len]
        remaining_limit = limit - len(candidates)

        # Execute centralized query with bounded limit
        res = client.execute_query(
            graph_name,
            query,
            {"limit": remaining_limit * 3},  # Fetch slightly more to account for parallel edge grouping
            caller=f"detector:cycle:len_{cycle_len}",
        )

        if not res or not res.result_set:
            continue

        # Group rows by canonical account sequence
        # For length k, row format is:
        # col 0..k-1: account IDs
        # subsequent cols: 5 props per hop (tx_id, amount, ts, step, tx_type)
        grouped_by_accounts: Dict[Tuple[str, ...], List[List[Dict[str, Any]]]] = {}

        for row in res.result_set:
            accounts = tuple(str(row[i]) for i in range(cycle_len))
            tx_list: List[Dict[str, Any]] = []

            for hop in range(cycle_len):
                base_idx = cycle_len + (hop * 5)
                src = accounts[hop]
                dst = accounts[(hop + 1) % cycle_len]
                tx_list.append({
                    "tx_id": str(row[base_idx]),
                    "src": src,
                    "dst": dst,
                    "amount": round(float(row[base_idx + 1]), 2),
                    "ts": int(row[base_idx + 2]),
                    "step": int(row[base_idx + 3]),
                    "tx_type": str(row[base_idx + 4]),
                })

            if accounts not in grouped_by_accounts:
                grouped_by_accounts[accounts] = []
            grouped_by_accounts[accounts].append(tx_list)

        # Process grouped cycles
        for accounts, edge_sets in grouped_by_accounts.items():
            if accounts in seen_account_tuples:
                continue
            seen_account_tuples.add(accounts)

            # Choose best representative edge set (prioritize time-ordered flow, then lowest duration)
            best_txs = edge_sets[0]
            best_is_ordered = check_time_ordering(best_txs)
            best_dur = max(t["ts"] for t in best_txs) - min(t["ts"] for t in best_txs)

            for alt_txs in edge_sets[1:]:
                alt_is_ordered = check_time_ordering(alt_txs)
                alt_dur = max(t["ts"] for t in alt_txs) - min(t["ts"] for t in alt_txs)
                if (alt_is_ordered and not best_is_ordered) or (alt_is_ordered == best_is_ordered and alt_dur < best_dur):
                    best_txs = alt_txs
                    best_is_ordered = alt_is_ordered
                    best_dur = alt_dur

            # Collect all distinct supporting transaction IDs across parallel edges
            all_tx_dict = {}
            for es in edge_sets:
                for tx in es:
                    all_tx_dict[tx["tx_id"]] = tx

            amounts = [tx["amount"] for tx in best_txs]
            total_amount = round(sum(amounts), 2)
            min_amt = min(amounts)
            max_amt = max(amounts)
            conservation_ratio = round(min_amt / max_amt, 4) if max_amt > 0 else 1.0

            timestamps = [tx["ts"] for tx in best_txs]
            first_ts = min(timestamps)
            last_ts = max(timestamps)
            duration_s = max(0, last_ts - first_ts)

            # Deterministic canonical cycle ID
            acc_list = list(accounts)
            account_hash = hashlib.sha256(",".join(acc_list).encode("utf-8")).hexdigest()[:10]
            cycle_id = f"CYC_{cycle_len}_{account_hash}"

            # Objective factual explanation
            ordering_desc = "chronological (forward-ordered timestamps)" if best_is_ordered else "non-chronological (disordered timestamps)"
            explanation = (
                f"Directed {cycle_len}-hop cycle across accounts {' -> '.join(acc_list)} -> {acc_list[0]} "
                f"supported by {len(best_txs)} transactions totaling ${total_amount:,.2f} "
                f"over {duration_s} seconds ({ordering_desc}, amount ratio {conservation_ratio:.2%}). "
                f"Structural pattern requires investigative review."
            )

            candidate = {
                "cycle_id": cycle_id,
                "pattern_type": "cycle",
                "candidate_type": "cycle_candidate",
                "cycle_length": cycle_len,
                "accounts": acc_list,
                "transactions": best_txs,
                "all_supporting_transactions": list(all_tx_dict.values()),
                "total_amount": total_amount,
                "min_amount": min_amt,
                "max_amount": max_amt,
                "amount_conservation_ratio": conservation_ratio,
                "first_transaction_ts": first_ts,
                "last_transaction_ts": last_ts,
                "duration_seconds": duration_s,
                "is_time_ordered": best_is_ordered,
                "explanation": explanation,
            }

            candidates.append(candidate)
            if len(candidates) >= limit:
                break

    return candidates
