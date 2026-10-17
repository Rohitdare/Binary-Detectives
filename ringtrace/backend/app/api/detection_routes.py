"""Member A case, scan, scenario, account, and evaluation routes."""
import base64
import hmac
import json
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, Header, Query, Request
from fastapi.responses import JSONResponse

try:
    from app.api.models import (
        AccountProfile, CaseDetail, CaseListResponse, CaseRecord, DetectorResponse,
        EvaluationJob, EvaluationResponse, EvaluationStatus, GraphData, GraphSummary, HealthResponse,
        ScanReceipt, ScanStatus, ScenarioInjectionResponse, ScenarioListResponse,
        ScenarioRequest, SchedulerStatusResponse,
    )
    from app.cases.builder import load_account_types
    from app.db import FalkorDBClient
    from app.detectors import detect_bipartite, detect_dense_clusters, detect_hub_accounts
    from app.queries import (
        COUNT_CASES, COUNT_ACCOUNTS, COUNT_SENT, GET_ACCOUNT_BY_ID,
        GET_ACCOUNT_TRANSFERS_IN, GET_ACCOUNT_TRANSFERS_OUT, GET_CASES_BY_SCORE,
        GET_CASES_BY_UPDATED, GET_CASES_FOR_ACCOUNT, GET_CASE_BY_ID,
        GET_CASE_DECISIONS, GET_CASE_HITS, GET_GRAPH_COUNTS_AND_RANGE,
        GET_CASE_PATTERN_COUNTS, GET_NEIGHBORHOOD_EDGES, MERGE_ACCOUNTS,
        MERGE_TRANSACTIONS, PING_FALKORDB,
    )
    from app.scan_service import (
        create_scan_job, get_active_scan_id, get_latest_scan_job, get_scan_job,
        is_scan_active, list_scan_jobs, record_skipped_scan, run_scan,
    )
    from app.scheduler import get_scheduler
except ImportError:
    from backend.app.api.models import (
        AccountProfile, CaseDetail, CaseListResponse, CaseRecord, DetectorResponse,
        EvaluationJob, EvaluationResponse, EvaluationStatus, GraphData, GraphSummary, HealthResponse,
        ScanReceipt, ScanStatus, ScenarioInjectionResponse, ScenarioListResponse,
        ScenarioRequest, SchedulerStatusResponse,
    )
    from backend.app.cases.builder import load_account_types
    from backend.app.db import FalkorDBClient
    from backend.app.detectors import detect_bipartite, detect_dense_clusters, detect_hub_accounts
    from backend.app.queries import (
        COUNT_CASES, COUNT_ACCOUNTS, COUNT_SENT, GET_ACCOUNT_BY_ID,
        GET_ACCOUNT_TRANSFERS_IN, GET_ACCOUNT_TRANSFERS_OUT, GET_CASES_BY_SCORE,
        GET_CASES_BY_UPDATED, GET_CASES_FOR_ACCOUNT, GET_CASE_BY_ID,
        GET_CASE_DECISIONS, GET_CASE_HITS, GET_GRAPH_COUNTS_AND_RANGE,
        GET_CASE_PATTERN_COUNTS, GET_NEIGHBORHOOD_EDGES, MERGE_ACCOUNTS,
        MERGE_TRANSACTIONS, PING_FALKORDB,
    )
    from backend.app.scan_service import (
        create_scan_job, get_active_scan_id, get_latest_scan_job, get_scan_job,
        is_scan_active, list_scan_jobs, record_skipped_scan, run_scan,
    )
    from backend.app.scheduler import get_scheduler


router = APIRouter()
_latest_evaluation: Dict[str, Any] = {"status": "not_run", "reports": {}}
_evaluation_jobs: Dict[str, Dict[str, Any]] = {}


def _db(request: Request) -> FalkorDBClient:
    return request.app.state.db_client


def _graph(request: Request) -> str:
    return request.app.state.graph_name


def _memory_graph() -> str:
    return os.getenv("FALKORDB_MEMORY_GRAPH", "memory")


def _error(status: int, code: str, message: str, details: Optional[dict] = None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "details": details or {}}})


