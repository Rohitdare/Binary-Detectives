"""Detect source-to-sink value splitting over distinct two-hop routes."""
from collections import defaultdict
from bisect import bisect_right
from typing import Any, Dict, List, Optional, Tuple

try:
    from app.db import FalkorDBClient
    from app.detectors.graph_pattern_utils import PatternDetectionResult, make_hit, resolve_pattern_edges
except ImportError:
    from backend.app.db import FalkorDBClient
    from backend.app.detectors.graph_pattern_utils import PatternDetectionResult, make_hit, resolve_pattern_edges


def detect_scatter_gather(
    min_intermediaries: int = 3,
    max_path_gap_seconds: int = 24 * 3600,
    observation_seconds: int = 72 * 3600,
    minimum_path_retention: float = 0.50,
    suspicious_path_retention: float = 0.80,
    maximum_path_amount_ratio: float = 1.25,
    maximum_suspicious_path_ratio: float = 1.05,
    limit: int = 50,
    max_edges: int = 250_000,
    max_search_steps: int = 500_000,
    graph_name: str = "txn",
    db: Optional[FalkorDBClient] = None,
    edge_snapshot: Optional[Tuple[List[Dict[str, Any]], bool, int]] = None,
) -> PatternDetectionResult:
    """Find a common source and sink joined by several distinct intermediaries.

    For each intermediary, one deterministic qualifying in/out transaction pair
    is retained. The downstream edge must be later than the upstream edge and
    within the configured delay. Amount retention is reported per path; it does
    not imply that fungible funds were individually traced.
    """
    if min_intermediaries < 2 or max_path_gap_seconds < 1 or observation_seconds < 1:
        raise ValueError("min_intermediaries, path gap and observation window must be positive")
    if not 0 < minimum_path_retention <= 1 or not 0 < suspicious_path_retention <= 1:
        raise ValueError("retention thresholds must be in (0, 1]")
    if maximum_path_amount_ratio < 1 or not suspicious_path_retention <= maximum_suspicious_path_ratio <= maximum_path_amount_ratio:
        raise ValueError("suspicious path ratio bounds must fit within the structural amount-ratio bound")
    if not 1 <= limit <= 200 or not 1 <= max_edges <= 1_000_000 or not 1 <= max_search_steps <= 5_000_000:
        raise ValueError("limit, max_edges or max_search_steps are outside safe bounds")

    client = db or FalkorDBClient()
    edges, read_truncated, invalid_rows = resolve_pattern_edges(client, graph_name, max_edges, edge_snapshot)
    outgoing: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for edge in edges:
        outgoing[edge["src"]].append(edge)
    outgoing_times = {account: [edge["ts"] for edge in rows] for account, rows in outgoing.items()}

    # (source, sink) -> all individually qualifying intermediary paths.
    groups: Dict[Tuple[str, str], List[Tuple[str, Dict[str, Any], Dict[str, Any]]]] = defaultdict(list)
    search_steps = 0
    search_limited = False
    for first in edges:
        intermediary = first["dst"]
        if intermediary in (first["src"],):
            continue
        candidates = outgoing.get(intermediary, [])
        first_index = bisect_right(outgoing_times.get(intermediary, []), first["ts"])
        for second in candidates[first_index:]:
            search_steps += 1
            if search_steps > max_search_steps:
                search_limited = True
                break
            sink = second["dst"]
            if sink in (first["src"], intermediary):
                continue
            gap = second["ts"] - first["ts"]
            if gap > max_path_gap_seconds:
                break
            retention = second["amount"] / first["amount"] if first["amount"] else 0.0
            if retention < minimum_path_retention or retention > maximum_path_amount_ratio:
                continue
            key = (first["src"], sink)
            groups[key].append((intermediary, first, second))
        if search_limited:
            break

    hits = []
    for (source, sink), source_sink_paths in sorted(groups.items()):
        episodes: List[Dict[str, Any]] = []
        ordered_paths = sorted(source_sink_paths, key=lambda path: (
            path[1]["ts"], path[2]["ts"], path[0], path[1]["tx_id"], path[2]["tx_id"],
        ))
        for intermediary, incoming_edge, outgoing_edge in ordered_paths:
            placed = False
            for episode in reversed(episodes):
                candidate_start = min(episode["start_ts"], incoming_edge["ts"])
                candidate_end = max(episode["end_ts"], outgoing_edge["ts"])
                if candidate_end - candidate_start > observation_seconds:
                    continue
                prior = episode["paths"].get(intermediary)
                candidate_rank = (
                    outgoing_edge["ts"] - incoming_edge["ts"],
                    -(outgoing_edge["amount"] / incoming_edge["amount"]),
                    incoming_edge["tx_id"], outgoing_edge["tx_id"],
                )
                if prior is None:
                    episode["paths"][intermediary] = (incoming_edge, outgoing_edge)
                else:
                    old_in, old_out = prior
                    old_rank = (
                        old_out["ts"] - old_in["ts"],
                        -(old_out["amount"] / old_in["amount"]),
                        old_in["tx_id"], old_out["tx_id"],
                    )
                    if candidate_rank < old_rank:
                        episode["paths"][intermediary] = (incoming_edge, outgoing_edge)
                selected_in, selected_out = episode["paths"][intermediary]
                episode["start_ts"] = min(path[0]["ts"] for path in episode["paths"].values())
                episode["end_ts"] = max(path[1]["ts"] for path in episode["paths"].values())
                placed = True
                break
            if not placed:
                episodes.append({
                    "start_ts": incoming_edge["ts"],
                    "end_ts": outgoing_edge["ts"],
                    "paths": {intermediary: (incoming_edge, outgoing_edge)},
                })

        for episode in episodes:
            paths_by_intermediary = episode["paths"]
            if len(paths_by_intermediary) < min_intermediaries:
                continue
            intermediaries = sorted(paths_by_intermediary)
            selected_paths = [paths_by_intermediary[item] for item in intermediaries]
            path_edges = [edge for pair in selected_paths for edge in pair]
            ratios = [round(outgoing_edge["amount"] / incoming_edge["amount"], 4)
                      for incoming_edge, outgoing_edge in selected_paths]
            duration = max(edge["ts"] for edge in path_edges) - min(edge["ts"] for edge in path_edges)
            path_gaps = [outgoing_edge["ts"] - incoming_edge["ts"]
                         for incoming_edge, outgoing_edge in selected_paths]
            suspicious = all(suspicious_path_retention <= ratio <= maximum_suspicious_path_ratio for ratio in ratios)
            measurements = {
                "source": source,
                "sink": sink,
                "intermediary_count": len(intermediaries),
                "intermediary_ids": intermediaries,
                "path_count": len(intermediaries),
                "duration_seconds": duration,
                "observation_window_seconds": observation_seconds,
                "path_retention_ratios": ratios,
                "path_gaps_seconds": path_gaps,
                "maximum_path_gap_seconds": max(path_gaps),
                "minimum_path_retention": min(ratios),
                "suspicious_path_ratio_max": maximum_suspicious_path_ratio,
                "structural_match": True,
                "suspicious": suspicious,
                "suspicion_rationale": (
                    f"Each intermediary path is time ordered, within the configured gap, and retains {suspicious_path_retention:.0%}–{maximum_suspicious_path_ratio:.0%} of its preceding amount; candidate for review."
                    if suspicious else "Shared source/sink structure found; per-path retention does not meet review criteria."
                ),
            }
            hits.append(make_hit(
                "scatter_gather", path_edges, [source] + intermediaries + [sink],
                {source: "source", sink: "sink", **{item: "intermediary" for item in intermediaries}},
                measurements,
                f"{len(intermediaries)} distinct two-hop routes connect source {source} to sink {sink} in {duration:,} seconds. Each route's timing and amount are shown; no funds are assumed to be individually traced.",
            ))

    hits.sort(key=lambda hit: (
        not hit["measurements"]["suspicious"],
        -hit["measurements"]["intermediary_count"],
        hit["measurements"]["duration_seconds"], hit["hit_id"],
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
