"""Canonical human-verdict normalization and append-only decision writes."""
from enum import Enum
import time
import uuid
from typing import Any, Dict, Optional

try:
    from app.db import FalkorDBClient
    from app.memory.graph import MEMORY_GRAPH
    from app.queries_memory import RECORD_DECISION_CYPHER
except ImportError:
    from backend.app.db import FalkorDBClient
    from backend.app.memory.graph import MEMORY_GRAPH
    from backend.app.queries_memory import RECORD_DECISION_CYPHER


class Verdict(str, Enum):
    APPROVE_SAR = "APPROVE_SAR"
    DISMISS = "DISMISS"
    MONITOR = "MONITOR"


STATUS_FOR = {
    Verdict.APPROVE_SAR: "escalated",
    Verdict.DISMISS: "dismissed",
    Verdict.MONITOR: "monitoring",
}
OUTCOME_FOR = {
    Verdict.APPROVE_SAR: "approved_sar",
    Verdict.DISMISS: "dismissed",
    Verdict.MONITOR: "monitoring",
}
LEGACY = {
    "escalate": Verdict.APPROVE_SAR,
    "dismiss": Verdict.DISMISS,
    "monitor": Verdict.MONITOR,
}


class DecisionNotFound(LookupError):
    """Raised when a decision targets a case that is not in memory."""


class InvalidVerdict(ValueError):
    """Raised when the decision value or audit note is invalid."""


def normalize(value: str) -> Verdict:
    """Accept the new verdict enum and the old lowercase API values."""
    cleaned = str(value or "").strip()
    legacy = LEGACY.get(cleaned.lower())
    if legacy:
        return legacy
    try:
        return Verdict(cleaned.upper())
    except ValueError as exc:
        raise InvalidVerdict("Decision must be APPROVE_SAR, DISMISS, or MONITOR") from exc


def record_decision(
    case_id: str,
    verdict: str,
    note: str = "",
    actor: str = "analyst_1",
    db: Optional[FalkorDBClient] = None,
    memory_graph: str = MEMORY_GRAPH,
) -> Dict[str, str]:
    """Create one immutable Decision node and update the case's list status."""
    case_id = str(case_id or "").strip()
    note = str(note or "").strip()
    actor = str(actor or "").strip() or "analyst_1"
    if not case_id:
        raise InvalidVerdict("case_id is required")
    normalized = normalize(verdict)
    if normalized in (Verdict.APPROVE_SAR, Verdict.DISMISS) and not note:
        raise InvalidVerdict("An audit note is required for this decision")

    # Store a single canonical representation. Legacy input strings remain
    # accepted at the API boundary and are normalized here before persistence.
    stored_value = normalized.value
    decision_id = f"DEC_{uuid.uuid4().hex[:8]}"
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    result = (db or FalkorDBClient()).execute_query(
        memory_graph,
        RECORD_DECISION_CYPHER,
        {
            "case_id": case_id,
            "decision_id": decision_id,
            "decision": stored_value,
            "note": note,
            "actor": actor,
            "ts": ts,
            "case_status": STATUS_FOR[normalized],
        },
        caller="memory:record_decision",
    )
    if not result or not result.result_set:
        raise DecisionNotFound(case_id)
    return {
        "decision_id": decision_id,
        "case_id": case_id,
        "decision": stored_value,
        "note": note,
        "actor": actor,
        "ts": ts,
    }