def _case_from_row(row: Any) -> Optional[dict]:
    if not row or not row[0]:
        return None
    raw = row[0].decode("utf-8") if isinstance(row[0], bytes) else row[0]
    case = json.loads(raw) if isinstance(raw, str) else dict(raw)
    case["status"] = str(row[1] or case.get("status", "open"))
    return case


def _decode_cursor(cursor: Optional[str]) -> int:
    if not cursor:
        return 0
    try:
        offset = int(base64.urlsafe_b64decode(cursor.encode("ascii")).decode("ascii"))
        if offset < 0:
            raise ValueError
        return offset
    except Exception as error:
        raise ValueError("cursor is invalid") from error


@router.get("/api/v1/health", response_model=HealthResponse)
@router.get("/api/health", response_model=HealthResponse)
def health(request: Request):
    try:
        result = _db(request).execute_query(_graph(request), PING_FALKORDB, caller="api:health")
        connected = bool(result and result.result_set)
        return {"status": "healthy" if connected else "degraded", "falkordb_connected": connected, "graph": _graph(request)}
    except Exception as error:
        return _error(503, "database_unavailable", "FalkorDB is unavailable", {"reason": str(error)})


@router.get("/api/graph/summary", response_model=GraphSummary)
@router.get("/api/v1/graph/summary", response_model=GraphSummary)
def graph_summary(request: Request):
    db = _db(request)
    try:
        rows = db.execute_query(_graph(request), GET_GRAPH_COUNTS_AND_RANGE, caller="api:graph_summary").result_set or []
        row = rows[0] if rows else [0, 0, None, None]
        cases = db.execute_query(_memory_graph(), COUNT_CASES, caller="api:case_count").result_set or [[0]]
        pattern_rows = db.execute_query(_memory_graph(), GET_CASE_PATTERN_COUNTS, caller="api:case_patterns").result_set or []
        return {"graph": _graph(request), "account_count": int(row[0] or 0), "transaction_count": int(row[1] or 0),
                "first_transaction_ts": row[2], "last_transaction_ts": row[3], "case_count": int(cases[0][0] or 0),
                "cases_by_pattern": {str(item[0]): int(item[1]) for item in pattern_rows}}
    except Exception as error:
        return _error(503, "summary_unavailable", "Could not read graph summary", {"reason": str(error)})


@router.post("/api/scan", status_code=202, response_model=ScanReceipt)
@router.post("/api/v1/scan", status_code=202, response_model=ScanReceipt)
def start_scan(request: Request, background_tasks: BackgroundTasks):
    if is_scan_active():
        active_id = get_active_scan_id()
        skipped_id = create_scan_job(trigger="manual")
        record_skipped_scan(skipped_id, active_id=active_id, trigger="manual")
        return {
            "scan_id": skipped_id,
            "status": "skipped",
            "active_scan_id": active_id,
            "message": f"Scan skipped: another scan ({active_id}) is currently executing. Track progress at /api/v1/scan/{active_id}",
        }

    scan_id = create_scan_job(trigger="manual")
    background_tasks.add_task(
        run_scan,
        scan_id=scan_id,
        db=_db(request),
        graph_name=_graph(request),
        memory_graph=_memory_graph(),
        trigger="manual",
    )
    return {
        "scan_id": scan_id,
        "status": "running",
        "active_scan_id": None,
        "message": "Scan dispatched",
    }


@router.get("/api/scan/{scan_id}", response_model=ScanStatus)
@router.get("/api/v1/scan/{scan_id}", response_model=ScanStatus)
def scan_status(scan_id: str):
    job = get_scan_job(scan_id)
    return job if job else _error(404, "not_found", "Scan was not found")


