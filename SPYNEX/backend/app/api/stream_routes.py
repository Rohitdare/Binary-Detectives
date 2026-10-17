"""FastAPI routes for Stream Replay and Demo Reset (Member B).

Base router paths (without prefix, prefix `/api/v1` is mounted in main.py):
  - POST /stream/start  -> Starts replay stream (returns stream status)
  - POST /stream/pause  -> Pauses replay stream
  - POST /stream/resume -> Resumes replay stream
  - POST /stream/stop   -> Stops replay stream
  - GET  /stream/status -> Current replay status ({state, sent, total, batch_size})
  - GET  /stream/events -> Server-Sent Events (SSE) feed
  - POST /demo/reset    -> Complete demo reset (clears memory graph, wipes demo_ accounts, resets stream, reseeds)
"""
import hmac
import os
from typing import Any, Dict, Optional
from fastapi import APIRouter, Header, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

try:
    from app.api.investigation_routes import clear_active_investigations
    from app.db import FalkorDBClient
    from app.memory.graph import MEMORY_GRAPH, TXN_GRAPH, wipe_memory_graph
    from app.memory.seed import seed_memory
    from app.stream.worker import replay_worker
except ImportError:
    from backend.app.api.investigation_routes import clear_active_investigations
    from backend.app.db import FalkorDBClient
    from backend.app.memory.graph import MEMORY_GRAPH, TXN_GRAPH, wipe_memory_graph
    from backend.app.memory.seed import seed_memory
    from backend.app.stream.worker import replay_worker

router = APIRouter(tags=["Stream Replay & Demo Reset (Member B)"])
db_client = FalkorDBClient()


class StreamStartRequest(BaseModel):
    batch_size: int = Field(default=50, ge=1, le=500, description="Transactions per burst")
    interval_seconds: float = Field(default=1.0, ge=0.1, le=10.0, description="Delay between bursts")


class DemoResetResponse(BaseModel):
    status: str = "success"
    removed_demo_accounts: int
    removed_demo_edges: int
    memory_cleared: bool
    replay_reset: bool
    reseeded: bool
    cases_seeded: int


# ---------------------------------------------------------------------------
# Stream Replay Endpoints
# ---------------------------------------------------------------------------

@router.post("/stream/start", summary="Start or restart transaction stream replay")
async def start_stream_replay(req: Optional[StreamStartRequest] = None):
    """Starts asynchronous playback of withheld transactions into the txn graph."""
    batch_size = req.batch_size if req else 50
    interval = req.interval_seconds if req else 1.0
    return replay_worker.start(batch_size=batch_size, interval_seconds=interval)


@router.post("/stream/pause", summary="Pause transaction stream replay")
async def pause_stream_replay():
    """Pauses playback without losing the current transaction index."""
    return replay_worker.pause()


@router.post("/stream/resume", summary="Resume transaction stream replay")
async def resume_stream_replay():
    """Resumes playback from the paused transaction index."""
    return replay_worker.resume()


@router.post("/stream/stop", summary="Stop transaction stream replay")
async def stop_stream_replay():
    """Stops the playback loop."""
    return replay_worker.stop()


@router.get("/stream/status", summary="Get transaction stream replay status")
async def get_stream_status():
    """Returns current state ('idle', 'running', 'paused', 'stopped'), sent count, and total count."""
    return replay_worker.get_status()


@router.get("/stream/events", summary="Real-time Server-Sent Events (SSE) feed for transaction stream")
async def stream_transaction_events():
    """Streams live transaction burst events, stream status, and detection notifications."""
    return StreamingResponse(
        replay_worker.event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Demo Reset Endpoint
# ---------------------------------------------------------------------------

@router.post(
    "/demo/reset",
    response_model=DemoResetResponse,
    summary="One-click demo reset: clears memory graph, deletes demo injected transactions, resets replay, and re-seeds clean state",
)
async def reset_demo_environment(x_demo_key: Optional[str] = Header(default=None)):
    """Wipes memory graph (decisions, investigations, findings), cleans demo_ accounts from txn,

    resets the replay position, and re-seeds the pristine demo cases snapshot.
    """
    configured_demo_key = os.getenv("RINGTRACE_DEMO_KEY") or os.getenv("DEMO_KEY")
    is_deployed = bool(
        os.getenv("RAILWAY_ENVIRONMENT_NAME")
        or os.getenv("RAILWAY_SERVICE_NAME")
        or os.getenv("APP_ENV", "").lower() == "production"
    )
    if not configured_demo_key and is_deployed:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": {"code": "demo_key_not_configured", "message": "Demo reset is disabled until RINGTRACE_DEMO_KEY is configured", "details": {}}},
        )
    if configured_demo_key and (not x_demo_key or not hmac.compare_digest(configured_demo_key, x_demo_key)):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": {"code": "unauthorized", "message": "Invalid or missing X-Demo-Key header", "details": {}}},
        )

    # 1. Reset stream replay worker position
    replay_worker.reset()

    # 2. Clear active in-memory agent investigations
    clear_active_investigations()

    # 3. Clean any demo-injected accounts and transactions from the txn graph
    # First count demo accounts
    demo_acc_count = 0
    demo_edge_count = 0
    try:
        cnt_res = db_client.execute_query(
            TXN_GRAPH,
            "MATCH (a:Account) WHERE a.id STARTS WITH 'demo_' RETURN count(a)",
            caller="api:demo_reset:count_accounts",
        )
        if cnt_res and cnt_res.result_set:
            demo_acc_count = cnt_res.result_set[0][0]

        # Delete demo edges
        edge_del = db_client.execute_query(
            TXN_GRAPH,
            "MATCH ()-[t:SENT]->() WHERE t.tx_id STARTS WITH 'demo_' DELETE t",
            caller="api:demo_reset:delete_edges",
        )
        if edge_del and hasattr(edge_del, "relationships_deleted"):
            demo_edge_count = edge_del.relationships_deleted

        # Delete demo accounts with any remaining attached edges
        db_client.execute_query(
            TXN_GRAPH,
            "MATCH (a:Account) WHERE a.id STARTS WITH 'demo_' DETACH DELETE a",
            caller="api:demo_reset:delete_accounts",
        )
    except Exception:
        pass

    # 4. Wipe the memory graph
    try:
        wipe_memory_graph(db=db_client, graph=MEMORY_GRAPH)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": {"code": "wipe_failed", "message": f"Failed to wipe memory graph: {e}", "details": {}}},
        )

    # 5. Re-seed clean memory graph with CASE_0001, CASE_0002, CASE_0003
    try:
        seeded_cases = seed_memory(memory_graph=MEMORY_GRAPH, txn_graph=TXN_GRAPH, reset=True)
        seeded_count = len(seeded_cases)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": {"code": "reseed_failed", "message": f"Failed to re-seed memory graph: {e}", "details": {}}},
        )

    return DemoResetResponse(
        status="success",
        removed_demo_accounts=demo_acc_count,
        removed_demo_edges=demo_edge_count,
        memory_cleared=True,
        replay_reset=True,
        reseeded=True,
        cases_seeded=seeded_count,
    )

