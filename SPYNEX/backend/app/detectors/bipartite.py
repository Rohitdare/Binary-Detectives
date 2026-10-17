"""Detect dense many-to-many transfer rectangles in a bounded txn edge sample."""
from collections import defaultdict
from itertools import combinations
from typing import Any, Dict, List, Optional, Tuple

try:
    from app.db import FalkorDBClient
    from app.detectors.graph_pattern_utils import PatternDetectionResult, make_hit, resolve_pattern_edges
except ImportError:
    from backend.app.db import FalkorDBClient
    from backend.app.detectors.graph_pattern_utils import PatternDetectionResult, make_hit, resolve_pattern_edges


def detect_bipartite(
    min_sources: int = 3,
    min_targets: int = 3,
    min_shared_targets: int = 2,
    minimum_density: float = 0.5,
    limit: int = 50,
    max_edges: int = 250_000,
    max_search_steps: int = 500_000,
    graph_name: str = "txn",
    db: Optional[FalkorDBClient] = None,
    edge_snapshot: Optional[Tuple[List[Dict[str, Any]], bool, int]] = None,
) -> PatternDetectionResult:
    """Find source groups that share at least two targets and form a dense rectangle.

    This reports repeated bipartite structure as review evidence; it does not
    infer that the transfers contain illicit funds.
    """
    if min_sources < 2 or min_targets < 2 or min_shared_targets < 1:
        raise ValueError("minimum source, target, and shared-target counts are invalid")
    if not 0 < minimum_density <= 1:
        raise ValueError("minimum_density must be in (0, 1]")
    if not 1 <= limit <= 200 or not 1 <= max_edges <= 1_000_000 or not 1 <= max_search_steps <= 5_000_000:
        raise ValueError("limit or safety bounds are invalid")

    edges, read_truncated, invalid_rows = resolve_pattern_edges(db or FalkorDBClient(), graph_name, max_edges, edge_snapshot)
    source_targets: Dict[str, set[str]] = defaultdict(set)
    source_edges: Dict[str, list[dict]] = defaultdict(list)
    for edge in edges:
        source_targets[edge["src"]].add(edge["dst"])
        source_edges[edge["src"]].append(edge)
    eligible = {src: sorted(targets) for src, targets in source_targets.items()
                if len(targets) >= min_shared_targets}
    target_pair_sources: Dict[tuple[str, str], set[str]] = defaultdict(set)
    steps = 0
    limited = False
    # Enumerate each source's target pairs. This is proportional to source
    # out-degree squared and avoids combinatorial expansion at popular targets.
    for source, targets in eligible.items():
        for target_pair in combinations(targets, 2):
            steps += 1
            if steps > max_search_steps:
                limited = True
                break
            target_pair_sources[target_pair].add(source)
        if limited:
            break

    groups = {tuple(sorted(sources)) for sources in target_pair_sources.values()
              if len(sources) >= min_sources}
    groups = sorted(groups, key=lambda sources: (len(sources), sources))
    candidate_limited = len(groups) > 1000
    groups = groups[:1000]

    hits = []
    for source_group in groups:
        sources = set(source_group)
        if len(sources) > 60:
            candidate_limited = True
            sources = set(sorted(sources, key=lambda src: (-len(eligible[src]), src))[:60])
        target_counts: Dict[str, int] = defaultdict(int)
        for src in sources:
            for dst in eligible[src]:
                target_counts[dst] += 1
        targets = {dst for dst, count in target_counts.items() if count >= 2}
        if len(targets) < min_targets:
            continue
        pair_edges = [edge for src in sources for edge in source_edges[src] if edge["dst"] in targets]
        observed_pairs = {(edge["src"], edge["dst"]) for edge in pair_edges}
        density = len(observed_pairs) / (len(sources) * len(targets))
        if density < minimum_density:
            continue
        nodes = sorted(sources | targets)
        # This detector has no independently calibrated fraud signal in the
        # current data, so a structural rectangle alone must not be called suspicious.
        suspicious = False
        measurements = {
            "source_count": len(sources), "target_count": len(targets),
            "observed_pairs": len(observed_pairs), "possible_pairs": len(sources) * len(targets),
            "density": round(density, 4), "minimum_density": minimum_density,
            "structural_match": True, "suspicious": suspicious, "supporting_signal_only": True,
            "suspicion_rationale": "Structural bipartite evidence only; no calibrated fraud criteria are available for this pattern.",
        }
        hits.append(make_hit(
            "bipartite", sorted(pair_edges, key=lambda edge: (edge["ts"], edge["tx_id"])), nodes,
            {**{node: "source" for node in sources}, **{node: "target" for node in targets}},
            measurements, f"{len(sources)} source accounts shared {len(targets)} targets at {density:.0%} observed pair density.",
        ))
    hits.sort(key=lambda hit: (-hit["measurements"]["density"], -hit["measurements"]["observed_pairs"], hit["hit_id"]))
    reasons = []
    if read_truncated: reasons.append("edge_read_limit")
    if invalid_rows: reasons.append("invalid_transaction_rows")
    if limited: reasons.append("search_budget")
    if candidate_limited: reasons.append("candidate_group_limit")
    if len(hits) > limit: reasons.append("result_limit")
    return PatternDetectionResult(hits[:limit], truncated=bool(reasons), truncation_reasons=reasons,
        invalid_rows_skipped=invalid_rows, edges_scanned=len(edges), search_steps=min(steps, max_search_steps))