@router.get("/api/scheduler/status", response_model=SchedulerStatusResponse)
@router.get("/api/v1/scheduler/status", response_model=SchedulerStatusResponse)
def scheduler_status():
    scheduler = get_scheduler()
    if scheduler:
        return scheduler.get_status()
    try:
        from app.scheduler.config import SchedulerConfig
    except ImportError:
        from backend.app.scheduler.config import SchedulerConfig
    cfg = SchedulerConfig.from_env()
    return {
        "enabled": cfg.enabled,
        "running": False,
        "interval_seconds": cfg.interval_seconds,
        "scan_on_startup": cfg.scan_on_startup,
        "next_run_at": None,
        "last_run_at": None,
        "run_count": 0,
        "failure_count": 0,
        "skip_count": 0,
        "is_scan_active": is_scan_active(),
        "active_scan_id": get_active_scan_id(),
        "latest_scan": get_latest_scan_job(),
    }


@router.get("/api/scans/latest", response_model=ScanStatus)
@router.get("/api/v1/scans/latest", response_model=ScanStatus)
def latest_scan():
    latest = get_latest_scan_job()
    if not latest:
        return _error(404, "not_found", "No scan has been executed yet")
    return latest


@router.get("/api/scans", response_model=list[ScanStatus])
@router.get("/api/v1/scans", response_model=list[ScanStatus])
def list_scans(limit: int = Query(default=20, ge=1, le=100)):
    return list_scan_jobs(limit=limit)



@router.get("/api/cases", response_model=CaseListResponse)
@router.get("/api/v1/cases", response_model=CaseListResponse)
def list_cases(
    request: Request,
    status: Optional[str] = Query(default=None, pattern="^(open|escalated|monitoring|dismissed|sar_drafted)$"),
    pattern: Optional[str] = None,
    severity: Optional[str] = Query(default=None, pattern="^(low|medium|high)$"),
    sort: str = Query(default="score", pattern="^(score|updated_at)$"),
    limit: int = Query(default=50, ge=1, le=200),
    cursor: Optional[str] = None,
):
    try:
        offset = _decode_cursor(cursor)
        query = GET_CASES_BY_UPDATED if sort == "updated_at" else GET_CASES_BY_SCORE
        result = _db(request).execute_query(_memory_graph(), query,
            {"status": status, "pattern": pattern, "severity": severity, "offset": offset, "limit": limit + 1},
            caller="api:list_cases").result_set or []
        cases = [case for row in result if (case := _case_from_row(row)) is not None]
        has_more = len(cases) > limit
        items = cases[:limit]
        next_cursor = base64.urlsafe_b64encode(str(offset + limit).encode("ascii")).decode("ascii") if has_more else None
        return {"items": items, "next_cursor": next_cursor}
    except ValueError as error:
        return _error(400, "invalid_cursor", str(error))
    except Exception as error:
        return _error(503, "cases_unavailable", "Could not read cases", {"reason": str(error)})


@router.get("/api/cases/{case_id}", response_model=CaseDetail)
@router.get("/api/v1/cases/{case_id}", response_model=CaseDetail)
def get_case(case_id: str, request: Request):
    db = _db(request)
    try:
        result = db.execute_query(_memory_graph(), GET_CASE_BY_ID, {"case_id": case_id}, caller="api:get_case").result_set or []
        case = _case_from_row(result[0]) if result else None
        if not case:
            return _error(404, "not_found", "Case not found")
        hit_rows = db.execute_query(_memory_graph(), GET_CASE_HITS, {"case_id": case_id}, caller="api:case_hits").result_set or []
        hits = [json.loads(row[0]) if isinstance(row[0], str) else row[0] for row in hit_rows]
        decision_rows = db.execute_query(_memory_graph(), GET_CASE_DECISIONS, {"case_id": case_id}, caller="api:case_decisions").result_set or []
        case["hits"] = hits or case.get("hits", [])
        if hits:
            transactions = {tx.get("tx_id"): tx for hit in hits for tx in hit.get("transactions", []) if tx.get("tx_id")}
            case["transactions"] = sorted(transactions.values(), key=lambda tx: (int(tx.get("ts", 0)), tx["tx_id"]))
        case["decisions"] = [{"decision_id": row[0], "decision": row[1], "note": row[2], "actor": row[3], "ts": row[4]} for row in decision_rows]
        return case
    except Exception as error:
        return _error(503, "case_unavailable", "Could not read case detail", {"reason": str(error)})


