"""Single Member A detector registry, background scan coordinator, and concurrency manager."""
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

try:
    from app.cases.builder import build_cases, load_account_types, persist_cases
    from app.db import FalkorDBClient
    from app.detectors import (
        detect_bipartite, detect_cycles, detect_dense_clusters, detect_fan_in,
        detect_fan_out, detect_gather_scatter, detect_hub_accounts,
        detect_relay_chains, detect_scatter_gather,
    )
    from app.detectors.graph_pattern_utils import read_pattern_edges
except ImportError:
    from backend.app.cases.builder import build_cases, load_account_types, persist_cases
    from backend.app.db import FalkorDBClient
    from backend.app.detectors import (
        detect_bipartite, detect_cycles, detect_dense_clusters, detect_fan_in,
        detect_fan_out, detect_gather_scatter, detect_hub_accounts,
        detect_relay_chains, detect_scatter_gather,
    )
    from backend.app.detectors.graph_pattern_utils import read_pattern_edges


# This is the single authoritative detector registration list for all scan passes.
DETECTOR_REGISTRY = (
    ("cycle", detect_cycles),
    ("fan_in", detect_fan_in),
    ("fan_out", detect_fan_out),
    ("relay_chain", detect_relay_chains),
    ("scatter_gather", detect_scatter_gather),
    ("gather_scatter", detect_gather_scatter),
    ("bipartite", detect_bipartite),
    ("dense_cluster", detect_dense_clusters),
    ("hub_account", detect_hub_accounts),
)

_jobs: Dict[str, Dict[str, Any]] = {}
_jobs_lock = threading.Lock()

# Non-reentrant lock to enforce mutual exclusion across all scan triggers.
_scan_execution_lock = threading.Lock()
_active_scan_id: Optional[str] = None
_active_scan_id_lock = threading.Lock()

_shutting_down: bool = False
_shutting_down_lock = threading.Lock()


def set_shutting_down(value: bool = True) -> None:
    """Set cooperative shutdown flag to halt ongoing/subsequent detector executions."""
    global _shutting_down
    with _shutting_down_lock:
        _shutting_down = value


def is_shutting_down() -> bool:
    """Check if application shutdown was requested."""
    with _shutting_down_lock:
        return _shutting_down


def reset_scan_service_state() -> None:
    """Reset in-memory jobs, active scan ID, and shutdown flag for test isolation."""
    global _shutting_down, _active_scan_id
    with _jobs_lock:
        _jobs.clear()
    with _active_scan_id_lock:
        _active_scan_id = None
    with _shutting_down_lock:
        _shutting_down = False


def is_scan_active() -> bool:
    """Return True if a scan is currently executing."""
    with _active_scan_id_lock:
        return _active_scan_id is not None



def get_active_scan_id() -> Optional[str]:
    """Return the currently executing scan_id, or None if idle."""
    with _active_scan_id_lock:
        return _active_scan_id


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _iso_from_ts(ts: Optional[int]) -> Optional[str]:
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(ts, timezone.utc).isoformat().replace("+00:00", "Z")
    except (ValueError, OSError, OverflowError):
        return None


def create_scan_job(trigger: str = "manual") -> str:
    """Register a new scan job entry in memory."""
    scan_id = f"SCAN_{uuid.uuid4().hex[:12]}"
    now_iso = _iso_now()
    with _jobs_lock:
        _jobs[scan_id] = {
            "scan_id": scan_id,
            "trigger": trigger,
            "status": "running",
            "created_at": time.time(),
            "started_at": now_iso,
            "finished_at": None,
            "duration_ms": None,
            "effective_window_start": None,
            "effective_window_end": None,
            "detectors_completed": [],
            "detectors_failed": [],
            "detector_reports": {},
            "detector_errors": {},
            "hits_found": 0,
            "hit_count": 0,
            "cases_created_or_updated": 0,
            "case_count": 0,
            "error_summary": None,
            "limitations": ["Priority score is a heuristic triage value, not a fraud probability."],
            "skipped_non_case_generating_hit_ids": [],
            "skipped_oversized_hit_ids": [],
        }
        # Maintain bounded in-memory history
        history_limit = int(os.getenv("DETECTION_SCAN_HISTORY_LIMIT", "100"))
        completed = [k for k, v in _jobs.items() if v.get("status") in {"complete", "partial", "failed", "skipped"}]
        for k in completed[:-history_limit]:
            _jobs.pop(k, None)
    return scan_id


def record_skipped_scan(scan_id: str, active_id: Optional[str], trigger: str = "manual") -> Dict[str, Any]:
    """Mark a scan as skipped due to an active concurrent scan."""
    now_iso = _iso_now()
    error_msg = (
        f"Scan skipped: another scan ({active_id or 'in-progress'}) is currently executing"
    )
    with _jobs_lock:
        job = _jobs.get(scan_id)
        if not job:
            job = {
                "scan_id": scan_id,
                "trigger": trigger,
                "created_at": time.time(),
            }
            _jobs[scan_id] = job
        job.update({
            "status": "skipped",
            "started_at": now_iso,
            "finished_at": now_iso,
            "duration_ms": 0.0,
            "error_summary": error_msg,
            "detectors_completed": [],
            "detectors_failed": [],
            "detector_reports": {},
            "detector_errors": {"concurrency": error_msg},
            "hits_found": 0,
            "hit_count": 0,
            "cases_created_or_updated": 0,
            "case_count": 0,
        })
        return dict(job)


