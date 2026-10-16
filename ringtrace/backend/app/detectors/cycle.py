"""Directed transaction cycle detector for RingTrace.

Identifies time-ordered closed directed money loops from a bounded transaction
edge read without relying on ground-truth label annotations.

Canonical Identity:
- A cycle is an ordered list of directed edges (by tx_id) that returns to its start.
- It rotates to a canonical start (the lexicographically smallest tx_id) while preserving
  edge traversal order.
- Accounts are ordered along the directed edge sequence, NOT sorted alphabetically.
- Reversed cycles are not merged unless edge sequences are identical.
- Cycles with the same account sequence but different tx_ids remain separate candidates.
- Canonical ID is a deterministic hash of the canonical edge sequence: CYC_{len}_{hash(tx_ids)[:10]}.

Constraints & Pruning:
- Length: min_length to max_length (bounded between 3 and 5).
- Chronological forward progression: t_1 < t_2 < ... < t_k.
- Bounded hop gap: 60s <= (t_{i+1} - t_i) <= 13 hours.
- Retention ratio: 0.89 <= (amt_{i+1} / amt_i) <= 1.05.
- Zero/missing amount guard: skip edge, never divide by zero.
- Distinct accounts: simple cycles only (no internal self-intersections).

Truncation is reported when either the result limit, transaction scan limit, or
search-work limit is reached. A truncated empty result is not a clean negative.
"""
import hashlib
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

try:
    from app.db import FalkorDBClient
    from app.queries import GET_CYCLE_EDGES
except ImportError:
    from backend.app.db import FalkorDBClient
    from backend.app.queries import GET_CYCLE_EDGES


EDGE_SCAN_LIMIT = 250_000
EDGE_PAGE_SIZE = 10_000
SEARCH_STEP_LIMIT = 1_000_000


class CycleDetectionResult(list):
    """List of cycle candidates augmented with truncation metadata."""

    def __init__(
        self,
        candidates: List[Dict[str, Any]],
        truncated: bool = False,
        truncation_reason: Optional[str] = None,
    ):
        super().__init__(candidates)
        self.truncated = truncated
        self.truncation_reason = truncation_reason
        self.count = len(candidates)
        self.edges_scanned = 0
        self.search_steps = 0