@router.get("/api/cases/{case_id}/graph", response_model=GraphData)
@router.get("/api/v1/cases/{case_id}/graph", response_model=GraphData)
def case_graph(case_id: str, request: Request):
    case = get_case(case_id, request)
    if isinstance(case, JSONResponse):
        return case
    account_types = case.get("account_types", {})
    roles: Dict[str, set[str]] = {}
    for hit in case.get("hits", []):
        for account_id, role in (hit.get("account_roles") or {}).items():
            roles.setdefault(account_id, set()).add(role)
    nodes = [{"id": account, "type": account_types.get(account, "unknown"),
              "roles": sorted(roles.get(account, set())), "in_case": True} for account in case.get("account_ids", [])]
    edges = [{"tx_id": tx["tx_id"], "source": tx["src"], "target": tx["dst"],
              "amount": tx["amount"], "ts": tx["ts"]} for tx in case.get("transactions", [])]
    included = {node["id"] for node in nodes}
    for edge in edges:
        for account_id in (edge["source"], edge["target"]):
            if account_id not in included:
                nodes.append({"id": account_id, "type": account_types.get(account_id, "unknown"),
                              "roles": ["supporting_counterparty"], "in_case": False})
                included.add(account_id)
    return {"nodes": nodes, "edges": edges}


@router.get("/api/accounts/{account_id}", response_model=AccountProfile)
@router.get("/api/v1/accounts/{account_id}", response_model=AccountProfile)
def account_profile(account_id: str, request: Request, limit: int = Query(default=25, ge=1, le=100)):
    db, graph = _db(request), _graph(request)
    try:
        account = db.execute_query(graph, GET_ACCOUNT_BY_ID, {"account_id": account_id}, caller="api:account").result_set or []
        if not account:
            return _error(404, "not_found", "Account not found", {"account_id": account_id})
        row = account[0]
        outgoing = db.execute_query(graph, GET_ACCOUNT_TRANSFERS_OUT, {"account_id": account_id, "limit": limit}, caller="api:account_outgoing").result_set or []
        incoming = db.execute_query(graph, GET_ACCOUNT_TRANSFERS_IN, {"account_id": account_id, "limit": limit}, caller="api:account_incoming").result_set or []
        cases_raw = db.execute_query(_memory_graph(), GET_CASES_FOR_ACCOUNT, {"account_id": account_id, "limit": limit}, caller="api:account_cases").result_set or []
        cases = [_case_from_row(item) for item in cases_raw]
        to_tx = lambda item: {"tx_id": item[0], "src": item[1], "dst": item[2], "amount": float(item[3]), "ts": int(item[4]), "step": int(item[5] or 0), "tx_type": item[6]}
        return {"account": {"id": row[0], "type": row[1], "community": row[2], "created": row[3]},
                "incoming": [to_tx(item) for item in incoming], "outgoing": [to_tx(item) for item in outgoing],
                "linked_cases": cases}
    except Exception as error:
        return _error(503, "account_unavailable", "Could not read account", {"reason": str(error)})


@router.get("/api/accounts/{account_id}/neighborhood", response_model=GraphData)
@router.get("/api/v1/accounts/{account_id}/neighborhood", response_model=GraphData)
def account_neighborhood(account_id: str, request: Request,
                         hops: int = Query(default=1, ge=1, le=3), limit: int = Query(default=200, ge=1, le=1000)):
    db, graph = _db(request), _graph(request)
    try:
        exists = db.execute_query(graph, GET_ACCOUNT_BY_ID, {"account_id": account_id}, caller="api:neighborhood_account").result_set or []
        if not exists:
            return _error(404, "not_found", "Account not found", {"account_id": account_id})
        reached = {account_id}
        edge_map = {}
        for _ in range(hops):
            result = db.execute_query(graph, GET_NEIGHBORHOOD_EDGES,
                {"account_ids": sorted(reached), "limit": limit}, caller="api:account_neighborhood").result_set or []
            for row in result:
                edge_map[str(row[6])] = {"tx_id": row[6], "source": row[0], "target": row[3], "amount": float(row[7]), "ts": int(row[8])}
                reached.update((str(row[0]), str(row[3])))
        ids = sorted(reached)
        types = load_account_types(ids, db=db, graph_name=graph)
        return {"nodes": [{"id": item, "type": types.get(item, "unknown"), "roles": ["selected"] if item == account_id else []} for item in ids],
                "edges": list(edge_map.values())}
    except Exception as error:
        return _error(503, "neighborhood_unavailable", "Could not read account neighborhood", {"reason": str(error)})


