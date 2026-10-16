"""FastAPI application for RingTrace."""
import os
import sys
from typing import Dict, List, Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

try:
    from app.api.investigation_routes import router as investigation_router
    from app.db import FalkorDBClient
    from app.detectors.cycle import detect_cycles
    from app.queries import (
        COUNT_ACCOUNTS,
        COUNT_SENT,
        GET_ACCOUNT_BY_ID,
        GET_ACCOUNT_TRANSFERS_IN,
        GET_ACCOUNT_TRANSFERS_OUT,
        GET_GRAPH_SAMPLE,
        GET_RECENT_TRANSACTIONS,
        SEARCH_ACCOUNTS,
    )
except ImportError:
    from backend.app.api.investigation_routes import router as investigation_router
    from backend.app.db import FalkorDBClient
    from backend.app.detectors.cycle import detect_cycles
    from backend.app.queries import (
        COUNT_ACCOUNTS,
        COUNT_SENT,
        GET_ACCOUNT_BY_ID,
        GET_ACCOUNT_TRANSFERS_IN,
        GET_ACCOUNT_TRANSFERS_OUT,
        GET_GRAPH_SAMPLE,
        GET_RECENT_TRANSACTIONS,
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

GRAPH_NAME = os.getenv("FALKORDB_GRAPH", "txn")
db_client = FalkorDBClient()


@app.get("/api/health")
def get_health():
    """Healthcheck endpoint distinguishing app health from FalkorDB connectivity."""
    try:
        # Ping FalkorDB
        res = db_client.execute_query(GRAPH_NAME, "RETURN 1", caller="api:health")
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

    try:
        candidates = detect_cycles(
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
            "count": len(candidates),
            "cycles": candidates,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to execute cycle detection against FalkorDB: {e}",
        )

