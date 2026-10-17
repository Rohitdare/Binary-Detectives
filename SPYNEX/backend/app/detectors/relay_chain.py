"""Bounded detector for rapid, amount-consistent directed relay chains."""
from collections import defaultdict
from bisect import bisect_right
from typing import Any, Dict, List, Optional, Tuple

try:
    from app.db import FalkorDBClient
    from app.detectors.graph_pattern_utils import PatternDetectionResult, make_hit, resolve_pattern_edges
except ImportError:
    from backend.app.db import FalkorDBClient
    from backend.app.detectors.graph_pattern_utils import PatternDetectionResult, make_hit, resolve_pattern_edges


DEFAULT_MAX_EDGES = 250_000
DEFAULT_MAX_SEARCH_STEPS = 1_000_000


def detect_relay_chains(
    min_hops: int = 3,
    max_hops: int = 6,
    max_gap_seconds: int = 6 * 3600,
    observation_seconds: int = 24 * 3600,
    minimum_hop_retention: float = 0.70,
    suspicious_hop_retention: float = 0.80,
    maximum_hop_amount_ratio: float = 1.25,
    maximum_suspicious_hop_ratio: float = 1.05,
    limit: int = 50,
    max_edges: int = DEFAULT_MAX_EDGES,
    max_search_steps: int = DEFAULT_MAX_SEARCH_STEPS,
    graph_name: str = "txn",
    db: Optional[FalkorDBClient] = None,
    edge_snapshot: Optional[Tuple[List[Dict[str, Any]], bool, int]] = None,
) -> PatternDetectionResult:
    """Find simple directed paths with rapid, reasonably consistent transfers.

    A path is a structural relay candidate when each subsequent transfer follows
    within ``max_gap_seconds`` and retains at least ``minimum_hop_retention`` of
    its preceding amount. ``suspicious`` is a review signal only: it additionally
    requires a short total duration and stronger per-hop retention.
    """
    if min_hops < 3 or max_hops < min_hops or max_hops > 6:
        raise ValueError("hop bounds must satisfy 3 <= min_hops <= max_hops <= 6")
    if max_gap_seconds < 1 or observation_seconds < 1:
        raise ValueError("time bounds must be positive")
    if not 0 < minimum_hop_retention <= 1 or not 0 < suspicious_hop_retention <= 1:
        raise ValueError("retention thresholds must be in (0, 1]")
    if maximum_hop_amount_ratio < 1 or not suspicious_hop_retention <= maximum_suspicious_hop_ratio <= maximum_hop_amount_ratio:
        raise ValueError("suspicious hop ratio bounds must fit within the structural amount-ratio bound")
    if limit < 1 or limit > 200 or not 1 <= max_edges <= 1_000_000 or not 1 <= max_search_steps <= 5_000_000:
        raise ValueError("limit, max_edges or max_search_steps are outside safe bounds")

    client = db or FalkorDBClient()
    edges, read_truncated, invalid_rows = resolve_pattern_edges(client, graph_name, max_edges, edge_snapshot)
    outgoing: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for edge in edges:
        outgoing[edge["src"]].append(edge)
    outgoing_times = {account: [edge["ts"] for edge in rows] for account, rows in outgoing.items()}

    hits_by_id: Dict[str, Dict[str, Any]] = {}
    search_steps = 0
    search_limited = False

    def visit(start: str, current: str, path: List[Dict[str, Any]], seen: set[str]) -> None:
        nonlocal search_steps, search_limited
        if search_limited or len(path) >= max_hops:
            return
        current_edges = outgoing.get(current, [])
        first_index = bisect_right(outgoing_times.get(current, []), path[-1]["ts"]) if path else 0
        for edge in current_edges[first_index:]:
            search_steps += 1
            if search_steps > max_search_steps:
                search_limited = True
                return
            if edge["dst"] in seen:
                continue
            if path:
                previous = path[-1]
                gap = edge["ts"] - previous["ts"]
                retention = edge["amount"] / previous["amount"] if previous["amount"] else 0.0
                if gap > max_gap_seconds:
                    break
                if gap <= 0 or retention < minimum_hop_retention or retention > maximum_hop_amount_ratio:
                    continue
            next_path = path + [edge]
            if len(next_path) >= min_hops:
                ratios = [
                    round(next_path[index]["amount"] / next_path[index - 1]["amount"], 4)
                    for index in range(1, len(next_path))
                ]
                duration = next_path[-1]["ts"] - next_path[0]["ts"]
                suspicious = duration <= observation_seconds and all(
                        suspicious_hop_retention <= ratio <= maximum_suspicious_hop_ratio for ratio in ratios
                )
                accounts = [next_path[0]["src"]] + [tx["dst"] for tx in next_path]
                hit = make_hit(
                    "relay_chain",
                    next_path,
                    accounts,
                    {account: "origin" if index == 0 else "relay" if index < len(accounts) - 1 else "sink"
                     for index, account in enumerate(accounts)},
                    {
                        "hop_count": len(next_path),
                        "duration_seconds": duration,
                        "hop_gaps_seconds": [next_path[i]["ts"] - next_path[i - 1]["ts"] for i in range(1, len(next_path))],
                        "hop_retention_ratios": ratios,
                        "suspicious_hop_ratio_max": maximum_suspicious_hop_ratio,
                        "overall_retention_ratio": round(next_path[-1]["amount"] / next_path[0]["amount"], 4),
                        "amount_lost_per_hop": [round(next_path[i - 1]["amount"] - next_path[i]["amount"], 2) for i in range(1, len(next_path))],
                        "structural_match": True,
                        "suspicious": suspicious,
                        "suspicion_rationale": (
                            f"Rapid path with {suspicious_hop_retention:.0%}–{maximum_suspicious_hop_ratio:.0%} of the preceding amount at every hop; candidate for review."
                            if suspicious else "Relay structure found, but speed or per-hop retention did not meet review criteria."
                        ),
                    },
                    f"Funds moved through {len(next_path)} directed transfers across {len(accounts)} accounts in {duration:,} seconds; this is a relay candidate, not a fraud finding.",
                )
                hits_by_id[hit["hit_id"]] = hit
            if len(next_path) < max_hops:
                visit(start, edge["dst"], next_path, seen | {edge["dst"]})
            if search_limited:
                return

    for start in sorted(outgoing, key=lambda account: (len(outgoing[account]), account)):
        visit(start, start, [], {start})
        if search_limited:
            break

    hits = sorted(hits_by_id.values(), key=lambda hit: (
        not hit["measurements"]["suspicious"],
        hit["measurements"]["duration_seconds"],
        -hit["measurements"]["overall_retention_ratio"],
        hit["hit_id"],
    ))
    result_limited = len(hits) > limit
    reasons = []
    if read_truncated:
        reasons.append("edge_read_limit")
    if invalid_rows:
        reasons.append("invalid_transaction_rows")
    if search_limited:
        reasons.append("search_budget")
    if result_limited:
        reasons.append("result_limit")
    return PatternDetectionResult(
        hits[:limit], truncated=bool(reasons), truncation_reasons=reasons,
        invalid_rows_skipped=invalid_rows, edges_scanned=len(edges), search_steps=min(search_steps, max_search_steps),
    )
