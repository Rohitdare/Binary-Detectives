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
import os
import time
import uuid
from typing import Any, AsyncGenerator, Dict, List, Optional
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

try:
    from app.agent.loop import run_investigation
    from app.db import FalkorDBClient
    from app.mcp_server.tools import find_similar_cases, get_case
    from app.memory.graph import MEMORY_GRAPH, TXN_GRAPH
    from app.queries_memory import (
        GET_CASE_BY_ID,
        GET_CASE_DECISIONS,
        GET_INVESTIGATION_BY_ID,
        GET_INVESTIGATIONS_BY_CASE,
        GET_PROPOSED_ACTION_BY_ID,
        RECORD_DECISION_CYPHER,
        SAVE_INVESTIGATION_CYPHER,
        UPDATE_PROPOSED_ACTION_STATUS,
    )
except ImportError:
    from backend.app.agent.loop import run_investigation
    from backend.app.db import FalkorDBClient
    from backend.app.mcp_server.tools import find_similar_cases, get_case
    from backend.app.memory.graph import MEMORY_GRAPH, TXN_GRAPH
    from backend.app.queries_memory import (
        GET_CASE_BY_ID,
        GET_CASE_DECISIONS,
        GET_INVESTIGATION_BY_ID,
        GET_INVESTIGATIONS_BY_CASE,
        GET_PROPOSED_ACTION_BY_ID,
        RECORD_DECISION_CYPHER,
        SAVE_INVESTIGATION_CYPHER,
        UPDATE_PROPOSED_ACTION_STATUS,
    )

router = APIRouter(tags=["Investigation & Memory (Member B)"])
db_client = FalkorDBClient()


# ---------------------------------------------------------------------------
# Pydantic Request & Response Models (API Contract v1.0)
# ---------------------------------------------------------------------------

class StartInvestigationResponse(BaseModel):
    investigation_id: str
    status: str = "running"


class DecisionCreateRequest(BaseModel):
    decision: str = Field(..., description="'escalate', 'monitor', or 'dismiss'")
    note: str = Field(default="", description="Analyst rationale or compliance note")
    actor: str = Field(default="analyst_1", description="Analyst username or ID")


class DecisionResponse(BaseModel):
    decision_id: str
    case_id: str
    decision: str
    note: str
    actor: str
    ts: str


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
    """Records an escalate, monitor, or dismiss decision and updates Case.status in memory."""
    dec_clean = req.decision.strip().lower()
    if dec_clean not in ("escalate", "monitor", "dismiss"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": {"code": "bad_request", "message": "Decision must be 'escalate', 'monitor', or 'dismiss'", "details": {}}},
        )

    # Status mapping per Section 5.4:
    # escalate -> escalated, monitor -> monitoring, dismiss -> dismissed
    status_map = {
        "escalate": "escalated",
        "monitor": "monitoring",
        "dismiss": "dismissed",
    }
    case_status = status_map[dec_clean]

    # Verify case exists
    c_res = db_client.execute_query(
        MEMORY_GRAPH,
        GET_CASE_BY_ID,
        {"case_id": case_id.strip()},
        caller="api:record_decision:check_case",
    )
    if not c_res or not c_res.result_set:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "not_found", "message": f"Case '{case_id}' not found", "details": {}}},
        )

    dec_id = f"DEC_{uuid.uuid4().hex[:8]}"
    now_ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    db_client.execute_query(
        MEMORY_GRAPH,
        RECORD_DECISION_CYPHER,
        {
            "case_id": case_id.strip(),
            "decision_id": dec_id,
            "decision": dec_clean,
            "note": req.note.strip(),
            "actor": req.actor.strip(),
            "ts": now_ts,
            "case_status": case_status,
        },
        caller="api:record_decision",
    )

    return DecisionResponse(
        decision_id=dec_id,
        case_id=case_id,
        decision=dec_clean,
        note=req.note.strip(),
        actor=req.actor.strip(),
        ts=now_ts,
    )


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
        {"decision_id": r[0], "decision": r[1], "note": r[2], "actor": r[3], "ts": r[4]}
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

    now_ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # Map action to decision & status (per Section 5.4)
    if act_type == "draft_sar":
        decision_val = "escalate"
        case_status = "sar_drafted"
    elif act_type == "escalate":
        decision_val = "escalate"
        case_status = "escalated"
    elif act_type == "monitor":
        decision_val = "monitor"
        case_status = "monitoring"
    else:  # dismiss
        decision_val = "dismiss"
        case_status = "dismissed"

    dec_id = f"DEC_{uuid.uuid4().hex[:8]}"

    # Record Decision
    db_client.execute_query(
        MEMORY_GRAPH,
        RECORD_DECISION_CYPHER,
        {
            "case_id": case_id,
            "decision_id": dec_id,
            "decision": decision_val,
            "note": f"Approved proposed action: {reason}",
            "actor": "human_supervisor",
            "ts": now_ts,
            "case_status": case_status,
        },
        caller="api:approve_action:decision",
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
        "decision": {
            "decision_id": dec_id,
            "case_id": case_id,
            "decision": decision_val,
            "note": f"Approved proposed action: {reason}",
            "actor": "human_supervisor",
            "ts": now_ts,
        },
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
        "action_id": aid,
        "type": act_type,
        "reason": reason,
        "status": "rejected",
        "resolved_at": now_ts,
    }
