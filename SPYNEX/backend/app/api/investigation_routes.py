"""FastAPI router for RingTrace Investigation & Memory endpoints (Member B).

Base router paths (without prefix, prefix `/api/v1` is mounted in main.py):
  - POST /cases/{case_id}/investigations -> Starts an agent investigation (202 Accepted)
  - GET  /investigations/{investigation_id}/events -> SSE stream (event: step, done, error, heartbeat)
  - GET  /investigations/{investigation_id} -> Current or final investigation object
  - GET  /cases/{case_id}/investigations -> List of investigations for a case
  - POST /cases/{case_id}/decisions -> Records human analyst decision into memory
  - GET  /cases/{case_id}/decisions -> Retrieves decision history for a case
  - GET  /cases/{case_id}/similar -> Retrieves historical similar cases and prior decisions
  - POST /actions/{action_id}/approve -> Approves a proposed action (creates Decision)
  - POST /actions/{action_id}/reject -> Rejects a proposed action
"""
import asyncio
import json
import logging
import os
import time
import uuid
from typing import Any, AsyncGenerator, Dict, List, Literal, Optional
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

try:
    from app.agent.loop import run_investigation
    from app.agent.chat import ChatCaseNotFound, run_case_chat
    from app.agent.evidence import EvidenceStore
    from app.agent.validator import validate_evidence_ids
    from app.db import FalkorDBClient
    from app.memory.sar import DISCLAIMER, build_sar
    from app.mcp_server.tools import find_similar_cases, get_case
    from app.memory.graph import MEMORY_GRAPH, TXN_GRAPH
    from app.memory.decisions import DecisionNotFound, InvalidVerdict, Verdict, normalize, record_decision
    from app.queries_memory import (
        CREATE_SAR_CYPHER,
        GET_CASE_BY_ID,
        GET_CASE_DECISIONS,
        GET_CASE_NOTES,
        GET_CASE_PAYLOAD,
        GET_LATEST_CASE_SAR,
        GET_INVESTIGATION_BY_ID,
        GET_INVESTIGATIONS_BY_CASE,
        GET_PROPOSED_ACTION_BY_ID,
        SAVE_INVESTIGATION_CYPHER,
        UPDATE_PROPOSED_ACTION_STATUS,
    )
except ImportError:
    from backend.app.agent.loop import run_investigation
    from backend.app.agent.chat import ChatCaseNotFound, run_case_chat
    from backend.app.agent.evidence import EvidenceStore
    from backend.app.agent.validator import validate_evidence_ids
    from backend.app.db import FalkorDBClient
    from backend.app.memory.sar import DISCLAIMER, build_sar
    from backend.app.mcp_server.tools import find_similar_cases, get_case
    from backend.app.memory.graph import MEMORY_GRAPH, TXN_GRAPH
    from backend.app.memory.decisions import DecisionNotFound, InvalidVerdict, Verdict, normalize, record_decision
    from backend.app.queries_memory import (
        CREATE_SAR_CYPHER,
        GET_CASE_BY_ID,
        GET_CASE_DECISIONS,
        GET_CASE_NOTES,
        GET_CASE_PAYLOAD,
        GET_LATEST_CASE_SAR,
        GET_INVESTIGATION_BY_ID,
        GET_INVESTIGATIONS_BY_CASE,
        GET_PROPOSED_ACTION_BY_ID,
        SAVE_INVESTIGATION_CYPHER,
        UPDATE_PROPOSED_ACTION_STATUS,
    )

router = APIRouter(tags=["Investigation & Memory (Member B)"])
db_client = FalkorDBClient()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic Request & Response Models (API Contract v1.0)
# ---------------------------------------------------------------------------

class StartInvestigationResponse(BaseModel):
    investigation_id: str
    status: str = "running"


class DecisionCreateRequest(BaseModel):
    decision: str = Field(..., description="APPROVE_SAR, DISMISS, MONITOR, or a supported legacy value")
    note: str = Field(default="", description="Analyst rationale or compliance note")
    actor: str = Field(default="analyst_1", description="Analyst username or ID")


class DecisionResponse(BaseModel):
    decision_id: str
    case_id: str
    decision: str
    note: str
    actor: str
    ts: str


class ChatHistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=4000)


class CaseChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=1000)
    history: List[ChatHistoryItem] = Field(default_factory=list)


class SarResponse(BaseModel):
    sar_id: str
    case_id: str
    summary: str
    narrative: str
    evidence: Dict[str, List[str]]
    created_at: str


def _legacy_decision_label(value: str) -> str:
    """Keep the existing API/UI decision labels while storage is canonical."""
    try:
        normalized = normalize(value)
    except InvalidVerdict:
        return str(value or "")
    return {
        "APPROVE_SAR": "escalate",
        "DISMISS": "dismiss",
        "MONITOR": "monitor",
    }[normalized.value]


# ---------------------------------------------------------------------------
# In-Memory Active Investigation & Event Stream Manager
# ---------------------------------------------------------------------------

class ActiveInvestigation:
    def __init__(self, investigation_id: str, case_id: str):
        self.investigation_id = investigation_id
        self.case_id = case_id
        self.status = "running"
        self.mode = "llm"
        self.steps: List[Dict[str, Any]] = []
        self.assessment: Optional[Dict[str, Any]] = None
        self.proposed_action: Optional[Dict[str, Any]] = None
        self.error: Optional[str] = None
        self.created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        self.listeners: List[asyncio.Queue] = []

    def add_step(self, step_data: Dict[str, Any]):
        self.steps.append(step_data)
        for q in list(self.listeners):
            q.put_nowait({"event": "step", "data": step_data})

    def complete(self, result: Dict[str, Any]):
        self.status = result.get("status", "done")
        self.mode = result.get("mode", "fallback")
        self.assessment = result.get("assessment")
        self.proposed_action = result.get("proposed_action")
        self.error = result.get("error")

        done_payload = {
            "investigation_id": self.investigation_id,
            "mode": self.mode,
            "assessment": self.assessment,
            "proposed_action": self.proposed_action,
        }
        for q in list(self.listeners):
            q.put_nowait({"event": "done", "data": done_payload})

    def fail(self, code: str, message: str):
        self.status = "error"
        self.error = message
        err_payload = {"code": code, "message": message}
        for q in list(self.listeners):
            q.put_nowait({"event": "error", "data": err_payload})


_ACTIVE_INVESTIGATIONS: Dict[str, ActiveInvestigation] = {}


def clear_active_investigations():
    """Wipes active in-memory investigations on demo reset."""
    _ACTIVE_INVESTIGATIONS.clear()


def _execute_investigation_task(inv_id: str, case_id: str):
    """Background execution worker for the agent investigation."""
    active = _ACTIVE_INVESTIGATIONS.get(inv_id)
    if not active:
        return

    def on_step(step_info: Dict[str, Any]):
        active.add_step(step_info)

    try:
        res = run_investigation(
            case_id=case_id,
            investigation_id=inv_id,
            step_callback=on_step,
            db=db_client,
            memory_graph=MEMORY_GRAPH,
            txn_graph=TXN_GRAPH,
        )
        active.complete(res)

        # Persist completed investigation node into memory graph
        now_ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        db_client.execute_query(
            MEMORY_GRAPH,
            SAVE_INVESTIGATION_CYPHER,
            {
                "case_id": case_id,
                "investigation_id": inv_id,
                "mode": active.mode,
                "status": active.status,
                "assessment": json.dumps(active.assessment) if active.assessment else "",
                "ts": now_ts,
            },
            caller="api:save_investigation",
        )
    except Exception as e:
        active.fail("investigation_exception", str(e))


# ---------------------------------------------------------------------------
# Endpoints: Investigation & SSE Feed
# ---------------------------------------------------------------------------

