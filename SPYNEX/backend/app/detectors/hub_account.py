"""Identify balanced, outlier transaction hubs as supporting case signals."""
import math
from collections import defaultdict
from statistics import mean, pstdev
from typing import Any, Dict, List, Optional, Tuple

try:
    from app.db import FalkorDBClient
    from app.detectors.graph_pattern_utils import PatternDetectionResult, make_hit, resolve_pattern_edges
except ImportError:
    from backend.app.db import FalkorDBClient
    from backend.app.detectors.graph_pattern_utils import PatternDetectionResult, make_hit, resolve_pattern_edges


def detect_hub_accounts(
    minimum_counterparties: int = 10,
    minimum_z_score: float = 3.0,
    minimum_flow_ratio: float = 0.5,
    maximum_flow_ratio: float = 2.0,
    limit: int = 50,
    max_edges: int = 250_000,
    graph_name: str = "txn",
    db: Optional[FalkorDBClient] = None,
    edge_snapshot: Optional[Tuple[List[Dict[str, Any]], bool, int]] = None,
) -> PatternDetectionResult:
    """Flag high-degree accounts whose total inflow/outflow remains balanced.

    The signal is deliberately never marked suspicious by itself. It only adds
    context when a case already has another detector hit.
    """
    if minimum_counterparties < 2 or minimum_z_score <= 0:
        raise ValueError("hub thresholds must be positive")
    if not 0 < minimum_flow_ratio <= maximum_flow_ratio:
        raise ValueError("flow ratio bounds are invalid")
    if not 1 <= limit <= 200:
        raise ValueError("limit must be between 1 and 200")
    edges, read_truncated, invalid_rows = resolve_pattern_edges(db or FalkorDBClient(), graph_name, max_edges, edge_snapshot)
    outgoing: Dict[str, set[str]] = defaultdict(set)
    incoming: Dict[str, set[str]] = defaultdict(set)
    sent = defaultdict(float)
    received = defaultdict(float)
    evidence = defaultdict(list)
    accounts = set()
    for edge in edges:
        source, target = edge["src"], edge["dst"]
        accounts.update((source, target))
        outgoing[source].add(target)
        incoming[target].add(source)
        sent[source] += edge["amount"]
        received[target] += edge["amount"]
        evidence[source].append(edge)
        evidence[target].append(edge)
    degrees = {account: len(outgoing[account] | incoming[account]) for account in accounts}
    logs = [math.log1p(degree) for degree in degrees.values()]
    center = mean(logs) if logs else 0.0
    spread = pstdev(logs) if len(logs) > 1 else 0.0
    hits = []
    for account in sorted(accounts):
        flow_ratio = received[account] / sent[account] if sent[account] else 0.0
        degree = degrees[account]
        z_score = (math.log1p(degree) - center) / spread if spread else 0.0
        if degree < minimum_counterparties or z_score < minimum_z_score:
            continue
        if not minimum_flow_ratio <= flow_ratio <= maximum_flow_ratio:
            continue
        counterparties = sorted(outgoing[account] | incoming[account])
        bounded_counterparties = counterparties[:59]
        bounded_set = set(bounded_counterparties)
        txs = sorted((edge for edge in evidence[account]
                      if (edge["dst"] if edge["src"] == account else edge["src"]) in bounded_set),
                     key=lambda edge: (edge["ts"], edge["tx_id"]))
        hits.append(make_hit(
            "hub_account", txs, [account], {account: "hub"},
            {"distinct_counterparties": degree, "in_degree": len(incoming[account]),
             "out_degree": len(outgoing[account]), "log_degree_z_score": round(z_score, 4),
             "inflow_outflow_ratio": round(flow_ratio, 4), "supporting_signal_only": True,
             "counterparty_ids": bounded_counterparties,
             "counterparty_evidence_truncated": len(counterparties) > len(bounded_counterparties),
             "structural_match": True, "suspicious": False},
            f"Account {account} interacted with {degree} distinct counterparties and has balanced observed inflow and outflow. This is a supporting signal only.",
        ))
    hits.sort(key=lambda hit: (-hit["measurements"]["log_degree_z_score"], hit["hit_id"]))
    reasons = (["edge_read_limit"] if read_truncated else [])
    if invalid_rows: reasons.append("invalid_transaction_rows")
    if len(hits) > limit: reasons.append("result_limit")
    return PatternDetectionResult(hits[:limit], truncated=bool(reasons), truncation_reasons=reasons,
        invalid_rows_skipped=invalid_rows, edges_scanned=len(edges))
