"""Detect compact, unusually dense local transaction neighborhoods."""
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

try:
    from app.db import FalkorDBClient
    from app.detectors.graph_pattern_utils import PatternDetectionResult, make_hit, resolve_pattern_edges
except ImportError:
    from backend.app.db import FalkorDBClient
    from backend.app.detectors.graph_pattern_utils import PatternDetectionResult, make_hit, resolve_pattern_edges


def detect_dense_clusters(
    min_accounts: int = 5,
    max_accounts: int = 60,
    minimum_density: float = 0.10,
    min_internal_transactions: int = 10,
    limit: int = 50,
    max_edges: int = 250_000,
    graph_name: str = "txn",
    db: Optional[FalkorDBClient] = None,
    edge_snapshot: Optional[Tuple[List[Dict[str, Any]], bool, int]] = None,
) -> PatternDetectionResult:
    """Score bounded one-hop ego networks by unique directed-pair density.

    Local neighborhoods avoid returning one giant component for a widely
    connected payment network. Transaction evidence is never collapsed.
    """
    if min_accounts < 3 or max_accounts < min_accounts or max_accounts > 100:
        raise ValueError("account bounds must satisfy 3 <= min_accounts <= max_accounts <= 100")
    if not 0 < minimum_density <= 1 or min_internal_transactions < 1:
        raise ValueError("density and internal transaction thresholds must be positive")
    if not 1 <= limit <= 200:
        raise ValueError("limit must be between 1 and 200")

    edges, read_truncated, invalid_rows = resolve_pattern_edges(db or FalkorDBClient(), graph_name, max_edges, edge_snapshot)
    neighbors: Dict[str, set[str]] = defaultdict(set)
    outgoing: Dict[str, list[dict]] = defaultdict(list)
    degree: Dict[str, int] = defaultdict(int)
    for edge in edges:
        outgoing[edge["src"]].append(edge)
        neighbors[edge["src"]].add(edge["dst"])
        neighbors[edge["dst"]].add(edge["src"])
        degree[edge["src"]] += 1
        degree[edge["dst"]] += 1

    candidates: Dict[tuple[str, ...], dict] = {}
    steps = 0
    step_cap = max_edges * 4
    limited = False
    seen_groups = set()
    for center in sorted(neighbors, key=lambda account: (-degree[account], account)):
        if len(neighbors[center]) < min_accounts - 1:
            continue
        ranked = sorted(neighbors[center], key=lambda account: (-degree[account], account))
        group = [center] + ranked[:max_accounts - 1]
        if len(group) < min_accounts:
            continue
        key = tuple(sorted(group))
        if key in seen_groups:
            continue
        seen_groups.add(key)
        group_set = set(group)
        internal = []
        pairs = set()
        for source in group:
            for edge in outgoing[source]:
                steps += 1
                if steps > step_cap:
                    limited = True
                    break
                if edge["dst"] in group_set and edge["src"] != edge["dst"]:
                    internal.append(edge)
                    pairs.add((edge["src"], edge["dst"]))
            if limited:
                break
        if limited:
            break
        density = len(pairs) / (len(group) * (len(group) - 1))
        if density < minimum_density or len(internal) < min_internal_transactions:
            continue
        current = candidates.get(key)
        if current is None or density > current["density"]:
            candidates[key] = {"edges": internal, "pairs": pairs, "density": density}

    hits = []
    for accounts, data in candidates.items():
        density = data["density"]
        suspicious = density >= max(minimum_density, 0.25)
        hits.append(make_hit(
            "dense_cluster", sorted(data["edges"], key=lambda edge: (edge["ts"], edge["tx_id"])),
            list(accounts), {account: "cluster_member" for account in accounts},
            {"account_count": len(accounts), "internal_transaction_count": len(data["edges"]),
             "unique_directed_pairs": len(data["pairs"]), "density": round(density, 4),
             "minimum_density": minimum_density, "structural_match": True, "suspicious": suspicious,
             "suspicion_rationale": "Compact neighborhood has high internal density." if suspicious else "Dense neighborhood retained as structural evidence."},
            f"A {len(accounts)}-account local neighborhood contains {len(data['pairs'])} directed account pairs ({density:.0%} density).",
        ))
    hits.sort(key=lambda hit: (-hit["measurements"]["density"], -hit["measurements"]["internal_transaction_count"], hit["hit_id"]))
    reasons = []
    if read_truncated: reasons.append("edge_read_limit")
    if invalid_rows: reasons.append("invalid_transaction_rows")
    if limited: reasons.append("search_budget")
    if len(hits) > limit: reasons.append("result_limit")
    return PatternDetectionResult(hits[:limit], truncated=bool(reasons), truncation_reasons=reasons,
        invalid_rows_skipped=invalid_rows, edges_scanned=len(edges), search_steps=min(steps, step_cap))