@router.post(
    "/cases/{case_id}/investigations",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=StartInvestigationResponse,
    summary="Start an autonomous agent investigation for a case",
)
def start_case_investigation(
    case_id: str,
    background_tasks: BackgroundTasks,
):
    """Triggers the agent loop for the specified case. Returns 202 with investigation_id."""
    # Verify that case exists in memory
    c_res = db_client.execute_query(
        MEMORY_GRAPH,
        GET_CASE_BY_ID,
        {"case_id": case_id.strip()},
        caller="api:start_inv:check",
    )
    if not c_res or not c_res.result_set:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "not_found", "message": f"Case '{case_id}' not found", "details": {}}},
        )

    inv_id = f"INV_{uuid.uuid4().hex[:8]}"
    active = ActiveInvestigation(investigation_id=inv_id, case_id=case_id)
    _ACTIVE_INVESTIGATIONS[inv_id] = active

    background_tasks.add_task(_execute_investigation_task, inv_id, case_id)
    return StartInvestigationResponse(investigation_id=inv_id, status="running")


@router.get(
    "/investigations/{investigation_id}/events",
    summary="Real-time Server-Sent Events (SSE) stream for an active investigation",
)
async def stream_investigation_events(investigation_id: str):
    """Streams live step events, completion payload, or errors via SSE."""
    active = _ACTIVE_INVESTIGATIONS.get(investigation_id)

    async def event_generator() -> AsyncGenerator[str, None]:
        if not active:
            # Check if this was a historically completed investigation in memory
            inv_res = db_client.execute_query(
                MEMORY_GRAPH,
                GET_INVESTIGATION_BY_ID,
                {"investigation_id": investigation_id.strip()},
                caller="api:sse:check_history",
            )
            if not inv_res or not inv_res.result_set:
                yield f"event: error\ndata: {json.dumps({'code': 'not_found', 'message': f'Investigation {investigation_id} not found'})}\n\n"
                return

            row = inv_res.result_set[0]
            raw_assessment = row[4]
            assessment = json.loads(raw_assessment) if raw_assessment else {}
            done_data = {
                "investigation_id": row[0],
                "mode": row[2],
                "assessment": assessment,
                "proposed_action": None,
            }
            yield f"event: done\ndata: {json.dumps(done_data)}\n\n"
            return

        # Register event queue
        q: asyncio.Queue = asyncio.Queue()
        active.listeners.append(q)

        try:
            # Replay any steps already generated prior to listener connection
            for past_step in active.steps:
                yield f"event: step\ndata: {json.dumps(past_step)}\n\n"

            # If already done prior to connection, emit done immediately
            if active.status in ("done", "error"):
                if active.status == "done":
                    done_payload = {
                        "investigation_id": active.investigation_id,
                        "mode": active.mode,
                        "assessment": active.assessment,
                        "proposed_action": active.proposed_action,
                    }
                    yield f"event: done\ndata: {json.dumps(done_payload)}\n\n"
                else:
                    yield f"event: error\ndata: {json.dumps({'code': 'investigation_error', 'message': active.error})}\n\n"
                return

            # Live event loop with 15s heartbeat
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15.0)
                    evt_type = msg.get("event")
                    evt_data = msg.get("data")
                    yield f"event: {evt_type}\ndata: {json.dumps(evt_data)}\n\n"

                    if evt_type in ("done", "error"):
                        break
                except asyncio.TimeoutError:
                    # Emit periodic heartbeat to prevent proxy timeout
                    heartbeat_data = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
                    yield f"event: heartbeat\ndata: {json.dumps(heartbeat_data)}\n\n"
        finally:
            if q in active.listeners:
                active.listeners.remove(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get(
    "/investigations/{investigation_id}",
    summary="Get current or final status of an investigation",
)
def get_investigation_details(investigation_id: str):
    """Retrieve full investigation result, assessment, and steps."""
    active = _ACTIVE_INVESTIGATIONS.get(investigation_id)
    if active:
        return {
            "investigation_id": active.investigation_id,
            "case_id": active.case_id,
            "status": active.status,
            "mode": active.mode,
            "steps": active.steps,
            "assessment": active.assessment,
            "proposed_action": active.proposed_action,
            "error": active.error,
        }

    # Query memory graph if not in active in-memory cache
    inv_res = db_client.execute_query(
        MEMORY_GRAPH,
        GET_INVESTIGATION_BY_ID,
        {"investigation_id": investigation_id.strip()},
        caller="api:get_inv",
    )
    if not inv_res or not inv_res.result_set:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "not_found", "message": f"Investigation '{investigation_id}' not found", "details": {}}},
        )

    row = inv_res.result_set[0]
    raw_assessment = row[4]
    assessment = json.loads(raw_assessment) if raw_assessment else {}

    return {
        "investigation_id": row[0],
        "case_id": row[1],
        "status": row[3],
        "mode": row[2],
        "steps": [],
        "assessment": assessment,
        "proposed_action": None,
        "created_at": row[5],
    }


