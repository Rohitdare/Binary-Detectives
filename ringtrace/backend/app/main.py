"""FastAPI application for RingTrace."""
import os
import sys
import time
from typing import Dict, List, Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

try:
    from app.api.investigation_routes import router as investigation_router
    from app.api.stream_routes import router as stream_router
    from app.db import FalkorDBClient
    from app.detectors import (
        detect_cycles, detect_fan_in, detect_fan_out,
        detect_gather_scatter, detect_relay_chains, detect_scatter_gather,
    )
    from app.queries import (
        COUNT_ACCOUNTS,
        COUNT_SENT,
        GET_ACCOUNT_BY_ID,
        GET_ACCOUNT_TRANSFERS_IN,
        GET_ACCOUNT_TRANSFERS_OUT,
        GET_GRAPH_SAMPLE,
        GET_RECENT_TRANSACTIONS,
        PING_FALKORDB,
        SEARCH_ACCOUNTS,
    )
except ImportError:
    from backend.app.api.investigation_routes import router as investigation_router
    from backend.app.api.stream_routes import router as stream_router
    from backend.app.db import FalkorDBClient
    from backend.app.detectors import (
        detect_cycles, detect_fan_in, detect_fan_out,
        detect_gather_scatter, detect_relay_chains, detect_scatter_gather,
    )
    from backend.app.queries import (
        COUNT_ACCOUNTS,
        COUNT_SENT,
        GET_ACCOUNT_BY_ID,
        GET_ACCOUNT_TRANSFERS_IN,
        GET_ACCOUNT_TRANSFERS_OUT,
        GET_GRAPH_SAMPLE,
        GET_RECENT_TRANSACTIONS,
        PING_FALKORDB,
        SEARCH_ACCOUNTS,
    )

app = FastAPI(
    title="RingTrace API",
    description="Explainable Graph-Based Financial Crime Investigation API powered by FalkorDB",
    version="1.0.0",
)

# Enable CORS for frontend Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Member B Investigation & Memory Router
app.include_router(investigation_router, prefix="/api/v1")
# Mount Member B Stream Replay & Demo Reset Router
app.include_router(stream_router, prefix="/api/v1")

GRAPH_NAME = os.getenv("FALKORDB_GRAPH", "txn")
db_client = FalkorDBClient()
app.state.db_client = db_client
app.state.graph_name = GRAPH_NAME


@app.get("/api/health")
def get_health():
    """Healthcheck endpoint distinguishing app health from FalkorDB connectivity."""
    try:
        # Ping FalkorDB
        res = db_client.execute_query(GRAPH_NAME, PING_FALKORDB, caller="api:health")
        connected = bool(res and len(res.result_set) > 0)
        return {
            "status": "healthy" if connected else "degraded",
            "falkordb_connected": connected,
            "graph": GRAPH_NAME,
            "host": db_client.host,
            "port": db_client.port,
        }
    except Exception as e:
        return {
            "status": "degraded",
            "falkordb_connected": False,
            "graph": GRAPH_NAME,
            "host": db_client.host,
            "port": db_client.port,
            "error": str(e),
        }


