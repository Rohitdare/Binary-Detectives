"""Independent evaluation module for RingTrace Cycle Detection.

Evaluates cycle detection performance against ground-truth labels.
CRITICAL HARD CONSTRAINT:
- This evaluation module is run strictly on demand (via CLI or /api/evaluate/cycles).
- Detection code (app/detectors/cycle.py) NEVER calls or imports this module,
  and NEVER reads ground truth (labels graph, alerts.csv, etc.).

Matching Rule:
- EXACT MATCH: Candidate has the exact same account set AND exact same transaction set
  as the planted alert.
- PARTIAL MATCH: Candidate is not an exact match, but covers >= 60% of the planted accounts.
  Reported separately; never conflated with exact recovery.
- BENIGN OVERLAP: Candidate overlaps a benign look-alike alert (e.g., slow_family_cycle, unordered_cycle).
- UNLABELED CANDIDATES: Extra genuine structural cycles that do not overlap planted alerts.
  These are legitimate graph discoveries, not automatically errors.
"""
import argparse
import csv
import json
import os
import sys
import time
from typing import Any, Dict, List, Optional, Set

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

try:
    from app.db import FalkorDBClient
    from app.detectors.cycle import detect_cycles
    from app.detectors.fan_in import detect_fan_in
    from app.detectors.fan_out import detect_fan_out
    from app.detectors.gather_scatter import detect_gather_scatter
    from app.detectors.bipartite import detect_bipartite
    from app.detectors.dense_cluster import detect_dense_clusters
    from app.detectors.hub_account import detect_hub_accounts
    from app.detectors.relay_chain import detect_relay_chains
    from app.detectors.scatter_gather import detect_scatter_gather
    from app.detectors.graph_pattern_utils import read_pattern_edges
    from app.queries import GET_LABEL_ALERTS_BY_PATTERN
except ImportError:
    from backend.app.db import FalkorDBClient
    from backend.app.detectors.cycle import detect_cycles
    from backend.app.detectors.fan_in import detect_fan_in
    from backend.app.detectors.fan_out import detect_fan_out
    from backend.app.detectors.gather_scatter import detect_gather_scatter
    from backend.app.detectors.bipartite import detect_bipartite
    from backend.app.detectors.dense_cluster import detect_dense_clusters
    from backend.app.detectors.hub_account import detect_hub_accounts
    from backend.app.detectors.relay_chain import detect_relay_chains
    from backend.app.detectors.scatter_gather import detect_scatter_gather
    from backend.app.detectors.graph_pattern_utils import read_pattern_edges
    from backend.app.queries import GET_LABEL_ALERTS_BY_PATTERN

DEFAULT_DATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "sim"
)


