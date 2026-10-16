"""Single Member A detector registry and background scan coordinator."""
import threading
import time
import uuid
from typing import Any, Dict, Optional

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


# This is the only detector registration list the scan process uses.
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


def create_scan_job() -> str:
    scan_id = f"SCAN_{uuid.uuid4().hex[:12]}"
    with _jobs_lock:
        _jobs[scan_id] = {"scan_id": scan_id, "status": "running", "created_at": time.time()}
        completed = [key for key, value in _jobs.items() if value["status"] in {"complete", "partial", "failed"}]
        for key in completed[:-100]:
            _jobs.pop(key, None)
    return scan_id


def get_scan_job(scan_id: str) -> Optional[Dict[str, Any]]:
    with _jobs_lock:
        job = _jobs.get(scan_id)
        return dict(job) if job else None


def run_scan(scan_id: str, db: FalkorDBClient, graph_name: str = "txn", memory_graph: str = "memory") -> None:
    with _jobs_lock:
        job = _jobs.get(scan_id)
        if not job:
            return
        job["status"] = "running"
        job["started_at"] = time.time()
    detector_reports: Dict[str, Any] = {}
    all_hits = []
    errors = {}
    try:
        edge_snapshot = read_pattern_edges(db, graph_name, 250_000)
        snapshot_account_ids = {edge["src"] for edge in edge_snapshot[0]} | {edge["dst"] for edge in edge_snapshot[0]}
        account_types = load_account_types(snapshot_account_ids, db=db, graph_name=graph_name)
    except Exception as error:
        with _jobs_lock:
            _jobs[scan_id].update({"status": "failed", "detector_errors": {"edge_snapshot": str(error)}, "finished_at": time.time()})
        return
    for pattern, detector in DETECTOR_REGISTRY:
        started = time.perf_counter()
        try:
            detector_args = {"limit": 200, "graph_name": graph_name, "db": db, "edge_snapshot": edge_snapshot}
            if pattern in {"fan_in", "fan_out"}:
                detector_args["account_types"] = account_types
            result = detector(**detector_args)
            hits = list(result)
            if pattern == "cycle" and hits and "cycle_id" in hits[0]:
                hits = [{
                    "hit_id": item["cycle_id"], "pattern": "cycle",
                    "account_ids": item["accounts"],
                    "account_roles": {account: ("origin" if index == 0 else "intermediary")
                                      for index, account in enumerate(item["accounts"])},
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
            detector_reports[pattern] = {
                "count": len(hits),
                "suspicious_count": sum(bool(hit.get("measurements", {}).get("suspicious")) for hit in hits),
                "truncated": bool(getattr(result, "truncated", False)),
                "truncation_reasons": list(getattr(result, "truncation_reasons", [])),
                "edges_scanned": int(getattr(result, "edges_scanned", 0)),
                "search_steps": int(getattr(result, "search_steps", 0)),
                "execution_time_ms": round((time.perf_counter() - started) * 1000, 2),
            }
        except Exception as error:  # A single detector failure should not hide evidence from the others.
            errors[pattern] = str(error)
            detector_reports[pattern] = {"count": 0, "truncated": True, "truncation_reasons": ["detector_error"],
                                         "execution_time_ms": round((time.perf_counter() - started) * 1000, 2)}
    try:
        account_ids = {str(account) for hit in all_hits for account in hit.get("account_ids", [])}
        account_types.update(load_account_types(account_ids, db=db, graph_name=graph_name))
        built = build_cases(all_hits, account_types=account_types)
        saved_count = persist_cases(built["cases"], db=db, graph_name=memory_graph)
        status = "partial" if errors or any(report.get("truncated") for report in detector_reports.values()) else "complete"
        result = {
            "scan_id": scan_id, "status": status, "graph": graph_name,
            "detector_reports": detector_reports, "detector_errors": errors,
            "hit_count": len(all_hits), "case_count": saved_count,
            "skipped_non_case_generating_hit_ids": built["non_case_generating_hit_ids"],
            "skipped_oversized_hit_ids": built["skipped_oversized_hit_ids"],
            "limitations": ["Priority score is a heuristic triage value, not a fraud probability."],
        }
    except Exception as error:
        result = {"scan_id": scan_id, "status": "failed", "detector_reports": detector_reports,
                  "detector_errors": {**errors, "case_build": str(error)}}
    with _jobs_lock:
        job = _jobs.get(scan_id)
        if job:
            job.update(result)
            job["finished_at"] = time.time()