@router.get(
    "/cases/{case_id}/investigations",
    summary="List all investigations for a given case",
)
def list_case_investigations(case_id: str):
    """Retrieve all historical investigations performed on this case."""
    res = db_client.execute_query(
        MEMORY_GRAPH,
        GET_INVESTIGATIONS_BY_CASE,
        {"case_id": case_id.strip()},
        caller="api:case_invs",
    )
    items = []
    for row in (res.result_set if res else []):
        raw_assessment = row[4]
        items.append({
            "investigation_id": row[0],
            "case_id": row[1],
            "mode": row[2],
            "status": row[3],
            "assessment": json.loads(raw_assessment) if raw_assessment else {},
            "created_at": row[5],
        })

    # Include any currently active investigation from memory
    for active in _ACTIVE_INVESTIGATIONS.values():
        if active.case_id == case_id and not any(i["investigation_id"] == active.investigation_id for i in items):
            items.insert(0, {
                "investigation_id": active.investigation_id,
                "case_id": active.case_id,
                "mode": active.mode,
                "status": active.status,
                "assessment": active.assessment,
                "created_at": active.created_at,
            })

    return {"items": items, "total": len(items)}


# ---------------------------------------------------------------------------
# Endpoints: Human Analyst Decisions & Similar Cases
# ---------------------------------------------------------------------------

@router.post(
    "/cases/{case_id}/decisions",
    status_code=status.HTTP_201_CREATED,
    response_model=DecisionResponse,
    summary="Record human analyst decision for a case",
)
def record_case_decision(case_id: str, req: DecisionCreateRequest):
    """Records a canonical verdict and maps it to the case-list status."""
    try:
        decision = record_decision(case_id, req.decision, req.note, req.actor, db_client, MEMORY_GRAPH)
    except InvalidVerdict as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": {"code": "invalid_decision", "message": str(exc), "details": {}}},
        ) from exc
    except DecisionNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "not_found", "message": f"Case '{case_id}' not found", "details": {}}},
        ) from exc
    return DecisionResponse(**{**decision, "decision": _legacy_decision_label(decision["decision"])})


@router.get(
    "/cases/{case_id}/decisions",
    summary="Get decision history for a case",
)
def get_case_decisions(case_id: str):
    """Retrieves all human and action decisions logged for this case."""
    res = db_client.execute_query(
        MEMORY_GRAPH,
        GET_CASE_DECISIONS,
        {"case_id": case_id.strip()},
        caller="api:get_decisions",
    )
    items = [
        {"decision_id": r[0], "decision": _legacy_decision_label(r[1]), "note": r[2], "actor": r[3], "ts": r[4]}
        for r in (res.result_set if res else [])
    ]
    return {"items": items, "total": len(items)}


@router.get(
    "/cases/{case_id}/similar",
    summary="Find similar historical cases and prior outcomes",
)
def get_similar_cases_endpoint(
    case_id: str,
    limit: int = Query(default=5, ge=1, le=20),
):
    """Matches historical cases on shared accounts or matching structural signatures."""
    sim_result = find_similar_cases(case_id=case_id, limit=limit, db=db_client, memory_graph=MEMORY_GRAPH)
    if sim_result.get("status") == "error":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "not_found", "message": sim_result.get("error", "Case not found"), "details": {}}},
        )

    contract_items = []
    for item in sim_result.get("items", []):
        contract_items.append({
            "case_id": item["case_id"],
            "match": item["match_type"],
            "shared_account_ids": item["shared_account_ids"],
            "outcome": item.get("outcome") or item.get("status"),
            "decided_at": item.get("decided_at"),
            "score": item.get("score"),
            "patterns": item.get("patterns", []),
        })

    return {
        "items": contract_items,
        "next_cursor": None,
    }