@router.get("/api/detectors/bipartite", response_model=DetectorResponse)
@router.get("/api/v1/detectors/bipartite", response_model=DetectorResponse)
def bipartite(request: Request, min_sources: int = Query(default=3, ge=2, le=50),
              min_targets: int = Query(default=3, ge=2, le=50), limit: int = Query(default=50, ge=1, le=200)):
    return _detector_response("bipartite", detect_bipartite, request, min_sources=min_sources, min_targets=min_targets, limit=limit)


@router.get("/api/detectors/dense-cluster", response_model=DetectorResponse)
@router.get("/api/v1/detectors/dense-cluster", response_model=DetectorResponse)
def dense_cluster(request: Request, min_accounts: int = Query(default=5, ge=3, le=60),
                  minimum_density: float = Query(default=0.1, gt=0, le=1), limit: int = Query(default=50, ge=1, le=200)):
    return _detector_response("dense_cluster", detect_dense_clusters, request, min_accounts=min_accounts, minimum_density=minimum_density, limit=limit)


@router.get("/api/detectors/hub-account", response_model=DetectorResponse)
@router.get("/api/v1/detectors/hub-account", response_model=DetectorResponse)
def hub_account(request: Request, minimum_counterparties: int = Query(default=10, ge=2, le=200),
                minimum_z_score: float = Query(default=3, gt=0, le=20), limit: int = Query(default=50, ge=1, le=200)):
    return _detector_response("hub_account", detect_hub_accounts, request, minimum_counterparties=minimum_counterparties, minimum_z_score=minimum_z_score, limit=limit)


def _detector_response(pattern: str, detector: Any, request: Request, **params: Any):
    started = time.perf_counter()
    try:
        result = detector(graph_name=_graph(request), db=_db(request), **params)
        return {"status": "partial" if result.truncated else "success", "pattern": pattern,
                "count": len(result), "hits": list(result), "truncated": result.truncated,
                "truncation_reasons": result.truncation_reasons, "edges_scanned": result.edges_scanned,
                "search_steps": result.search_steps, "execution_time_ms": round((time.perf_counter() - started) * 1000, 2)}
    except ValueError as error:
        return _error(400, "invalid_parameter", str(error))
    except Exception as error:
        return _error(500, "detector_failed", f"{pattern} detector failed", {"reason": str(error)})


SCENARIOS = {
    "cycle_ring": {"account_count": 4, "transactions": [(0, 1, 100000, 0), (1, 2, 96000, 600), (2, 3, 92000, 1200), (3, 0, 88000, 1800)]},
    "structuring_fan_in": {"account_count": 10, "transactions": [(index, 9, 46000, index * 120) for index in range(9)]},
    "payroll_fan_out": {"account_count": 9, "transactions": [(0, index, 80000, offset + index * 60) for offset in (0, 30 * 86400) for index in range(1, 9)]},
    "relay_chain": {"account_count": 4, "transactions": [(0, 1, 100000, 0), (1, 2, 95000, 300), (2, 3, 90000, 600)]},
}


@router.get("/api/scenarios", response_model=ScenarioListResponse)
@router.get("/api/v1/scenarios", response_model=ScenarioListResponse)
def scenarios():
    return {"items": [{"scenario_id": key, "account_count": value["account_count"], "transaction_count": len(value["transactions"])} for key, value in SCENARIOS.items()]}