@app.get("/api/stats")
def get_stats():
    """Retrieve operational statistics from the txn graph."""
    try:
        acc_res = db_client.execute_query(GRAPH_NAME, COUNT_ACCOUNTS, caller="api:stats_accounts")
        total_accounts = acc_res.result_set[0][0] if acc_res.result_set else 0

        tx_res = db_client.execute_query(GRAPH_NAME, COUNT_SENT, caller="api:stats_transactions")
        total_transactions = tx_res.result_set[0][0] if tx_res.result_set else 0

        return {
            "total_accounts": total_accounts,
            "total_transactions": total_transactions,
            "active_investigations": 0,
            "investigation_status": "No active investigations",
            "suspicious_patterns_detected": "Not yet analyzed",
            "detection_engine_status": "Ready for detection pass",
            "graph_name": GRAPH_NAME,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query stats from FalkorDB: {e}")


@app.get("/api/transactions")
def get_transactions(limit: int = Query(default=50, ge=1, le=500)):
    """Fetch recent transactions from FalkorDB."""
    try:
        res = db_client.execute_query(GRAPH_NAME, GET_RECENT_TRANSACTIONS, {"limit": limit}, caller="api:transactions")
        txs = []
        for row in res.result_set:
            txs.append({
                "tx_id": row[0],
                "src": row[1],
                "dst": row[2],
                "amount": float(row[3]),
                "ts": int(row[4]),
                "step": int(row[5]),
                "tx_type": row[6],
            })
        return txs
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch transactions: {e}")


@app.get("/api/graph")
def get_graph(limit: int = Query(default=80, ge=10, le=300)):
    """Fetch a manageable sample network of accounts and transfers for Cytoscape.js rendering."""
    try:
        res = db_client.execute_query(GRAPH_NAME, GET_GRAPH_SAMPLE, {"limit": limit}, caller="api:graph_sample")
        nodes_dict = {}
        edges = []

        for row in res.result_set:
            src_id, src_type, src_comm = row[0], row[1], row[2]
            dst_id, dst_type, dst_comm = row[3], row[4], row[5]
            tx_id, amount, ts, tx_type = row[6], float(row[7]), int(row[8]), row[9]

            if src_id not in nodes_dict:
                nodes_dict[src_id] = {
                    "data": {
                        "id": src_id,
                        "label": src_id,
                        "type": src_type,
                        "community": src_comm,
                    }
                }
            if dst_id not in nodes_dict:
                nodes_dict[dst_id] = {
                    "data": {
                        "id": dst_id,
                        "label": dst_id,
                        "type": dst_type,
                        "community": dst_comm,
                    }
                }

            edges.append({
                "data": {
                    "id": tx_id,
                    "source": src_id,
                    "target": dst_id,
                    "amount": amount,
                    "ts": ts,
                    "tx_type": tx_type,
                }
            })

        return {
            "nodes": list(nodes_dict.values()),
            "edges": edges,
            "total_nodes": len(nodes_dict),
            "total_edges": len(edges),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch graph sample: {e}")


@app.get("/api/accounts/{account_id}")
def get_account_details(account_id: str, limit: int = Query(default=25, ge=1, le=100)):
    """Fetch details and recent in/out transactions for a specific account."""
    try:
        acc_res = db_client.execute_query(GRAPH_NAME, GET_ACCOUNT_BY_ID, {"account_id": account_id}, caller="api:account_by_id")
        if not acc_res.result_set:
            raise HTTPException(status_code=404, detail=f"Account {account_id} not found")

        acc_row = acc_res.result_set[0]
        acc_data = {
            "id": acc_row[0],
            "type": acc_row[1],
            "community": acc_row[2],
            "created": acc_row[3],
        }

        # Outgoing transfers
        out_res = db_client.execute_query(GRAPH_NAME, GET_ACCOUNT_TRANSFERS_OUT, {"account_id": account_id, "limit": limit}, caller="api:account_transfers_out")
        out_txs = [
            {"tx_id": r[0], "src": r[1], "dst": r[2], "amount": float(r[3]), "ts": int(r[4]), "step": int(r[5]), "tx_type": r[6]}
            for r in out_res.result_set
        ]

        # Incoming transfers
        in_res = db_client.execute_query(GRAPH_NAME, GET_ACCOUNT_TRANSFERS_IN, {"account_id": account_id, "limit": limit}, caller="api:account_transfers_in")
        in_txs = [
            {"tx_id": r[0], "src": r[1], "dst": r[2], "amount": float(r[3]), "ts": int(r[4]), "step": int(r[5]), "tx_type": r[6]}
            for r in in_res.result_set
        ]

        total_sent = round(sum(t["amount"] for t in out_txs), 2)
        total_received = round(sum(t["amount"] for t in in_txs), 2)

        return {
            "account": acc_data,
            "outgoing": out_txs,
            "incoming": in_txs,
            "out_count": len(out_txs),
            "in_count": len(in_txs),
            "total_sent_sample": total_sent,
            "total_received_sample": total_received,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch account {account_id}: {e}")


@app.get("/api/search")
def search_accounts(q: str = Query(..., min_length=1), limit: int = Query(default=10, ge=1, le=50)):
    """Search accounts by ID or prefix."""
    try:
        res = db_client.execute_query(GRAPH_NAME, SEARCH_ACCOUNTS, {"query": q.upper(), "limit": limit}, caller="api:search_accounts")
        return [
            {"id": r[0], "type": r[1], "community": r[2]}
            for r in res.result_set
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to search accounts: {e}")


@app.get("/api/detectors/cycles")
@app.get("/api/v1/detectors/cycles")
def get_cycle_candidates(
    min_length: int = Query(default=3, ge=3, le=5, description="Minimum cycle length in hops (3-5)"),
    max_length: int = Query(default=5, ge=3, le=5, description="Maximum cycle length in hops (3-5)"),
    limit: int = Query(default=50, ge=1, le=200, description="Maximum candidates to return (1-200)"),
):
    """Detect directed transaction cycles in the transaction graph.

    Exposes the directed transaction cycle detector. Canonical node ordering prevents
    rotational duplicates, and results include complete transaction evidence without
    accessing ground-truth labels.
    """
    if min_length > max_length:
        raise HTTPException(
            status_code=400,
            detail=f"min_length ({min_length}) cannot be greater than max_length ({max_length})",
        )

    started_at = time.perf_counter()
    try:
        result = detect_cycles(
            min_length=min_length,
            max_length=max_length,
            limit=limit,
            graph_name=GRAPH_NAME,
            db=db_client,
        )
        return {
            "status": "success",
            "graph": GRAPH_NAME,
            "min_length": min_length,
            "max_length": max_length,
            "limit": limit,
            "count": len(result),
            "truncated": getattr(result, "truncated", False),
            "truncation_reason": getattr(result, "truncation_reason", None),
            "truncation_reasons": getattr(result, "truncation_reasons", []),
            "suspicious_count": sum(1 for candidate in result if candidate.get("suspicious")),
            "edges_scanned": getattr(result, "edges_scanned", 0),
            "search_steps": getattr(result, "search_steps", 0),
            "invalid_rows_skipped": getattr(result, "invalid_rows_skipped", 0),
            "execution_time_ms": round((time.perf_counter() - started_at) * 1000, 2),
            "cycles": list(result),
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to execute cycle detection against FalkorDB: {e}",
        )


@app.get("/api/detectors/fan-in")
@app.get("/api/v1/detectors/fan-in")
def get_fan_in_candidates(
    min_senders: int = Query(default=8, ge=2, le=50, description="Minimum distinct senders (2-50)"),
    window_hours: int = Query(default=48, ge=1, le=168, description="Rolling time window in hours (1-168)"),
    limit: int = Query(default=50, ge=1, le=200, description="Maximum candidates to return (1-200)"),
):
    """Detect fan-in patterns (concentration of distinct senders onto a single receiver within a rolling window)."""
    started_at = time.perf_counter()
    try:
        result = detect_fan_in(
            min_senders=min_senders,
            window_seconds=window_hours * 3600,
            limit=limit,
            graph_name=GRAPH_NAME,
            db=db_client,
        )
        return {
            "status": "success",
            "graph": GRAPH_NAME,
            "pattern": "fan_in",
            "min_senders": min_senders,
            "window_hours": window_hours,
            "limit": limit,
            "count": len(result),
            "truncated": getattr(result, "truncated", False),
            "truncation_reason": getattr(result, "truncation_reason", None),
            "truncation_reasons": getattr(result, "truncation_reasons", []),
            "suspicious_count": sum(1 for hit in result if hit.get("measurements", {}).get("suspicious")),
            "indeterminate_count": sum(1 for hit in result if hit.get("measurements", {}).get("suspicion_indeterminate")),
            "invalid_rows_skipped": getattr(result, "invalid_rows_skipped", 0),
            "execution_time_ms": round((time.perf_counter() - started_at) * 1000, 2),
            "hits": list(result),
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to execute fan-in detection against FalkorDB: {e}",
        )


@app.get("/api/detectors/fan-out")
@app.get("/api/v1/detectors/fan-out")
def get_fan_out_candidates(
    min_receivers: int = Query(default=8, ge=2, le=50, description="Minimum distinct receivers (2-50)"),
    window_hours: int = Query(default=48, ge=1, le=168, description="Rolling time window in hours (1-168)"),
    limit: int = Query(default=50, ge=1, le=200, description="Maximum candidates to return (1-200)"),
):
    """Detect fan-out patterns (rapid dispersal from a single origin to multiple distinct receivers within a rolling window)."""
    started_at = time.perf_counter()
    try:
        result = detect_fan_out(
            min_receivers=min_receivers,
            window_seconds=window_hours * 3600,
            limit=limit,
            graph_name=GRAPH_NAME,
            db=db_client,
        )
        return {
            "status": "success",
            "graph": GRAPH_NAME,
            "pattern": "fan_out",
            "min_receivers": min_receivers,
            "window_hours": window_hours,
            "limit": limit,
            "count": len(result),
            "truncated": getattr(result, "truncated", False),
            "truncation_reason": getattr(result, "truncation_reason", None),
            "truncation_reasons": getattr(result, "truncation_reasons", []),
            "suspicious_count": sum(1 for hit in result if hit.get("measurements", {}).get("suspicious")),
            "indeterminate_count": sum(1 for hit in result if hit.get("measurements", {}).get("suspicion_indeterminate")),
            "invalid_rows_skipped": getattr(result, "invalid_rows_skipped", 0),
            "execution_time_ms": round((time.perf_counter() - started_at) * 1000, 2),
            "hits": list(result),
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to execute fan-out detection against FalkorDB: {e}",
        )


def _graph_pattern_response(pattern: str, result: list, started_at: float) -> dict:
    """Build additive endpoint metadata shared by the three path detectors."""
    return {
        "status": "partial" if result.truncated else "success",
        "graph": GRAPH_NAME,
        "pattern": pattern,
        "count": len(result),
        "truncated": result.truncated,
        "truncation_reason": result.truncation_reason,
        "truncation_reasons": result.truncation_reasons,
        "invalid_rows_skipped": result.invalid_rows_skipped,
        "edges_scanned": result.edges_scanned,
        "search_steps": result.search_steps,
        "suspicious_count": sum(1 for hit in result if hit["measurements"].get("suspicious")),
        "execution_time_ms": round((time.perf_counter() - started_at) * 1000, 2),
        "hits": list(result),
    }


@app.get("/api/detectors/relay-chain")
@app.get("/api/v1/detectors/relay-chain")
def get_relay_chain_candidates(
    min_hops: int = Query(default=3, ge=3, le=6),
    max_hops: int = Query(default=6, ge=3, le=6),
    max_gap_hours: int = Query(default=6, ge=1, le=168),
    observation_hours: int = Query(default=24, ge=1, le=168),
    limit: int = Query(default=50, ge=1, le=200),
):
    started_at = time.perf_counter()
    try:
        result = detect_relay_chains(
            min_hops=min_hops, max_hops=max_hops,
            max_gap_seconds=max_gap_hours * 3600,
            observation_seconds=observation_hours * 3600,
            limit=limit, graph_name=GRAPH_NAME, db=db_client,
        )
        return _graph_pattern_response("relay_chain", result, started_at)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to execute relay-chain detection: {error}")


@app.get("/api/detectors/scatter-gather")
@app.get("/api/v1/detectors/scatter-gather")
def get_scatter_gather_candidates(
    min_intermediaries: int = Query(default=3, ge=2, le=50),
    max_path_gap_hours: int = Query(default=24, ge=1, le=168),
    observation_hours: int = Query(default=72, ge=1, le=168),
    limit: int = Query(default=50, ge=1, le=200),
):
    started_at = time.perf_counter()
    try:
        result = detect_scatter_gather(
            min_intermediaries=min_intermediaries,
            max_path_gap_seconds=max_path_gap_hours * 3600,
            observation_seconds=observation_hours * 3600,
            limit=limit, graph_name=GRAPH_NAME, db=db_client,
        )
        return _graph_pattern_response("scatter_gather", result, started_at)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to execute scatter-gather detection: {error}")


@app.get("/api/detectors/gather-scatter")
@app.get("/api/v1/detectors/gather-scatter")
def get_gather_scatter_candidates(
    min_incoming_counterparties: int = Query(default=3, ge=2, le=50),
    min_outgoing_counterparties: int = Query(default=3, ge=2, le=50),
    window_hours: int = Query(default=72, ge=1, le=168),
    max_activity_gap_hours: int = Query(default=12, ge=1, le=168),
    limit: int = Query(default=50, ge=1, le=200),
):
    started_at = time.perf_counter()
    try:
        result = detect_gather_scatter(
            min_incoming_counterparties=min_incoming_counterparties,
            min_outgoing_counterparties=min_outgoing_counterparties,
            window_seconds=window_hours * 3600,
            maximum_activity_gap_seconds=max_activity_gap_hours * 3600,
            limit=limit, graph_name=GRAPH_NAME, db=db_client,
        )
        return _graph_pattern_response("gather_scatter", result, started_at)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to execute gather-scatter detection: {error}")


@app.api_route("/api/evaluate/cycles", methods=["GET", "POST"])
def evaluate_cycles(limit: int = Query(default=50, ge=1, le=200)):
    """Evaluate the cycle detector against ground-truth labels on demand.

    CRITICAL CONSTRAINT: Detection code never calls this endpoint.
    This evaluation compares detected candidates with simulator ground-truth labels
    reporting exact matches, partial matches, precision, recall, and benign look-alikes.
    """
    try:
        from app.evaluator import evaluate_cycle_detector
        report = evaluate_cycle_detector(sample_limit=limit, graph_name=GRAPH_NAME, db=db_client)
        return report
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to evaluate cycle detector: {e}")


@app.api_route("/api/evaluate/fans", methods=["GET", "POST"])
@app.api_route("/api/v1/evaluate/fans", methods=["GET", "POST"])
def evaluate_fan_patterns(limit: int = Query(default=50, ge=1, le=200)):
    """Evaluate fan-in and fan-out using the evaluator-only ground-truth path."""
    try:
        from app.evaluator import evaluate_fan_detectors
        return evaluate_fan_detectors(sample_limit=limit, graph_name=GRAPH_NAME, db=db_client)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to evaluate fan detectors: {error}")


@app.api_route("/api/evaluate/graph-patterns", methods=["GET", "POST"])
@app.api_route("/api/v1/evaluate/graph-patterns", methods=["GET", "POST"])
def evaluate_graph_patterns(limit: int = Query(default=50, ge=1, le=200)):
    """Evaluate relay, scatter-gather, and gather-scatter evidence independently."""
    try:
        from app.evaluator import evaluate_additional_graph_detectors
        return evaluate_additional_graph_detectors(sample_limit=limit, graph_name=GRAPH_NAME, db=db_client)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to evaluate graph pattern detectors: {error}")


# Member A routes live in their own module. The existing aliases above remain
# in place so the current frontend keeps its response shape during migration.
try:
    from app.api.detection_routes import router as detection_router
except ImportError:
    from backend.app.api.detection_routes import router as detection_router

app.include_router(detection_router)