@router.post(
    "/cases/{case_id}/chat",
    summary="Ask a read-only, evidence-checked question about a case",
)
def chat_about_case(case_id: str, req: CaseChatRequest):
    if not req.message.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": {"code": "invalid_message", "message": "Message must not be blank", "details": {}}},
        )
    try:
        return run_case_chat(
            case_id=case_id.strip(),
            message=req.message,
            history=[item.model_dump() for item in req.history[-10:]],
            db=db_client,
            memory_graph=MEMORY_GRAPH,
            txn_graph=TXN_GRAPH,
        )
    except ChatCaseNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "not_found", "message": "Case not found", "details": {}}},
        ) from exc
    except Exception as exc:
        logger.exception("Case chat failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": {"code": "chat_failed", "message": "The case answer could not be verified", "details": {}}},
        ) from exc


def _sar_response(case_id: str, row: Any, case_record: Dict[str, Any]) -> Dict[str, Any]:
    evidence = case_record.get("evidence", {}) if isinstance(case_record, dict) else {}
    return {
        "sar_id": row[0],
        "case_id": case_id,
        "summary": row[1],
        "narrative": row[2],
        "evidence": {
            "account_ids": list(evidence.get("account_ids", [])),
            "tx_ids": list(evidence.get("tx_ids", [])),
        },
        "created_at": row[5],
    }


@router.get(
    "/cases/{case_id}/sar",
    response_model=SarResponse,
    summary="Get the latest stored SAR draft for a case",
)
def get_case_sar(case_id: str):
    case_id = case_id.strip()
    case_exists = db_client.execute_query(MEMORY_GRAPH, GET_CASE_BY_ID, {"case_id": case_id}, caller="api:get_sar:case")
    if not case_exists or not case_exists.result_set:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found", "message": "Case not found", "details": {}}})
    sar_result = db_client.execute_query(MEMORY_GRAPH, GET_LATEST_CASE_SAR, {"case_id": case_id}, caller="api:get_sar:latest")
    if not sar_result or not sar_result.result_set:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found", "message": "No SAR draft exists for this case", "details": {}}})
    case_record = get_case(case_id, db=db_client, memory_graph=MEMORY_GRAPH)
    return _sar_response(case_id, sar_result.result_set[0], case_record)