@router.post("/api/scenarios/inject", status_code=202, response_model=ScenarioInjectionResponse)
@router.post("/api/v1/scenarios/inject", status_code=202, response_model=ScenarioInjectionResponse)
def inject_scenario(body: ScenarioRequest, request: Request, background_tasks: BackgroundTasks,
                    x_demo_key: Optional[str] = Header(default=None, alias="X-Demo-Key")):
    expected = os.getenv("RINGTRACE_DEMO_KEY")
    if not expected or not x_demo_key or not hmac.compare_digest(expected, x_demo_key):
        return _error(401, "unauthorized", "A valid X-Demo-Key is required for scenario injection")
    scenario = SCENARIOS.get(body.scenario_id)
    if scenario is None:
        return _error(404, "scenario_not_found", "Unknown scenario", {"scenario_id": body.scenario_id})
    suffix = uuid.uuid4().hex[:8]
    prefix = f"demo_{body.scenario_id}_{suffix}"
    base_ts = int(time.time()) - (30 * 86400 if body.scenario_id == "payroll_fan_out" else 0)
    accounts = [{"id": f"{prefix}_{index:02d}", "type": "payroll" if body.scenario_id == "payroll_fan_out" and index == 0 else "personal", "community": -1, "created": "demo"}
                for index in range(scenario["account_count"])]
    transactions = [{"tx_id": f"TX_{prefix}_{index:02d}", "src": accounts[src]["id"], "dst": accounts[dst]["id"],
                     "amount": amount, "ts": base_ts + offset, "step": index + 1, "tx_type": "UPI"}
                    for index, (src, dst, amount, offset) in enumerate(scenario["transactions"])]
    try:
        db, graph = _db(request), _graph(request)
        db.execute_query(graph, MERGE_ACCOUNTS, {"rows": accounts}, caller="scenario:inject_accounts")
        db.execute_query(graph, MERGE_TRANSACTIONS, {"rows": transactions}, caller="scenario:inject_transactions")
        scan_id = create_scan_job()
        background_tasks.add_task(run_scan, scan_id, db, graph, _memory_graph())
        return {"injected_accounts": len(accounts), "injected_tx": len(transactions), "rescan": "queued", "scan_id": scan_id}
    except Exception as error:
        return _error(500, "scenario_injection_failed", "Could not inject scenario", {"reason": str(error)})


def _run_evaluation(job_id: str, request_db: FalkorDBClient, graph: str):
    global _latest_evaluation
    try:
        from app.evaluator import evaluate_additional_graph_detectors, evaluate_cycle_detector, evaluate_fan_detectors
        from app.detectors.graph_pattern_utils import read_pattern_edges
        edge_snapshot = read_pattern_edges(request_db, graph, 250_000)
        reports = {
            "cycles": evaluate_cycle_detector(graph_name=graph, db=request_db, edge_snapshot=edge_snapshot),
            "fans": evaluate_fan_detectors(graph_name=graph, db=request_db, edge_snapshot=edge_snapshot),
            "graph_patterns": evaluate_additional_graph_detectors(graph_name=graph, db=request_db, edge_snapshot=edge_snapshot),
        }
        _latest_evaluation = {"status": "complete", "run_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "reports": reports}
        _evaluation_jobs[job_id] = {"status": "complete", **_latest_evaluation}
    except Exception as error:
        _evaluation_jobs[job_id] = {"status": "failed", "error": str(error)}


@router.get("/api/evaluation", response_model=EvaluationResponse)
@router.get("/api/v1/evaluation", response_model=EvaluationResponse)
def latest_evaluation():
    return _latest_evaluation


@router.post("/api/evaluation/run", status_code=202, response_model=EvaluationJob)
@router.post("/api/v1/evaluation/run", status_code=202, response_model=EvaluationJob)
def start_evaluation(request: Request, background_tasks: BackgroundTasks):
    job_id = f"EVAL_{uuid.uuid4().hex[:12]}"
    _evaluation_jobs[job_id] = {"status": "queued"}
    background_tasks.add_task(_run_evaluation, job_id, _db(request), _graph(request))
    return {"evaluation_id": job_id, "status": "queued"}


@router.get("/api/v1/evaluation/{evaluation_id}", response_model=EvaluationStatus)
@router.get("/api/evaluation/{evaluation_id}", response_model=EvaluationStatus)
def evaluation_status(evaluation_id: str):
    job = _evaluation_jobs.get(evaluation_id)
    return {"evaluation_id": evaluation_id, **job} if job else _error(404, "not_found", "Evaluation was not found")
