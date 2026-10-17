"""Shared evidence and result helpers for bounded graph-pattern detectors."""
import hashlib
from typing import Any, Dict, Iterable, List, Optional, Tuple

try:
    from app.detectors.windowing import normalize_transaction_rows
    from app.queries import GET_PATTERN_TRANSACTION_EDGES
except ImportError:
    from backend.app.detectors.windowing import normalize_transaction_rows
    from backend.app.queries import GET_PATTERN_TRANSACTION_EDGES


class PatternDetectionResult(list):
    """List of hit candidates with explicit graph-read/search completeness."""

    def __init__(
        self,
        hits: List[Dict[str, Any]],
        *,
        truncated: bool = False,
        truncation_reasons: Optional[List[str]] = None,
        invalid_rows_skipped: int = 0,
        edges_scanned: int = 0,
        search_steps: int = 0,
    ):
        super().__init__(hits)
        self.truncated = truncated
        self.truncation_reasons = list(dict.fromkeys(truncation_reasons or []))
        self.truncation_reason = self.truncation_reasons[0] if self.truncation_reasons else None
        self.invalid_rows_skipped = invalid_rows_skipped
        self.edges_scanned = edges_scanned
        self.search_steps = search_steps


def read_pattern_edges(db: Any, graph_name: str, max_edges: int) -> Tuple[List[Dict[str, Any]], bool, int]:
    """Page through recent edges, disclosing incomplete reads at the safety cap.

    FalkorDB responses can be capped at 10,000 records independently of the
    requested query limit. Stable ordering and offsets let the detector process
    the complete graph rather than mistaking one server page for a full scan.
    """
    page_size = 10_000
    rows: List[Any] = []
    offset = 0
    while len(rows) <= max_edges:
        requested = min(page_size, max_edges + 1 - len(rows))
        response = db.execute_query(
            graph_name,
            GET_PATTERN_TRANSACTION_EDGES,
            {"offset": offset, "limit": requested},
            caller="detector:graph_pattern:read_edges",
        )
        page = response.result_set if response and response.result_set else []
        rows.extend(page)
        offset += len(page)
        if len(page) < requested or len(rows) > max_edges:
            break
    truncated = len(rows) > max_edges
    normalized, invalid_rows = normalize_transaction_rows(rows[:max_edges])
    normalized.sort(key=lambda edge: (edge["ts"], edge["tx_id"]))
    return normalized, truncated, invalid_rows


def resolve_pattern_edges(
    db: Any, graph_name: str, max_edges: int,
    edge_snapshot: Optional[Tuple[List[Dict[str, Any]], bool, int]] = None,
) -> Tuple[List[Dict[str, Any]], bool, int]:
    """Reuse the scan coordinator's immutable edge snapshot when supplied."""
    if edge_snapshot is None:
        return read_pattern_edges(db, graph_name, max_edges)
    edges, truncated, invalid_rows = edge_snapshot
    return edges, bool(truncated), int(invalid_rows)


def stable_hit_id(pattern: str, tx_ids: Iterable[str]) -> str:
    """Build a deterministic identity from the pattern and directed evidence order."""
    evidence = "\0".join(str(tx_id) for tx_id in tx_ids)
    return f"HIT_{pattern}_{hashlib.sha256(evidence.encode('utf-8')).hexdigest()[:12]}"


def make_hit(
    pattern: str,
    transactions: List[Dict[str, Any]],
    account_ids: List[str],
    account_roles: Dict[str, str],
    measurements: Dict[str, Any],
    explanation: str,
) -> Dict[str, Any]:
    """Keep the existing hit dictionary contract and attach graph evidence."""
    tx_ids = [tx["tx_id"] for tx in transactions]
    return {
        "hit_id": stable_hit_id(pattern, tx_ids),
        "pattern": pattern,
        "account_ids": account_ids,
        "account_roles": account_roles,
        "tx_ids": tx_ids,
        "transactions": transactions,
        "measurements": measurements,
        "explanation": explanation,
    }