@router.post(
    "/cases/{case_id}/sar/generate",
    response_model=SarResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a deterministic SAR draft after analyst approval",
)
def generate_case_sar(case_id: str, regenerate: bool = Query(default=False)):
    case_id = case_id.strip()
    case_result = db_client.execute_query(MEMORY_GRAPH, GET_CASE_BY_ID, {"case_id": case_id}, caller="api:generate_sar:case")
    if not case_result or not case_result.result_set:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found", "message": "Case not found", "details": {}}})

    decisions_result = db_client.execute_query(MEMORY_GRAPH, GET_CASE_DECISIONS, {"case_id": case_id}, caller="api:generate_sar:decision")
    decisions = decisions_result.result_set if decisions_result else []
    if not decisions:
        raise HTTPException(status_code=409, detail={"error": {"code": "approval_required", "message": "Approve the case before generating a SAR", "details": {}}})
    latest_decision = decisions[0]
    try:
        verdict = normalize(latest_decision[1])
    except InvalidVerdict:
        verdict = None
    if verdict != Verdict.APPROVE_SAR:
        raise HTTPException(status_code=409, detail={"error": {"code": "approval_required", "message": "Approve the case before generating a SAR", "details": {}}})

    if not regenerate:
        existing = db_client.execute_query(MEMORY_GRAPH, GET_LATEST_CASE_SAR, {"case_id": case_id}, caller="api:generate_sar:idempotency")
        if existing and existing.result_set:
            return _sar_response(case_id, existing.result_set[0], get_case(case_id, db=db_client, memory_graph=MEMORY_GRAPH))

    case_record = get_case(case_id, db=db_client, memory_graph=MEMORY_GRAPH)
    if case_record.get("status") != "success":
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found", "message": "Case details are unavailable", "details": {}}})

    payload_result = db_client.execute_query(MEMORY_GRAPH, GET_CASE_PAYLOAD, {"case_id": case_id}, caller="api:generate_sar:payload")
    payload = {}
    if payload_result and payload_result.result_set:
        raw_payload = payload_result.result_set[0][0]
        if isinstance(raw_payload, str):
            try:
                payload = json.loads(raw_payload)
            except (TypeError, ValueError):
                payload = {}
        elif isinstance(raw_payload, dict):
            payload = raw_payload

    inv_result = db_client.execute_query(MEMORY_GRAPH, GET_INVESTIGATIONS_BY_CASE, {"case_id": case_id}, caller="api:generate_sar:investigations")
    latest_investigation = {}
    if inv_result and inv_result.result_set:
        inv_row = inv_result.result_set[0]
        try:
            latest_investigation = json.loads(inv_row[4]) if isinstance(inv_row[4], str) else (inv_row[4] or {})
        except (TypeError, ValueError):
            latest_investigation = {}

    note_result = db_client.execute_query(MEMORY_GRAPH, GET_CASE_NOTES, {"case_id": case_id, "limit": 50}, caller="api:generate_sar:notes")
    chat_notes = [
        {"note_id": row[0], "question": row[1], "answer": row[2], "evidence_ids": row[3] or [], "ts": row[4]}
        for row in (note_result.result_set if note_result else [])
    ]
    precedent_result = find_similar_cases(case_id, limit=10, db=db_client, memory_graph=MEMORY_GRAPH)
    precedents = precedent_result.get("items", []) if precedent_result.get("status") == "success" else []

    sar_id = f"SAR_{uuid.uuid4().hex[:8]}"
    generated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    investigation_findings = latest_investigation.get("findings", []) if isinstance(latest_investigation, dict) else []

    current_evidence = EvidenceStore()
    current_evidence.add(case_record)
    current_evidence.add(payload)
    current_evidence.add({"findings": investigation_findings})
    current_evidence.case_ids.add(case_id)
    all_evidence = EvidenceStore()
    all_evidence.add(case_record)
    all_evidence.add(payload)
    all_evidence.add({"decision": latest_decision[1], "actor": latest_decision[3], "note": latest_decision[2], "ts": latest_decision[4]})
    all_evidence.add(latest_investigation)
    all_evidence.add(chat_notes)
    all_evidence.add(precedents)
    all_evidence.add({"sar_id": sar_id, "case_id": case_id})
    all_evidence.case_ids.add(case_id)

    tx_ids = sorted(current_evidence.tx_ids)
    account_ids = sorted(current_evidence.account_ids)
    ts_first, ts_last = payload.get("first_ts"), payload.get("last_ts")
    time_range = f"{ts_first or 'unknown'} to {ts_last or 'unknown'}" if ts_first or ts_last else None
    sar = build_sar({
        "sar_id": sar_id,
        "case_id": case_id,
        "generated_at": generated_at,
        "account_ids": account_ids,
        "tx_ids": tx_ids,
        "total_amount": payload.get("total_amount"),
        "tx_count": payload.get("tx_count", len(tx_ids)),
        "score": payload.get("score", case_record.get("score")),
        "score_breakdown": payload.get("score_breakdown", case_record.get("score_breakdown", {})),
        "time_range": time_range,
        "patterns": case_record.get("patterns", []),
        "hits": case_record.get("hits", []),
        "findings": investigation_findings,
        "chat_notes": chat_notes,
        "precedents": precedents,
        "decision": {"decision": latest_decision[1], "note": latest_decision[2], "actor": latest_decision[3], "ts": latest_decision[4]},
    })
    all_evidence.add(sar)
    validation = validate_evidence_ids(sar["summary"] + "\n" + sar["narrative"], all_evidence)
    if not validation.is_valid or DISCLAIMER not in sar["narrative"]:
        logger.error(
            "SAR template validation failed for %s: ids=%s amounts=%s jargon=%s",
            case_id, validation.hallucinated_ids, validation.hallucinated_amounts, validation.jargon_terms,
        )
        raise HTTPException(status_code=500, detail={"error": {"code": "sar_validation_failed", "message": "SAR draft data did not pass evidence validation", "details": {}}})

    persisted = db_client.execute_query(
        MEMORY_GRAPH,
        CREATE_SAR_CYPHER,
        {"case_id": case_id, "sar_id": sar_id, "summary": sar["summary"], "narrative": sar["narrative"], "actor": latest_decision[3] or "analyst_1", "ts": generated_at},
        caller="api:generate_sar:create",
    )
    if not persisted or not persisted.result_set:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found", "message": "Case not found", "details": {}}})
    return {
        "sar_id": sar_id,
        "case_id": case_id,
        "summary": sar["summary"],
        "narrative": sar["narrative"],
        "evidence": {"account_ids": account_ids, "tx_ids": tx_ids},
        "created_at": generated_at,
    }