def load_ground_truth(
    data_dir: str = DEFAULT_DATA_DIR,
    client: Optional[FalkorDBClient] = None,
    pattern: str = "cycle",
) -> List[Dict[str, Any]]:
    """Load one pattern's ground truth from CSVs or the labels graph."""
    alerts_file = os.path.join(data_dir, "alerts.csv")
    accounts_file = os.path.join(data_dir, "alert_accounts.csv")
    txs_file = os.path.join(data_dir, "alert_transactions.csv")

    if os.path.exists(alerts_file) and os.path.exists(accounts_file) and os.path.exists(txs_file):
        with open(alerts_file, newline="", encoding="utf-8") as f:
            all_alerts = list(csv.DictReader(f))
        pattern_alerts = [a for a in all_alerts if a["pattern"] == pattern]

        members: Dict[str, Set[str]] = {}
        with open(accounts_file, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                members.setdefault(r["alert_id"], set()).add(r["account_id"])

        alert_txs: Dict[str, Set[str]] = {}
        with open(txs_file, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                alert_txs.setdefault(r["alert_id"], set()).add(r["tx_id"])

        ground_truth = []
        for a in pattern_alerts:
            aid = a["alert_id"]
            ground_truth.append({
                "alert_id": aid,
                "pattern": a["pattern"],
                "kind": a["kind"],
                "is_fraud": a["is_fraud"].strip().lower() == "true",
                "accounts": members.get(aid, set()),
                "tx_ids": alert_txs.get(aid, set()),
                "length": int(a.get("n_accounts", len(members.get(aid, set())))),
                "start_ts": a.get("start_ts"),
                "end_ts": a.get("end_ts"),
            })
        return ground_truth

    # Ground truth is intentionally isolated in this evaluation-only module.
    c = client or FalkorDBClient()
    gt_res = c.execute_query(
        "labels",
        GET_LABEL_ALERTS_BY_PATTERN,
        {"pattern": pattern},
        caller="evaluator:load_ground_truth_from_graph",
    )
    ground_truth = []
    if gt_res and gt_res.result_set:
        for r in gt_res.result_set:
            tx_ids = r[4]
            if isinstance(tx_ids, str):
                try:
                    tx_ids = json.loads(tx_ids.replace("'", '"'))
                except Exception:
                    tx_ids = []
            ground_truth.append({
                "alert_id": r[0],
                "pattern": r[1],
                "kind": r[2],
                "is_fraud": r[3].strip().lower() == "true" if isinstance(r[3], str) else bool(r[3]),
                "tx_ids": set(tx_ids),
                "accounts": set(r[5]),
                "length": len(tx_ids),
            })
    return ground_truth


def evaluate_cycle_detector(
    data_dir: str = DEFAULT_DATA_DIR,
    sample_limit: int = 50,
    graph_name: str = "txn",
    db: Optional[FalkorDBClient] = None,
    edge_snapshot: Optional[Any] = None,
) -> Dict[str, Any]:
    """Run an independent evaluation pass against ground-truth labels.

    Matching Rules (Strictly Defined):
    - Exact match: Same account set AND same transaction set.
    - Partial match: Non-exact match covering >= 60% of the planted account set.
    - Benign overlap: Candidate overlapping a planted benign look-alike alert.
    - Unlabeled candidates: Legitimate cycle candidates discovered in graph that
      do not match any planted alert.

    Args:
        data_dir: Directory containing ground truth CSV files.
        sample_limit: Result limit configured for the detector run.
        graph_name: FalkorDB graph to evaluate (default: 'txn').
        db: Optional existing FalkorDBClient.

    Returns:
        Structured evaluation metrics report dictionary.
    """
    client = db or FalkorDBClient()
    edge_snapshot = edge_snapshot or read_pattern_edges(client, graph_name, 250_000)

    # 1. Load Ground Truth
    ground_truth = load_ground_truth(data_dir, client=client)
    fraud_gt = [g for g in ground_truth if g["is_fraud"]]
    benign_gt = [g for g in ground_truth if not g["is_fraud"]]

    # 2. Run Cycle Detector
    t0 = time.time()
    candidates_result = detect_cycles(
        min_length=3,
        max_length=5,
        limit=sample_limit,
        graph_name=graph_name,
        db=client,
        edge_snapshot=edge_snapshot,
    )
    duration_ms = round((time.time() - t0) * 1000, 2)
    candidates = list(candidates_result)

    # 3. Match detections one-to-one with exact transaction and account evidence.
    # Partial account overlap remains diagnostic and never counts as a true positive.
    exact_matches: List[Dict[str, Any]] = []
    partial_matches: List[Dict[str, Any]] = []
    unmatched_planted: List[Dict[str, Any]] = []
    matched_candidate_ids: Set[str] = set()
    matched_fraud_ids: Set[str] = set()
    matched_suspicious_fraud_ids: Set[str] = set()
    matched_benign_ids: Set[str] = set()
    candidate_evidence = [
        (candidate, set(candidate.get("accounts", [])),
         {tx.get("tx_id") for tx in candidate.get("transactions", []) if tx.get("tx_id")})
        for candidate in candidates
    ]

    for candidate, account_ids, tx_ids in candidate_evidence:
        fraud = next((alert for alert in fraud_gt
            if alert["alert_id"] not in matched_fraud_ids
            and account_ids == alert["accounts"] and tx_ids == alert["tx_ids"]), None)
        if fraud is not None:
            matched_fraud_ids.add(fraud["alert_id"])
            matched_candidate_ids.add(candidate["cycle_id"])
            exact_matches.append({
                "alert_id": fraud["alert_id"],
                "candidate_id": candidate["cycle_id"],
                "accounts": sorted(fraud["accounts"]),
                "length": fraud["length"],
                "suspicious": bool(candidate.get("suspicious", False)),
            })
            if candidate.get("suspicious", False):
                matched_suspicious_fraud_ids.add(fraud["alert_id"])
            continue

        benign = next((alert for alert in benign_gt
            if alert["alert_id"] not in matched_benign_ids
            and account_ids == alert["accounts"] and tx_ids == alert["tx_ids"]), None)
        if benign is not None:
            matched_benign_ids.add(benign["alert_id"])
            matched_candidate_ids.add(candidate["cycle_id"])

    for alert in fraud_gt:
        if alert["alert_id"] in matched_suspicious_fraud_ids:
            continue
        structurally_matched = alert["alert_id"] in matched_fraud_ids
        partial_candidate = next((candidate for candidate, account_ids, _ in candidate_evidence
            if len(account_ids & alert["accounts"]) / max(1, len(alert["accounts"])) >= 0.6), None)
        if partial_candidate is not None and not structurally_matched:
            overlap = len(set(partial_candidate["accounts"]) & alert["accounts"])
            partial_matches.append({
                "alert_id": alert["alert_id"],
                "candidate_id": partial_candidate["cycle_id"],
                "accounts": sorted(alert["accounts"]),
                "overlap_pct": round(overlap / max(1, len(alert["accounts"])) * 100, 1),
                "length": alert["length"],
                "counts_as_true_positive": False,
            })
        unmatched_planted.append({
            "alert_id": alert["alert_id"],
            "reason": "structural_candidate_not_suspicious" if structurally_matched
                else candidates_result.truncation_reason or "not_detected",
            "length": alert["length"],
            "accounts": sorted(alert["accounts"]),
        })

    # Explicit benign scenario hits are labelled false positives only when the
    # candidate is marked suspicious. Unmatched background candidates are unknown.
    benign_false_positives: Dict[str, int] = {}
    for alert in benign_gt:
        if alert["alert_id"] not in matched_benign_ids:
            continue
        suspicious_match = any(
            candidate.get("suspicious", False)
            and accounts == alert["accounts"] and tx_ids == alert["tx_ids"]
            for candidate, accounts, tx_ids in candidate_evidence
        )
        if suspicious_match:
            benign_false_positives[alert["kind"]] = benign_false_positives.get(alert["kind"], 0) + 1

    benign_overlap_pairs: Set[tuple[str, str]] = set()
    for candidate, account_ids, tx_ids in candidate_evidence:
        if not candidate.get("suspicious", False):
            continue
        for alert in benign_gt:
            if account_ids == alert["accounts"] and tx_ids == alert["tx_ids"]:
                continue
            overlap = len(account_ids & alert["accounts"]) / max(1, len(alert["accounts"]))
            if overlap >= 0.6:
                benign_overlap_pairs.add((candidate["cycle_id"], alert["alert_id"]))
    benign_overlap_diagnostics: Dict[str, int] = {}
    for candidate_id, alert_id in benign_overlap_pairs:
        kind = next(alert["kind"] for alert in benign_gt if alert["alert_id"] == alert_id)
        benign_overlap_diagnostics[kind] = benign_overlap_diagnostics.get(kind, 0) + 1

    unlabeled_count = max(0, len(candidates) - len(matched_candidate_ids))
    unknown_suspicious_count = sum(
        1 for candidate in candidates
        if candidate.get("suspicious", False) and candidate["cycle_id"] not in matched_candidate_ids
    )
    n_tp = sum(1 for match in exact_matches if match["suspicious"])
    n_fp = sum(benign_false_positives.values())
    n_fn = max(0, len(fraud_gt) - n_tp)
    n_tn = max(0, len(benign_gt) - n_fp)
    precision = round(n_tp / (n_tp + n_fp), 4) if n_tp + n_fp else 0.0
    recall = round(n_tp / (n_tp + n_fn), 4) if n_tp + n_fn else 0.0
    f1 = round(2 * precision * recall / (precision + recall), 4) if precision + recall else 0.0
    false_positive_rate = round(n_fp / (n_fp + n_tn), 4) if n_fp + n_tn else 0.0
    false_negative_rate = round(n_fn / (n_fn + n_tp), 4) if n_fn + n_tp else 0.0
    exact_structural_recall = round(len(exact_matches) / max(1, len(fraud_gt)), 4)
    n_planted = len(fraud_gt)
    n_returned = len(candidates)
    n_exact = len(exact_matches)
    n_partial = len(partial_matches)

    return {
        "status": "partial" if candidates_result.truncated else "success",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "evaluation_config": {
            "graph": graph_name,
            "configured_limit": sample_limit,
            "data_source": data_dir,
            "execution_time_ms": duration_ms,
        },
        "ground_truth_summary": {
            "planted_fraud_cycle_alerts": n_planted,
            "planted_benign_look_alikes": len(benign_gt),
            "benign_breakdown": {
                "slow_family_cycle": len([b for b in benign_gt if b["kind"] == "slow_family_cycle"]),
                "unordered_cycle": len([b for b in benign_gt if b["kind"] == "unordered_cycle"]),
            },
        },
        "detection_summary": {
            "candidates_returned": n_returned,
            "truncated": candidates_result.truncated,
            "truncation_reason": candidates_result.truncation_reason,
        },
        "matching_results": {
            "exact_matches_count": n_exact,
            "exact_matches": exact_matches,
            "partial_matches_count": n_partial,
            "partial_matches": partial_matches,
            "unmatched_planted_count": len(unmatched_planted),
            "unmatched_planted_alerts": unmatched_planted,
            "benign_false_positives": benign_false_positives,
            "benign_overlap_diagnostics_not_counted_as_false_positives": benign_overlap_diagnostics,
            "unlabeled_candidates_count": unlabeled_count,
            "unlabeled_suspicious_candidates_count": unknown_suspicious_count,
        },
        "metrics": {
            "true_positives": n_tp,
            "false_positives_on_labeled_benign_scenarios": n_fp,
            "false_negatives": n_fn,
            "true_negatives_on_labeled_benign_scenarios": n_tn,
            "precision_on_labeled_scenarios": precision,
            "recall": recall,
            "f1": f1,
            "false_positive_rate_on_labeled_benign_scenarios": false_positive_rate,
            "false_negative_rate": false_negative_rate,
            "exact_structural_recall": exact_structural_recall,
            "partial_overlap_count_not_included": len(partial_matches),
            "unknown_suspicious_candidates_excluded_from_precision": unknown_suspicious_count,
            "exact_recall": round(n_tp / max(1, len(fraud_gt)), 4),
            "total_recall": recall,
            "precision": precision,
        },
        "limitations": [
            "Metrics cover exact matches to explicitly labelled planted scenarios only; unmatched background detections have unknown labels.",
            "This dataset does not provide separate validation and final evaluation splits, so no threshold calibration or held-out accuracy claim is made.",
            "These synthetic scenario metrics are not real-world financial crime accuracy.",
        ],
        "matching_rules_documentation": {
            "exact_match": "Candidate has identical account set AND identical transaction set to planted alert.",
            "partial_match": "Candidate covers >= 60% of planted accounts; diagnostic only and excluded from precision/recall.",
            "unlabeled_candidates": "Genuine graph cycles not matching planted ground truth; not automatically errors.",
            "metrics_scope": "Metrics cover exact matches to labelled planted scenarios only. Unknown background candidates are excluded; these values are not deployment accuracy.",
        },
    }


def evaluate_fan_detectors(
    data_dir: str = DEFAULT_DATA_DIR,
    sample_limit: int = 50,
    graph_name: str = "txn",
    db: Optional[FalkorDBClient] = None,
    edge_snapshot: Optional[Any] = None,
) -> Dict[str, Any]:
    """Evaluate fan-in and fan-out against exact, labelled planted scenarios.

    This evaluator never tunes detector thresholds. Unmatched background hits are
    reported as unknown because the simulator does not label all normal activity.
    """
    if sample_limit < 1 or sample_limit > 200:
        raise ValueError("sample_limit must be between 1 and 200")

    client = db or FalkorDBClient()
    edge_snapshot = edge_snapshot or read_pattern_edges(client, graph_name, 250_000)
    reports: Dict[str, Any] = {}
    for pattern, detector in (("fan_in", detect_fan_in), ("fan_out", detect_fan_out)):
        started_at = time.perf_counter()
        ground_truth = load_ground_truth(data_dir, client=client, pattern=pattern)
        fraud = [alert for alert in ground_truth if alert["is_fraud"]]
        benign = [alert for alert in ground_truth if not alert["is_fraud"]]
        result = detector(limit=sample_limit, graph_name=graph_name, db=client,
                          edge_snapshot=edge_snapshot)
        candidates = list(result)

        matched_candidates: Set[str] = set()
        matched_fraud: Set[str] = set()
        matched_suspicious_fraud: Set[str] = set()
        matched_benign: Set[str] = set()
        benign_false_positives: Dict[str, int] = {}
        benign_overlap_pairs: Set[tuple[str, str]] = set()
        structural_matches = 0

        evidence = []
        for hit in candidates:
            measurements = hit.get("measurements", {})
            evidence.append((
                hit,
                str(hit.get("hit_id", "")),
                set(hit.get("account_ids", [])),
                set(hit.get("tx_ids", [])) or {
                    tx.get("tx_id") for tx in hit.get("transactions", []) if tx.get("tx_id")
                },
                bool(measurements.get("suspicious", False))
                and not bool(measurements.get("suspicion_indeterminate", False)),
            ))

        for hit, hit_id, account_ids, tx_ids, suspicious in evidence:
            alert = next((item for item in fraud
                if item["alert_id"] not in matched_fraud
                and account_ids == item["accounts"] and tx_ids == item["tx_ids"]), None)
            if alert is not None:
                matched_fraud.add(alert["alert_id"])
                matched_candidates.add(hit_id)
                structural_matches += 1
                if suspicious:
                    matched_suspicious_fraud.add(alert["alert_id"])
                continue

            alert = next((item for item in benign
                if item["alert_id"] not in matched_benign
                and account_ids == item["accounts"] and tx_ids == item["tx_ids"]), None)
            if alert is not None:
                matched_benign.add(alert["alert_id"])
                matched_candidates.add(hit_id)
                if suspicious:
                    benign_false_positives[alert["kind"]] = benign_false_positives.get(alert["kind"], 0) + 1

            if suspicious:
                for benign_alert in benign:
                    if account_ids == benign_alert["accounts"] and tx_ids == benign_alert["tx_ids"]:
                        continue
                    if len(account_ids & benign_alert["accounts"]) / max(1, len(benign_alert["accounts"])) >= 0.6:
                        benign_overlap_pairs.add((hit_id, benign_alert["alert_id"]))

        tp = len(matched_suspicious_fraud)
        fp = sum(benign_false_positives.values())
        fn = max(0, len(fraud) - tp)
        tn = max(0, len(benign) - fp)
        precision = round(tp / (tp + fp), 4) if tp + fp else 0.0
        recall = round(tp / (tp + fn), 4) if tp + fn else 0.0
        f1 = round(2 * precision * recall / (precision + recall), 4) if precision + recall else 0.0
        false_positive_rate = round(fp / (fp + tn), 4) if fp + tn else 0.0
        false_negative_rate = round(fn / (fn + tp), 4) if fn + tp else 0.0
        unknown_suspicious = sum(
            1 for _, hit_id, _, _, suspicious in evidence if suspicious and hit_id not in matched_candidates
        )
        benign_overlap_diagnostics: Dict[str, int] = {}
        for _, alert_id in benign_overlap_pairs:
            kind = next(alert["kind"] for alert in benign if alert["alert_id"] == alert_id)
            benign_overlap_diagnostics[kind] = benign_overlap_diagnostics.get(kind, 0) + 1
        reports[pattern] = {
            "status": "partial" if result.truncated else "success",
            "planted_fraud_scenarios": len(fraud),
            "planted_benign_scenarios": len(benign),
            "candidate_count": len(candidates),
            "suspicious_count": sum(1 for _, _, _, _, suspicious in evidence if suspicious),
            "truncated": result.truncated,
            "truncation_reason": result.truncation_reason,
            "truncation_reasons": result.truncation_reasons,
            "execution_time_ms": round((time.perf_counter() - started_at) * 1000, 2),
            "exact_structural_matches": structural_matches,
            "false_positives_by_benign_kind": benign_false_positives,
            "benign_overlap_diagnostics_not_counted_as_false_positives": benign_overlap_diagnostics,
            "unlabeled_suspicious_candidates_count": unknown_suspicious,
            "metrics": {
                "true_positives": tp,
                "false_positives_on_labeled_benign_scenarios": fp,
                "false_negatives": fn,
                "true_negatives_on_labeled_benign_scenarios": tn,
                "precision_on_labeled_scenarios": precision,
                "recall": recall,
                "f1": f1,
                "false_positive_rate_on_labeled_benign_scenarios": false_positive_rate,
                "false_negative_rate": false_negative_rate,
            },
        }

    return {
        "status": "partial" if any(item["status"] == "partial" for item in reports.values()) else "success",
        "graph": graph_name,
        "configured_limit": sample_limit,
        "data_source": data_dir,
        "patterns": reports,
        "limitations": [
            "Metrics require exact account and transaction evidence matches to count as labelled outcomes.",
            "Unmatched background hits have unknown labels and are excluded from precision.",
            "The current data has no separate validation and final evaluation splits; these synthetic results are not real-world accuracy.",
        ],
    }


def evaluate_additional_graph_detectors(
    data_dir: str = DEFAULT_DATA_DIR,
    sample_limit: int = 50,
    graph_name: str = "txn",
    db: Optional[FalkorDBClient] = None,
    edge_snapshot: Optional[Any] = None,
) -> Dict[str, Any]:
    """Evaluate relay, scatter-gather, and gather-scatter against labels.

    Exact account and transaction evidence must match. Each label and each hit
    can be matched once. Unmatched hits remain unknown because background graph
    activity is not comprehensively labelled.
    """
    if sample_limit < 1 or sample_limit > 200:
        raise ValueError("sample_limit must be between 1 and 200")
    client = db or FalkorDBClient()
    edge_snapshot = edge_snapshot or read_pattern_edges(client, graph_name, 250_000)
    detector_specs = (
        ("relay_chain", detect_relay_chains),
        ("scatter_gather", detect_scatter_gather),
        ("gather_scatter", detect_gather_scatter),
        ("bipartite", detect_bipartite),
        ("dense_cluster", detect_dense_clusters),
        ("hub_account", detect_hub_accounts),
    )
    reports: Dict[str, Any] = {}
    evidence_by_pattern: Dict[str, List[Dict[str, Any]]] = {}
    for pattern, detector in detector_specs:
        started_at = time.perf_counter()
        ground_truth = load_ground_truth(data_dir, client=client, pattern=pattern)
        fraud = [alert for alert in ground_truth if alert["is_fraud"]]
        benign = [alert for alert in ground_truth if not alert["is_fraud"]]
        result = detector(limit=sample_limit, graph_name=graph_name, db=client,
                          edge_snapshot=edge_snapshot)
        evidence = []
        for hit in result:
            measurements = hit.get("measurements", {})
            evidence.append({
                "hit_id": str(hit.get("hit_id", "")),
                "accounts": set(hit.get("account_ids", [])),
                "tx_ids": set(hit.get("tx_ids", [])) or {
                    tx.get("tx_id") for tx in hit.get("transactions", []) if tx.get("tx_id")
                },
                "suspicious": bool(measurements.get("suspicious", False))
                and not bool(measurements.get("suspicion_indeterminate", False)),
            })
        evidence_by_pattern[pattern] = evidence

        matched_fraud: Set[str] = set()
        matched_fraud_candidates: Dict[str, Dict[str, Any]] = {}
        matched_benign: Set[str] = set()
        matched_hits: Set[str] = set()
        false_positives_by_kind: Dict[str, int] = {}
        structural_matches = 0
        for candidate in evidence:
            fraud_match = next((alert for alert in fraud
                if alert["alert_id"] not in matched_fraud
                and candidate["accounts"] == alert["accounts"]
                and candidate["tx_ids"] == alert["tx_ids"]), None)
            if fraud_match:
                matched_fraud.add(fraud_match["alert_id"])
                matched_fraud_candidates[fraud_match["alert_id"]] = candidate
                structural_matches += 1
                if candidate["suspicious"]:
                    matched_hits.add(candidate["hit_id"])
                continue
            benign_match = next((alert for alert in benign
                if alert["alert_id"] not in matched_benign
                and candidate["accounts"] == alert["accounts"]
                and candidate["tx_ids"] == alert["tx_ids"]), None)
            if benign_match:
                matched_benign.add(benign_match["alert_id"])
                matched_hits.add(candidate["hit_id"])
                if candidate["suspicious"]:
                    kind = benign_match["kind"]
                    false_positives_by_kind[kind] = false_positives_by_kind.get(kind, 0) + 1

        # A planted fraud is a TP only if its one-to-one matched candidate was suspicious.
        tp = sum(candidate["suspicious"] for candidate in matched_fraud_candidates.values())
        fp = sum(false_positives_by_kind.values())
        fn = len(fraud) - tp
        tn = max(0, len(benign) - fp)
        precision = round(tp / (tp + fp), 4) if tp + fp else 0.0
        recall = round(tp / (tp + fn), 4) if tp + fn else 0.0
        f1 = round(2 * precision * recall / (precision + recall), 4) if precision + recall else 0.0
        fpr = round(fp / (fp + tn), 4) if fp + tn else None
        unknown_suspicious = sum(1 for item in evidence if item["suspicious"] and item["hit_id"] not in matched_hits)
        reports[pattern] = {
            "status": "not_evaluable" if not ground_truth else "partial" if result.truncated else "success",
            "planted_fraud_scenarios": len(fraud),
            "planted_benign_scenarios": len(benign),
            "candidate_count": len(evidence),
            "structural_exact_matches": structural_matches,
            "suspicious_count": sum(item["suspicious"] for item in evidence),
            "unlabeled_suspicious_candidates_excluded_from_precision": unknown_suspicious,
            "false_positives_by_benign_kind": false_positives_by_kind,
            "truncated": result.truncated,
            "truncation_reasons": result.truncation_reasons,
            "edges_scanned": result.edges_scanned,
            "search_steps": result.search_steps,
            "execution_time_ms": round((time.perf_counter() - started_at) * 1000, 2),
            "metrics": {
                "true_positives": tp,
                "false_positives_on_labeled_benign_scenarios": fp,
                "false_negatives": fn,
                "true_negatives_on_labeled_benign_scenarios": tn,
                "precision_on_labeled_scenarios": precision,
                "recall": recall,
                "f1": f1,
                "false_positive_rate_on_labeled_benign_scenarios": fpr,
            },
        }

    overlaps = []
    patterns = list(evidence_by_pattern)
    for left_index, left_pattern in enumerate(patterns):
        for right_pattern in patterns[left_index + 1:]:
            for left in evidence_by_pattern[left_pattern]:
                if not left["suspicious"] or not left["tx_ids"]:
                    continue
                for right in evidence_by_pattern[right_pattern]:
                    if right["suspicious"] and right["tx_ids"]:
                        union = left["tx_ids"] | right["tx_ids"]
                        overlap = len(left["tx_ids"] & right["tx_ids"]) / max(1, len(union))
                        if overlap >= 0.8:
                            overlaps.append({
                                "patterns": [left_pattern, right_pattern],
                                "hit_ids": [left["hit_id"], right["hit_id"]],
                                "transaction_overlap_ratio": round(overlap, 4),
                                "counted_as_independent_pattern_matches": False,
                            })
    return {
        "status": "partial" if any(report["status"] == "partial" for report in reports.values()) else "success",
        "graph": graph_name,
        "configured_limit": sample_limit,
        "data_source": data_dir,
        "patterns": reports,
        "cross_pattern_evidence_overlaps": overlaps,
        "limitations": [
            "Only exact one-to-one account and transaction matches count as labeled outcomes.",
            "Unknown background candidates are excluded from precision because the graph is not fully labeled.",
            "Metrics are specific to synthetic planted scenarios and do not establish real-world accuracy.",
            "The dataset has no separate validation and final holdout split.",
        ],
    }


def main():
    p = argparse.ArgumentParser(description="Evaluate RingTrace cycle detector against ground truth.")
    p.add_argument("--data-dir", default=DEFAULT_DATA_DIR, help="Path to simulator output directory")
    p.add_argument("--limit", type=int, default=50, help="Candidate limit for detector pass")
    p.add_argument("--graph", default="txn", help="Graph name to detect against")
    args = p.parse_args()

    report = evaluate_cycle_detector(
        data_dir=args.data_dir,
        sample_limit=args.limit,
        graph_name=args.graph,
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