def get_scan_job(scan_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve a copy of a scan job record by scan_id."""
    with _jobs_lock:
        job = _jobs.get(scan_id)
        return dict(job) if job else None


def update_scan_job(scan_id: str, updates: Dict[str, Any]) -> None:
    """Update fields in an existing scan job record thread-safely."""
    with _jobs_lock:
        if scan_id in _jobs:
            _jobs[scan_id].update(updates)


def get_latest_scan_job() -> Optional[Dict[str, Any]]:
    """Retrieve the most recently registered scan job."""
    with _jobs_lock:
        if not _jobs:
            return None
        # Sort by created_at descending
        sorted_jobs = sorted(_jobs.values(), key=lambda j: j.get("created_at", 0), reverse=True)
        return dict(sorted_jobs[0])


def list_scan_jobs(limit: int = 50) -> List[Dict[str, Any]]:
    """Return a list of recent scan jobs, sorted newest first."""
    with _jobs_lock:
        sorted_jobs = sorted(_jobs.values(), key=lambda j: j.get("created_at", 0), reverse=True)
        return [dict(j) for j in sorted_jobs[:limit]]


def run_scan(
    scan_id: str,
    db: FalkorDBClient,
    graph_name: str = "txn",
    memory_graph: str = "memory",
    lookback_seconds: Optional[int] = None,
    trigger: str = "manual",
) -> None:
    """Execute the detection pipeline with strict mutual exclusion against overlapping scans."""
    global _active_scan_id

    # 1. Attempt non-blocking lock acquisition to prevent overlapping scans
    acquired = _scan_execution_lock.acquire(blocking=False)
    if not acquired:
        with _active_scan_id_lock:
            current_active = _active_scan_id
        record_skipped_scan(scan_id, current_active, trigger=trigger)
        return

    # 2. Lock successfully acquired; mark as active
    with _active_scan_id_lock:
        _active_scan_id = scan_id

    t_start = time.perf_counter()
    start_iso = _iso_now()

    with _jobs_lock:
        job = _jobs.get(scan_id)
        if job:
            job["status"] = "running"
            job["started_at"] = start_iso
            job["trigger"] = trigger

    detector_reports: Dict[str, Any] = {}
    detectors_completed: List[str] = []
    detectors_failed: List[str] = []
    all_hits = []
    errors: Dict[str, str] = {}
    effective_window_start: Optional[str] = None
    effective_window_end: Optional[str] = None

    try:
        # Step A: Bounded transaction edge snapshot
        try:
            edge_snapshot = read_pattern_edges(db, graph_name, 250_000)
            edges_list = edge_snapshot[0] if edge_snapshot and len(edge_snapshot) > 0 else []

            # Determine effective time window across the scanned dataset
            if edges_list:
                timestamps = [int(edge["ts"]) for edge in edges_list if "ts" in edge and edge["ts"] is not None]
                if timestamps:
                    min_ts = min(timestamps)
                    max_ts = max(timestamps)
                    effective_window_start = _iso_from_ts(min_ts)
                    effective_window_end = _iso_from_ts(max_ts)

            snapshot_account_ids = {edge["src"] for edge in edges_list} | {edge["dst"] for edge in edges_list}
            account_types = load_account_types(snapshot_account_ids, db=db, graph_name=graph_name)
        except Exception as error:
            duration_ms = round((time.perf_counter() - t_start) * 1000, 2)
            finish_iso = _iso_now()
            with _jobs_lock:
                if scan_id in _jobs:
                    _jobs[scan_id].update({
                        "status": "failed",
                        "finished_at": finish_iso,
                        "duration_ms": duration_ms,
                        "error_summary": f"Fatal snapshot read failure: {error}",
                        "detector_errors": {"edge_snapshot": str(error)},
                        "detectors_failed": ["edge_snapshot"],
                    })
            return

        # Step B: Execute all registered detectors
        for pattern, detector in DETECTOR_REGISTRY:
            if is_shutting_down():
                errors["shutdown"] = "Scan interrupted by application shutdown"
                detectors_failed.append("interrupted_by_shutdown")
                break

            started = time.perf_counter()
            try:
                detector_args = {
                    "limit": 200,
                    "graph_name": graph_name,
                    "db": db,
                    "edge_snapshot": edge_snapshot,
                }
                if pattern in {"fan_in", "fan_out"}:
                    detector_args["account_types"] = account_types

                result = detector(**detector_args)
                hits = list(result)

                # Format cycle hits consistently with contract schema
                if pattern == "cycle" and hits and "cycle_id" in hits[0]:
                    hits = [{
                        "hit_id": item["cycle_id"],
                        "pattern": "cycle",
                        "account_ids": item["accounts"],
                        "account_roles": {
                            account: ("origin" if index == 0 else "intermediary")
                            for index, account in enumerate(item["accounts"])
                        },
                        "tx_ids": item.get("canonical_edge_sequence") or [tx["tx_id"] for tx in item.get("transactions", [])],
                        "transactions": item["transactions"],
                        "measurements": {
                            "cycle_length": item.get("cycle_length", len(item.get("accounts", []))),
                            "duration_seconds": item.get("duration_seconds", 0),
                            "amount_conservation_ratio": item.get("amount_conservation_ratio", 1.0),
                            "is_time_ordered": item.get("is_time_ordered", True),
                            "suspicious": item.get("suspicious", True),
                            "suspicion_rationale": item.get("suspicion_rationale", "Cycle detected"),
                        },
                        "explanation": item.get("explanation", ""),
                    } for item in hits]

                all_hits.extend(hits)
                detectors_completed.append(pattern)
                detector_reports[pattern] = {
                    "count": len(hits),
                    "suspicious_count": sum(bool(hit.get("measurements", {}).get("suspicious")) for hit in hits),
                    "truncated": bool(getattr(result, "truncated", False)),
                    "truncation_reasons": list(getattr(result, "truncation_reasons", [])),
                    "edges_scanned": int(getattr(result, "edges_scanned", 0)),
                    "search_steps": int(getattr(result, "search_steps", 0)),
                    "execution_time_ms": round((time.perf_counter() - started) * 1000, 2),
                }
            except Exception as error:
                # An isolated detector failure must not prevent other detectors from completing.
                errors[pattern] = str(error)
                detectors_failed.append(pattern)
                detector_reports[pattern] = {
                    "count": 0,
                    "truncated": True,
                    "truncation_reasons": ["detector_error"],
                    "execution_time_ms": round((time.perf_counter() - started) * 1000, 2),
                }

        # Step C: Case building and idempotent memory persistence
        try:
            account_ids = {str(account) for hit in all_hits for account in hit.get("account_ids", [])}
            account_types.update(load_account_types(account_ids, db=db, graph_name=graph_name))
            built = build_cases(all_hits, account_types=account_types)
            saved_count = persist_cases(built["cases"], db=db, graph_name=memory_graph)

            # Determine overall outcome status
            is_partial = bool(errors) or any(report.get("truncated") for report in detector_reports.values())
            overall_status = "partial" if is_partial else "complete"

            error_summary = None
            if errors:
                error_summary = f"{len(errors)} detector(s) failed: {', '.join(errors.keys())}"

            duration_ms = round((time.perf_counter() - t_start) * 1000, 2)
            finish_iso = _iso_now()

            scan_result = {
                "scan_id": scan_id,
                "trigger": trigger,
                "status": overall_status,
                "graph": graph_name,
                "finished_at": finish_iso,
                "duration_ms": duration_ms,
                "effective_window_start": effective_window_start,
                "effective_window_end": effective_window_end,
                "detectors_completed": detectors_completed,
                "detectors_failed": detectors_failed,
                "detector_reports": detector_reports,
                "detector_errors": errors,
                "error_summary": error_summary,
                "hits_found": len(all_hits),
                "hit_count": len(all_hits),
                "cases_created_or_updated": saved_count,
                "case_count": saved_count,
                "skipped_non_case_generating_hit_ids": built["non_case_generating_hit_ids"],
                "skipped_oversized_hit_ids": built["skipped_oversized_hit_ids"],
                "limitations": ["Priority score is a heuristic triage value, not a fraud probability."],
            }
        except Exception as error:
            duration_ms = round((time.perf_counter() - t_start) * 1000, 2)
            finish_iso = _iso_now()
            scan_result = {
                "scan_id": scan_id,
                "trigger": trigger,
                "status": "failed",
                "graph": graph_name,
                "finished_at": finish_iso,
                "duration_ms": duration_ms,
                "effective_window_start": effective_window_start,
                "effective_window_end": effective_window_end,
                "detectors_completed": detectors_completed,
                "detectors_failed": detectors_failed,
                "detector_reports": detector_reports,
                "detector_errors": {**errors, "case_build": str(error)},
                "error_summary": f"Case build/persistence failed: {error}",
                "hits_found": len(all_hits),
                "hit_count": len(all_hits),
                "cases_created_or_updated": 0,
                "case_count": 0,
            }

        with _jobs_lock:
            job = _jobs.get(scan_id)
            if job:
                job.update(scan_result)

    finally:
        # Guarantee lock release and active ID clearance under all conditions
        try:
            with _active_scan_id_lock:
                _active_scan_id = None
        finally:
            _scan_execution_lock.release()


def execute_scan(
    db: FalkorDBClient,
    graph_name: str = "txn",
    memory_graph: str = "memory",
    trigger: str = "scheduled",
    lookback_seconds: Optional[int] = None,
) -> str:
    """Coordinate and execute a full scan pass synchronously, returning scan_id."""
    scan_id = create_scan_job(trigger=trigger)
    run_scan(
        scan_id=scan_id,
        db=db,
        graph_name=graph_name,
        memory_graph=memory_graph,
        lookback_seconds=lookback_seconds,
        trigger=trigger,
    )
    return scan_id
