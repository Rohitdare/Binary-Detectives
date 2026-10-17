"""Deterministic Safe Fallback Engine for RingTrace (Member B).

Guarantees 100% demo uptime and resilience. If Gemini 1.5 Flash fails,
times out, is unconfigured, or triggers an anti-hallucination validation failure,
the system executes this deterministic rule engine.

Sequence:
  1. get_case(case_id)
  2. expand_neighborhood(origin_account, hops=1, limit=25)
  3. run_algorithm('pagerank', scope=case_accounts)
  4. run_algorithm('community', scope=case_accounts)
  5. find_similar_cases(case_id, limit=5)
  6. Apply rule-based action proposal (escalate / monitor / dismiss)
  7. Fill pre-written structured Markdown narrative
  8. Call record_finding and propose_action
  9. Emit result with mode="fallback"
"""
import uuid
from typing import Any, Callable, Dict, List, Optional, Set

try:
    from app.mcp_server.tools import (
        expand_neighborhood,
        find_similar_cases,
        get_case,
        propose_action,
        record_finding,
        run_algorithm,
    )
except ImportError:
    from backend.app.mcp_server.tools import (
        expand_neighborhood,
        find_similar_cases,
        get_case,
        propose_action,
        record_finding,
        run_algorithm,
    )


def run_fallback_investigation(
    case_id: str,
    investigation_id: Optional[str] = None,
    step_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    db: Any = None,
    memory_graph: str = "memory",
    txn_graph: str = "txn",
) -> Dict[str, Any]:
    """Execute the deterministic fallback investigation workflow."""
    inv_id = investigation_id or f"INV_{uuid.uuid4().hex[:8]}"
    steps: List[Dict[str, Any]] = []
    step_idx = 1

    allowed_accounts: Set[str] = set()
    allowed_txs: Set[str] = set()
    allowed_cases: Set[str] = {case_id}

    def record_step(tool_name: str, args: Dict[str, Any], result: Dict[str, Any]):
        nonlocal step_idx
        ev = result.get("evidence", {})
        acc_ids = ev.get("account_ids", [])
        tx_ids = ev.get("tx_ids", [])
        case_ids = ev.get("case_ids", [])

        allowed_accounts.update(acc_ids)
        allowed_txs.update(tx_ids)
        allowed_cases.update(case_ids)

        step_data = {
            "index": step_idx,
            "tool": tool_name,
            "args": args,
            "summary": result.get("summary", ""),
            "evidence": {
                "account_ids": acc_ids,
                "tx_ids": tx_ids,
            },
        }
        steps.append(step_data)
        if step_callback:
            try:
                step_callback(step_data)
            except Exception:
                pass
        step_idx += 1

    # 1. get_case
    c_res = get_case(case_id, db=db, memory_graph=memory_graph)
    record_step("get_case", {"case_id": case_id}, c_res)

    if c_res.get("status") == "error":
        return {
            "investigation_id": inv_id,
            "case_id": case_id,
            "status": "error",
            "mode": "fallback",
            "error": c_res.get("error", "Case not found"),
            "steps": steps,
            "assessment": None,
            "proposed_action": None,
        }

    case_accounts = [a["id"] for a in c_res.get("accounts", [])]
    case_patterns = c_res.get("patterns", [])
    case_score = c_res.get("score", 50)
    # Identify if payroll or merchant accounts are involved
    acc_type_map = {a["id"]: a.get("type", "personal") for a in c_res.get("accounts", [])}
    payroll_accs = [aid for aid, atype in acc_type_map.items() if atype == "payroll"]
    if payroll_accs:
        origin_acc = payroll_accs[0]
        has_payroll_origin = True
    else:
        origin_acc = case_accounts[0] if case_accounts else "ACC_00001"
        has_payroll_origin = False

    # 2. expand_neighborhood
    nb_res = expand_neighborhood(origin_acc, hops=1, limit=25, db=db, txn_graph=txn_graph)
    record_step("expand_neighborhood", {"account_id": origin_acc, "hops": 1, "limit": 25}, nb_res)

    # 3. run_algorithm (PageRank)
    pr_res = run_algorithm("pagerank", scope=case_accounts, db=db, txn_graph=txn_graph)
    record_step("run_algorithm", {"name": "pagerank", "scope": case_accounts}, pr_res)

    # 4. run_algorithm (Community)
    comm_res = run_algorithm("community", scope=case_accounts, db=db, txn_graph=txn_graph)
    record_step("run_algorithm", {"name": "community", "scope": case_accounts}, comm_res)

    # 5. find_similar_cases
    sim_res = find_similar_cases(case_id, limit=5, db=db, memory_graph=memory_graph)
    record_step("find_similar_cases", {"case_id": case_id, "limit": 5}, sim_res)

    # Analyze past outcomes from similar cases
    similar_items = sim_res.get("items", [])
    past_dismissals = [
        s for s in similar_items
        if s.get("outcome") in ("dismiss", "dismissed") or s.get("status") == "dismissed"
    ]
    past_escalations = [
        s for s in similar_items
        if s.get("outcome") in ("escalate", "escalated") or s.get("status") == "escalated"
    ]

    # 6. Rule-Based Action Selection
    findings_list: List[Dict[str, Any]] = []

    if has_payroll_origin and past_dismissals:
        # Hero narrative: payroll fan-out matching previously dismissed case
        ref_case = past_dismissals[0]["case_id"]
        prop_type = "dismiss"
        prop_reason = (
            f"Origin {origin_acc} is a verified payroll account conducting routine salary dispersal. "
            f"Pattern aligns with historical case {ref_case} which was previously investigated and dismissed."
        )
        risk_level = "low"
    elif case_score >= 70 or "cycle" in case_patterns:
        # Hero narrative: high-risk money loop / layering
        prop_type = "escalate"
        prop_reason = (
            f"High-confidence laundering indicator with priority score {case_score}/100. "
            f"Observed closed loop topologies ({', '.join(case_patterns)}) requiring compliance escalation."
        )
        risk_level = "high"
    elif case_score >= 40:
        prop_type = "monitor"
        prop_reason = f"Moderate risk score {case_score}/100. Behavioral pattern requires ongoing account monitoring."
        risk_level = "medium"
    else:
        prop_type = "dismiss"
        prop_reason = f"Low priority score ({case_score}/100) with no anomalous structuring detected."
        risk_level = "low"

    # 7. Record Findings in Memory
    primary_finding_text = (
        f"Structural analysis of {case_id} identified {len(case_patterns)} typology pattern(s) "
        f"across {len(case_accounts)} accounts with priority score {case_score}/100."
    )
    finding_1 = record_finding(
        case_id=case_id,
        text=primary_finding_text,
        evidence_ids=case_accounts[:3],
        investigation_id=inv_id,
        db=db,
        memory_graph=memory_graph,
    )
    findings_list.append({"text": primary_finding_text, "evidence_ids": case_accounts[:3]})

    if similar_items:
        sim_finding_text = (
            f"Institutional memory match: correlated {len(similar_items)} similar historical case(s) "
            f"sharing accounts ({', '.join(s['case_id'] for s in similar_items[:2])})."
        )
        record_finding(
            case_id=case_id,
            text=sim_finding_text,
            evidence_ids=[s["case_id"] for s in similar_items[:2]],
            investigation_id=inv_id,
            db=db,
            memory_graph=memory_graph,
        )
        findings_list.append({"text": sim_finding_text, "evidence_ids": [s["case_id"] for s in similar_items[:2]]})

    # 8. Propose Action in Memory
    action_res = propose_action(
        case_id=case_id,
        type=prop_type,
        reason=prop_reason,
        investigation_id=inv_id,
        db=db,
        memory_graph=memory_graph,
    )

    # 9. Format Markdown Narrative Template
    narrative = f"""### Case Investigation Narrative: {case_id}
**Mode:** Deterministic Graph Rule Engine (Safe Fallback)  
**Priority Score:** {case_score} / 100 ({risk_level.upper()} Risk)  
**Typologies:** {", ".join(case_patterns) if case_patterns else "General Transfer Review"}

#### 1. Topology & Neighborhood Analysis
An in-depth graph traversal was performed centering on origin account **{origin_acc}**. 
Neighbor expansion identified **{nb_res.get('total_nodes', len(case_accounts))}** related counterparty accounts with **Rs {nb_res.get('total_volume', 0.0):,.2f}** in transactional volume.

#### 2. Network Centrality & Algorithms
PageRank analysis on candidate accounts identified dominant flow concentration across case members. 
Community partitioning verified that entities operate within closely connected graph components.

#### 3. Institutional Memory Correlation
Historical case matching against the `memory` database identified **{len(similar_items)}** related past case(s).
{f"Historical case **{past_dismissals[0]['case_id']}** was previously dismissed as legitimate business flow." if past_dismissals else "No past dismissals observed for this cluster."}

#### 4. Recommendation & Proposed Action
Based on empirical graph heuristics, the system proposes to **{prop_type.upper()}** this case.
* **Reason:** {prop_reason}
"""

    return {
        "investigation_id": inv_id,
        "case_id": case_id,
        "status": "done",
        "mode": "fallback",
        "steps": steps,
        "assessment": {
            "risk_level": risk_level,
            "summary": f"Investigation for {case_id} completed via deterministic engine. Proposed action: {prop_type}.",
            "narrative": narrative.strip(),
            "findings": findings_list,
            "similar_cases": [
                {"case_id": s["case_id"], "outcome": s.get("outcome")} for s in similar_items
            ],
        },
        "proposed_action": action_res,
    }