# ---------------------------------------------------------------------------
# Endpoints: Human In The Loop Action Approval / Rejection
# ---------------------------------------------------------------------------

@router.post(
    "/actions/{action_id}/approve",
    summary="Approve a proposed action (creates Decision in memory)",
)
def approve_proposed_action(action_id: str):
    """Approves an action, records a Decision node, and updates Case.status."""
    act_res = db_client.execute_query(
        MEMORY_GRAPH,
        GET_PROPOSED_ACTION_BY_ID,
        {"action_id": action_id.strip()},
        caller="api:approve_action:get",
    )
    if not act_res or not act_res.result_set:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "not_found", "message": f"Action '{action_id}' not found", "details": {}}},
        )

    row = act_res.result_set[0]
    aid, act_type, reason, act_status, created_at, case_id = row

    if act_status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": {"code": "invalid_state", "message": f"Action is already '{act_status}'", "details": {}}},
        )

    # Map the proposed action to the one canonical human-decision path.
    if act_type == "draft_sar":
        decision_val = "APPROVE_SAR"
    elif act_type == "escalate":
        decision_val = "APPROVE_SAR"
    elif act_type == "monitor":
        decision_val = "MONITOR"
    else:  # dismiss
        decision_val = "DISMISS"

    now_ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    decision = record_decision(
        case_id=case_id,
        verdict=decision_val,
        note=f"Approved proposed action: {reason}",
        actor="human_supervisor",
        db=db_client,
        memory_graph=MEMORY_GRAPH,
    )

    # Mark action approved
    db_client.execute_query(
        MEMORY_GRAPH,
        UPDATE_PROPOSED_ACTION_STATUS,
        {"action_id": action_id, "status": "approved", "ts": now_ts},
        caller="api:approve_action:update",
    )

    return {
        "action": {
            "action_id": aid,
            "type": act_type,
            "reason": reason,
            "status": "approved",
            "resolved_at": now_ts,
        },
        # Keep the legacy action response label while storing the canonical
        # APPROVE_SAR/DISMISS/MONITOR value for the new decision history.
        "decision": {**decision, "decision": {"APPROVE_SAR": "escalate", "DISMISS": "dismiss", "MONITOR": "monitor"}[decision_val]},
    }


@router.post(
    "/actions/{action_id}/reject",
    summary="Reject a proposed action",
)
def reject_proposed_action(action_id: str):
    """Marks a proposed action as rejected without modifying case status."""
    act_res = db_client.execute_query(
        MEMORY_GRAPH,
        GET_PROPOSED_ACTION_BY_ID,
        {"action_id": action_id.strip()},
        caller="api:reject_action:get",
    )
    if not act_res or not act_res.result_set:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "not_found", "message": f"Action '{action_id}' not found", "details": {}}},
        )

    row = act_res.result_set[0]
    aid, act_type, reason, act_status, created_at, case_id = row

    if act_status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": {"code": "invalid_state", "message": f"Action is already '{act_status}'", "details": {}}},
        )

    now_ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    db_client.execute_query(
        MEMORY_GRAPH,
        UPDATE_PROPOSED_ACTION_STATUS,
        {"action_id": action_id, "status": "rejected", "ts": now_ts},
        caller="api:reject_action:update",
    )

    return {
        "action": {
            "action_id": aid,
            "type": act_type,
            "reason": reason,
            "status": "rejected",
            "resolved_at": now_ts,
        },
        "action_id": aid,
        "type": act_type,
        "reason": reason,
        "status": "rejected",
        "resolved_at": now_ts,
    }