def canonicalize_cycle_edges(
    edges: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[str], str]:
    """Rotate a directed cycle of edges to its canonical representation.

    1. Rotates to the lexicographically smallest tx_id as the canonical start.
    2. Preserves the directed traversal order of edges.
    3. Derives ordered accounts from the rotated edge sequence: [e['src'] for e in rotated_edges].
    4. Computes deterministic canonical ID from the canonical edge tx_id sequence.
    """
    k = len(edges)
    if k == 0:
        return [], [], ""
    min_idx = min(range(k), key=lambda i: edges[i]["tx_id"])
    canonical_edges = edges[min_idx:] + edges[:min_idx]
    canonical_accounts = [e["src"] for e in canonical_edges]
    edge_sig = ",".join(e["tx_id"] for e in canonical_edges)
    canonical_id = f"CYC_{k}_{hashlib.sha256(edge_sig.encode('utf-8')).hexdigest()[:10]}"
    return canonical_edges, canonical_accounts, canonical_id


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
    min_gap: int = 60,
    max_gap: int = 46800,
    min_ratio: float = 0.89,
    max_ratio: float = 1.05,
) -> CycleDetectionResult:
    """Detect directed transaction cycles in FalkorDB within specified length bounds.

    Args:
        min_length: Minimum cycle length (number of hops/edges), bounded between 3 and 5.
        max_length: Maximum cycle length (number of hops/edges), bounded between 3 and 5.
        limit: Maximum number of cycle candidates to return, bounded between 1 and 200.
        graph_name: FalkorDB graph name to search (defaults to 'txn').
        db: Optional existing FalkorDBClient instance.
        min_gap: Minimum inter-hop time gap in seconds (default: 60s).
        max_gap: Maximum inter-hop time gap in seconds (default: 13h = 46800s).
        min_ratio: Minimum hop amount retention ratio (default: 0.89).
        max_ratio: Maximum hop amount retention ratio (default: 1.05).

    Returns:
        CycleDetectionResult (list subclass) containing structured candidate dictionaries
        and truncation attributes (.truncated, .truncation_reason, .count).

    Raises:
        ValueError: If parameters are invalid or out of safe bounds.
    """
    # 1. Parameter Validation
    if min_length < 3 or min_length > 5:
        raise ValueError(f"min_length must be between 3 and 5 (got {min_length}).")
    if max_length < 3 or max_length > 5:
        raise ValueError(f"max_length must be between 3 and 5 (got {max_length}).")
    if min_length > max_length:
        raise ValueError(f"min_length ({min_length}) cannot exceed max_length ({max_length}).")
    if limit < 1 or limit > 200:
        raise ValueError(f"limit must be between 1 and 200 (got {limit}).")

    client = db or FalkorDBClient()
    rows: List[Any] = []
    offset = 0
    while len(rows) <= EDGE_SCAN_LIMIT:
        page_limit = min(EDGE_PAGE_SIZE, EDGE_SCAN_LIMIT + 1 - len(rows))
        res = client.execute_query(
            graph_name,
            GET_CYCLE_EDGES,
            {"offset": offset, "limit": page_limit},
            caller="detector:cycle:read_edges",
        )
        page = res.result_set if res and res.result_set else []
        rows.extend(page)
        offset += len(page)
        if len(page) < page_limit:
            break
    scan_truncated = len(rows) > EDGE_SCAN_LIMIT
    rows = rows[:EDGE_SCAN_LIMIT]

    outgoing: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in rows:
        amount = float(row[3] or 0)
        if amount <= 0:
            continue
        outgoing[str(row[0])].append({
            "src": str(row[0]),
            "dst": str(row[1]),
            "tx_id": str(row[2]),
            "amount": round(amount, 2),
            "ts": int(row[4]),
            "step": int(row[5] or 0),
            "tx_type": str(row[6] or ""),
        })

    candidates: List[Dict[str, Any]] = []
    seen_canonical_ids = set()
    search_steps = 0
    work_limited = False
    found_limit_plus_one = False

    # DFS over each possible origin. Timestamps and amount ratios prune a branch
    # before it can expand, while the smallest-account rule removes rotations.
    def visit(start: str, current: str, path: List[Dict[str, Any]], visited: set[str]) -> None:
        nonlocal search_steps, work_limited, found_limit_plus_one
        if work_limited or found_limit_plus_one:
            return
        if len(path) >= max_length:
            return
        previous = path[-1] if path else None
        for edge in outgoing.get(current, []):
            search_steps += 1
            if search_steps > SEARCH_STEP_LIMIT:
                work_limited = True
                return
            if previous is not None:
                gap = edge["ts"] - previous["ts"]
                ratio = edge["amount"] / previous["amount"]
                if gap < min_gap or gap > max_gap or ratio < min_ratio or ratio > max_ratio:
                    continue
            next_path = path + [edge]
            next_length = len(next_path)
            if edge["dst"] == start:
                if next_length >= min_length:
                    cycle_edges, accounts, cycle_id = canonicalize_cycle_edges(next_path)
                    if cycle_id not in seen_canonical_ids:
                        seen_canonical_ids.add(cycle_id)
                        chron_edges = sorted(cycle_edges, key=lambda item: (item["ts"], item["tx_id"]))
                        amounts = [item["amount"] for item in cycle_edges]
                        minimum, maximum = min(amounts), max(amounts)
                        conservation = round(minimum / maximum, 4) if maximum else 1.0
                        retention = round(chron_edges[-1]["amount"] / chron_edges[0]["amount"], 4)
                        duration = max(0, chron_edges[-1]["ts"] - chron_edges[0]["ts"])
                        suspicious = duration <= 86400 and conservation >= 0.8 and retention <= 1.05
                        flow = round(sum(amounts), 2)
                        review_note = (
                            "Meets the detector's fast, high-retention review criteria."
                            if suspicious else
                            "A cycle candidate only; it does not meet all fast, high-retention review criteria."
                        )
                        explanation = (
                            f"Directed {next_length}-hop cycle across accounts "
                            f"{' -> '.join(accounts)} -> {accounts[0]}, with {len(cycle_edges)} real transactions. "
                            f"It took {duration:,} seconds and retained {retention:.1%} from first to last hop. "
                            f"{review_note}"
                        )
                        candidates.append({
                            "cycle_id": cycle_id,
                            "pattern_type": "cycle",
                            "candidate_type": "cycle_candidate",
                            "cycle_length": next_length,
                            "canonical_edge_sequence": [item["tx_id"] for item in cycle_edges],
                            "accounts": accounts,
                            "transactions": cycle_edges,
                            "total_flow": flow,
                            "total_amount": flow,
                            "time_span": duration,
                            "duration_seconds": duration,
                            "retention": retention,
                            "min_amount": minimum,
                            "max_amount": maximum,
                            "amount_conservation_ratio": conservation,
                            "first_transaction_ts": chron_edges[0]["ts"],
                            "last_transaction_ts": chron_edges[-1]["ts"],
                            "is_time_ordered": True,
                            "suspicious": suspicious,
                            "explanation": explanation,
                        })
                        if len(candidates) > limit:
                            found_limit_plus_one = True
                continue
            if next_length < max_length and edge["dst"] not in visited and start < edge["dst"]:
                visit(start, edge["dst"], next_path, visited | {edge["dst"]})
            if work_limited or found_limit_plus_one:
                return

    for origin in sorted(outgoing):
        visit(origin, origin, [], {origin})
        if work_limited or found_limit_plus_one:
            break

    truncated = scan_truncated or work_limited or found_limit_plus_one
    if found_limit_plus_one:
        candidates = candidates[:limit]
    reason = "edge_scan_limit" if scan_truncated else "search_budget" if work_limited else "result_limit" if found_limit_plus_one else None
    result = CycleDetectionResult(candidates, truncated=truncated, truncation_reason=reason)
    result.edges_scanned = len(rows)
    result.search_steps = min(search_steps, SEARCH_STEP_LIMIT)
    return result
