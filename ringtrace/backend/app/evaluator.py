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
except ImportError:
    from backend.app.db import FalkorDBClient
    from backend.app.detectors.cycle import detect_cycles

DEFAULT_DATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "sim"
)


def load_ground_truth(data_dir: str = DEFAULT_DATA_DIR, client: Optional[FalkorDBClient] = None) -> List[Dict[str, Any]]:
    """Load ground-truth cycle alerts from CSVs, falling back to the 'labels' graph."""
    alerts_file = os.path.join(data_dir, "alerts.csv")
    accounts_file = os.path.join(data_dir, "alert_accounts.csv")
    txs_file = os.path.join(data_dir, "alert_transactions.csv")

    if os.path.exists(alerts_file) and os.path.exists(accounts_file) and os.path.exists(txs_file):
        with open(alerts_file, newline="", encoding="utf-8") as f:
            all_alerts = list(csv.DictReader(f))
        cycle_alerts = [a for a in all_alerts if a["pattern"] == "cycle"]

        members: Dict[str, Set[str]] = {}
        with open(accounts_file, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                members.setdefault(r["alert_id"], set()).add(r["account_id"])

        alert_txs: Dict[str, Set[str]] = {}
        with open(txs_file, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                alert_txs.setdefault(r["alert_id"], set()).add(r["tx_id"])

        ground_truth = []
        for a in cycle_alerts:
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

    # Fallback: Query 'labels' graph in FalkorDB
    c = client or FalkorDBClient()
    gt_res = c.execute_query(
        "labels",
        "MATCH (al:LabelAlert) WHERE al.pattern = 'cycle' "
        "OPTIONAL MATCH (al)-[:HAS_ACCOUNT]->(la:LabelAccount) "
        "RETURN al.id, al.kind, al.is_fraud, al.tx_ids, collect(la.id)",
        caller="evaluator:load_ground_truth_from_graph",
    )
    ground_truth = []
    if gt_res and gt_res.result_set:
        for r in gt_res.result_set:
            tx_ids = r[3]
            if isinstance(tx_ids, str):
                try:
                    tx_ids = json.loads(tx_ids.replace("'", '"'))
                except Exception:
                    tx_ids = []
            ground_truth.append({
                "alert_id": r[0],
                "pattern": "cycle",
                "kind": r[1],
                "is_fraud": bool(r[2]),
                "tx_ids": set(tx_ids),
                "accounts": set(r[4]),
                "length": len(tx_ids),
            })
    return ground_truth


def evaluate_cycle_detector(
    data_dir: str = DEFAULT_DATA_DIR,
    sample_limit: int = 50,
    graph_name: str = "txn",
    db: Optional[FalkorDBClient] = None,
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
    )
    duration_ms = round((time.time() - t0) * 1000, 2)
    candidates = list(candidates_result)

    # 3. Perform Metric Matching
    exact_matches: List[Dict[str, Any]] = []
    partial_matches: List[Dict[str, Any]] = []
    unmatched_planted: List[Dict[str, Any]] = []

    matched_candidate_ids: Set[str] = set()

    for alert in fraud_gt:
        aid = alert["alert_id"]
        gt_accs = alert["accounts"]
        gt_txs = alert["tx_ids"]

        exact_cand = None
        partial_cand = None

        for c in candidates:
            c_accs = set(c["accounts"])
            c_txs = {t["tx_id"] for t in c["transactions"]}

            # Exact matching rule: same account set and same transaction set
            if c_accs == gt_accs and c_txs == gt_txs:
                exact_cand = c
                matched_candidate_ids.add(c["cycle_id"])
                break
            # Partial matching rule: >= 60% account overlap
            elif len(c_accs & gt_accs) / max(1, len(gt_accs)) >= 0.6:
                if partial_cand is None:
                    partial_cand = c

        if exact_cand:
            exact_matches.append({
                "alert_id": aid,
                "candidate_id": exact_cand["cycle_id"],
                "accounts": list(gt_accs),
                "length": alert["length"],
            })
        elif partial_cand:
            matched_candidate_ids.add(partial_cand["cycle_id"])
            overlap_pct = round(
                (len(set(partial_cand["accounts"]) & gt_accs) / len(gt_accs)) * 100, 1
            )
            partial_matches.append({
                "alert_id": aid,
                "candidate_id": partial_cand["cycle_id"],
                "accounts": list(gt_accs),
                "overlap_pct": overlap_pct,
                "length": alert["length"],
            })
        else:
            reason = "result_limit_exceeded" if candidates_result.truncated else "pruned_by_detector_constraints"
            unmatched_planted.append({
                "alert_id": aid,
                "reason": reason,
                "length": alert["length"],
                "accounts": list(gt_accs),
            })

    # 4. Check False Positives against Benign Look-Alikes
    benign_false_positives: Dict[str, int] = {}
    for c in candidates:
        c_accs = set(c["accounts"])
        for b_alert in benign_gt:
            b_accs = b_alert["accounts"]
            if len(c_accs & b_accs) / max(1, len(b_accs)) >= 0.6:
                kind = b_alert["kind"]
                benign_false_positives[kind] = benign_false_positives.get(kind, 0) + 1
                matched_candidate_ids.add(c["cycle_id"])

    # 5. Identify Unlabeled Candidates (Genuine structural cycles not in planted ground truth)
    unlabeled_count = max(0, len(candidates) - len(matched_candidate_ids))

    # 6. Compute Rates
    n_planted = len(fraud_gt)
    n_returned = len(candidates)
    n_exact = len(exact_matches)
    n_partial = len(partial_matches)

    exact_recall = round(n_exact / max(1, n_planted), 4)
    total_recall = round((n_exact + n_partial) / max(1, n_planted), 4)
    precision = round((n_exact + n_partial) / max(1, n_returned), 4) if n_returned > 0 else 0.0

    return {
        "status": "success",
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
            "unlabeled_candidates_count": unlabeled_count,
        },
        "metrics": {
            "exact_recall": exact_recall,
            "total_recall": total_recall,
            "precision": precision,
        },
        "matching_rules_documentation": {
            "exact_match": "Candidate has identical account set AND identical transaction set to planted alert.",
            "partial_match": "Candidate covers >= 60% of planted accounts (reported separately from exact).",
            "unlabeled_candidates": "Genuine graph cycles not matching planted ground truth; not automatically errors.",
        },
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
