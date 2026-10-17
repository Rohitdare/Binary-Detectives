"""Detect hubs with substantial incoming and outgoing activity in one window."""
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

try:
    from app.db import FalkorDBClient
    from app.detectors.graph_pattern_utils import PatternDetectionResult, make_hit, resolve_pattern_edges
except ImportError:
    from backend.app.db import FalkorDBClient
    from backend.app.detectors.graph_pattern_utils import PatternDetectionResult, make_hit, resolve_pattern_edges


def _activity_batches(
    transactions: List[Dict[str, Any]], counterparty_key: str,
    minimum_counterparties: int, maximum_gap_seconds: int, maximum_span_seconds: int,
) -> List[List[Dict[str, Any]]]:
    """Split direction-specific activity at long quiet gaps and filter by breadth."""
    ordered = sorted(transactions, key=lambda tx: (tx["ts"], tx["tx_id"]))
    batches: List[List[Dict[str, Any]]] = []
    batch: List[Dict[str, Any]] = []
    for tx in ordered:
        if batch and (
            tx["ts"] - batch[-1]["ts"] > maximum_gap_seconds
            or tx["ts"] - batch[0]["ts"] > maximum_span_seconds
        ):
            if len({item[counterparty_key] for item in batch}) >= minimum_counterparties:
                batches.append(batch)
            batch = []
        batch.append(tx)
    if batch and len({item[counterparty_key] for item in batch}) >= minimum_counterparties:
        batches.append(batch)
    return batches


def detect_gather_scatter(
    min_incoming_counterparties: int = 3,
    min_outgoing_counterparties: int = 3,
    window_seconds: int = 72 * 3600,
    maximum_activity_gap_seconds: int = 12 * 3600,
    suspicious_counterparties: int = 5,
    suspicious_max_span_seconds: int = 72 * 3600,
    limit: int = 50,
    max_edges: int = 250_000,
    max_search_steps: int = 250_000,
    graph_name: str = "txn",
    db: Optional[FalkorDBClient] = None,
    edge_snapshot: Optional[Tuple[List[Dict[str, Any]], bool, int]] = None,
) -> PatternDetectionResult:
    """Find a hub that gathers from distinct accounts, then scatters to others.

    Incoming and outgoing value are measured independently. The detector does
    not infer that any particular outgoing transaction spends a particular
    incoming transfer.
    """
    if min_incoming_counterparties < 2 or min_outgoing_counterparties < 2:
        raise ValueError("incoming and outgoing counterparty minimums must be >= 2")
    if window_seconds < 1 or maximum_activity_gap_seconds < 1 or suspicious_max_span_seconds < 1 or suspicious_counterparties < 2:
        raise ValueError("time bounds and suspicious counterparty minimum must be positive")
    if not 1 <= limit <= 200 or not 1 <= max_edges <= 1_000_000 or not 1 <= max_search_steps <= 5_000_000:
        raise ValueError("limit, max_edges or max_search_steps are outside safe bounds")

    client = db or FalkorDBClient()
    edges, read_truncated, invalid_rows = resolve_pattern_edges(client, graph_name, max_edges, edge_snapshot)
    incoming_by_hub: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    outgoing_by_hub: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for edge in edges:
        if edge["src"] == edge["dst"]:
            continue
        incoming_by_hub[edge["dst"]].append(edge)
        outgoing_by_hub[edge["src"]].append(edge)

    hits_by_id = {}
    search_steps = 0
    search_limited = False
    for hub in sorted(set(incoming_by_hub) & set(outgoing_by_hub)):
        in_bursts = _activity_batches(
            incoming_by_hub[hub], "src", min_incoming_counterparties,
            maximum_activity_gap_seconds, window_seconds,
        )
        out_bursts = _activity_batches(
            outgoing_by_hub[hub], "dst", min_outgoing_counterparties,
            maximum_activity_gap_seconds, window_seconds,
        )
        for incoming in in_bursts:
            in_start = min(tx["ts"] for tx in incoming)
            in_end = max(tx["ts"] for tx in incoming)
            for outgoing in out_bursts:
                search_steps += 1
                if search_steps > max_search_steps:
                    search_limited = True
                    break
                out_start = min(tx["ts"] for tx in outgoing)
                out_end = max(tx["ts"] for tx in outgoing)
                span = out_end - in_start
                if out_start <= in_end or span < 0 or span > window_seconds:
                    continue
                senders = sorted({tx["src"] for tx in incoming})
                receivers = sorted({tx["dst"] for tx in outgoing})
                transactions = sorted(incoming + outgoing, key=lambda edge: (edge["ts"], edge["tx_id"]))
                incoming_total = round(sum(tx["amount"] for tx in incoming), 2)
                outgoing_total = round(sum(tx["amount"] for tx in outgoing), 2)
                ratio = round(min(incoming_total, outgoing_total) / max(incoming_total, outgoing_total), 4) if max(incoming_total, outgoing_total) else 0.0
                strong_activity = min(len(senders), len(receivers)) >= suspicious_counterparties
                suspicious = strong_activity and span <= suspicious_max_span_seconds
                roles = {hub: "hub"}
                for sender in senders:
                    roles[sender] = "sender"
                for receiver in receivers:
                    roles[receiver] = "receiver" if receiver not in roles else "sender_and_receiver"
                measurements = {
                    "hub_id": hub,
                    "distinct_incoming_counterparties": len(senders),
                    "distinct_outgoing_counterparties": len(receivers),
                    "incoming_tx_count": len(incoming),
                    "outgoing_tx_count": len(outgoing),
                    "incoming_amount": incoming_total,
                    "outgoing_amount": outgoing_total,
                    "observation_span_seconds": span,
                    "configured_observation_window_seconds": window_seconds,
                    "maximum_inter_transaction_gap_seconds": maximum_activity_gap_seconds,
                    "suspicious_min_counterparties_per_direction": suspicious_counterparties,
                    "suspicious_max_span_seconds": suspicious_max_span_seconds,
                    "in_out_total_amount_balance_ratio": ratio,
                    "balance_ratio_is_not_fund_attribution": True,
                    "structural_match": True,
                    "suspicious": suspicious,
                    "suspicion_rationale": (
                        "A distinct-counterparty gather episode was followed by a scatter episode in the configured window; candidate for review."
                        if suspicious else "Gather followed by scatter structure found; no funds are assumed to be individually traced."
                    ),
                }
                hit = make_hit(
                    "gather_scatter", transactions,
                    [hub] + sorted(set(senders + receivers)), roles, measurements,
                    f"Hub {hub} received {len(incoming)} transfers from {len(senders)} accounts, then sent {len(outgoing)} transfers to {len(receivers)} accounts over {span:,} seconds. Totals are reported separately; the graph does not establish that these funds are linked.",
                )
                hits_by_id[hit["hit_id"]] = hit
            if search_limited:
                break
        if search_limited:
            break

    hits = sorted(hits_by_id.values(), key=lambda hit: (
        not hit["measurements"]["suspicious"],
        -min(hit["measurements"]["distinct_incoming_counterparties"], hit["measurements"]["distinct_outgoing_counterparties"]),
        hit["measurements"]["observation_span_seconds"], hit["hit_id"],
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
        invalid_rows_skipped=invalid_rows, edges_scanned=len(edges),
        search_steps=min(search_steps, max_search_steps),
    )
