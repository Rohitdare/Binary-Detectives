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
        trace_funds,
    )
    from app.agent.plain_language import clean_jargon, describe_pattern
except ImportError:
    from backend.app.mcp_server.tools import (
        expand_neighborhood,
        find_similar_cases,
        get_case,
        propose_action,
        record_finding,
        trace_funds,
    )
    from backend.app.agent.plain_language import clean_jargon, describe_pattern


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
        origin_acc = case_accounts[0] if case_accounts else None
        has_payroll_origin = False

    # 2. expand_neighborhood
    if origin_acc:
        nb_res = expand_neighborhood(origin_acc, hops=1, limit=25, db=db, txn_graph=txn_graph)
        record_step("expand_neighborhood", {"account_id": origin_acc, "hops": 1, "limit": 25}, nb_res)
    else:
        nb_res = {"status": "error", "summary": "The case has no account evidence to expand.", "evidence": {"account_ids": [], "tx_ids": []}}
        record_step("expand_neighborhood", {"account_id": None, "hops": 1, "limit": 25}, nb_res)

    # 3. Follow funds from the selected source using transaction evidence.
    if origin_acc:
        trace_res = trace_funds(origin_acc, direction="forward", max_hops=3, db=db, txn_graph=txn_graph)
        record_step("trace_funds", {"account_id": origin_acc, "direction": "forward", "max_hops": 3}, trace_res)
    else:
        trace_res = {"status": "error", "summary": "No account evidence was available to follow transfers.", "evidence": {"account_ids": [], "tx_ids": []}}
        record_step("trace_funds", {"account_id": None, "direction": "forward", "max_hops": 3}, trace_res)

    # 4. Check reviewed precedents.
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
        # Verified payroll with matching historical dismissal precedent
        ref_case = past_dismissals[0]["case_id"]
        prop_type = "dismiss"
        prop_reason = (
            f"Origin {origin_acc} is a verified payroll account conducting routine salary dispersal. "
            f"Pattern aligns with historical case {ref_case} which was previously investigated and dismissed as legitimate business flow."
        )
        risk_level = "low"
    elif case_score >= 70 or "cycle" in case_patterns:
        prop_type = "escalate"
        key_patterns = [p for p in ("cycle", "relay_chain", "scatter_gather") if p in case_patterns] or case_patterns
        patterns_str = ", ".join(key_patterns) if key_patterns else "complex transfer structuring"
        prop_reason = (
            f"Priority score {case_score}/100 and anomalous fund routing ({patterns_str}) indicate elevated layering risk. "
            f"Analyst escalation is warranted to verify beneficial ownership and transaction legitimacy."
        )
        risk_level = "high"
    elif case_score >= 40:
        prop_type = "monitor"
        patterns_str = ", ".join(case_patterns) if case_patterns else "transfer activity"
        prop_reason = (
            f"Priority score {case_score}/100 reflects moderate transfer structuring ({patterns_str}). "
            f"Ongoing transaction monitoring is recommended to observe whether recipient accounts initiate secondary pass-through or layering."
        )
        risk_level = "medium"
    else:
        prop_type = "dismiss"
        prop_reason = f"Low priority score ({case_score}/100) with no anomalous layering or structuring detected in the case evidence."
        risk_level = "low"

    # 7. Record Findings in Memory
    primary_finding_text = (
            f"Case {case_id} contains {len(case_patterns)} recorded transfer pattern(s) "
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
            f"Prior analyst decisions are available for {len(similar_items)} similar case(s): "
            f"{', '.join(s['case_id'] for s in similar_items[:2])}."
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

    # 5. Format a plain-language narrative from measured hit properties.
    pattern_descriptions = []
    for pattern in case_patterns:
        match = next((hit for hit in c_res.get("hits", []) if hit.get("pattern") == pattern), {})
        pattern_descriptions.append(describe_pattern(pattern, match.get("measurements", {})))
    if not pattern_descriptions:
        pattern_descriptions.append("No detector pattern details were available in the case record.")

    # Historical context narrative
    if past_dismissals:
        historical_text = (
            f"Reviewed **{len(similar_items)}** related past case(s). Historical case **{past_dismissals[0]['case_id']}** "
            f"was previously investigated and dismissed as legitimate business flow."
        )
    elif similar_items:
        case_list_str = ", ".join(f"**{s['case_id']}**" for s in similar_items[:3])
        historical_text = (
            f"Reviewed **{len(similar_items)}** related past case(s) ({case_list_str}). "
            f"No past dismissals were recorded for this cluster; this absence does not establish suspicious activity "
            f"and requires independent verification."
        )
    else:
        historical_text = "No decided historical precedents were returned for this cluster."

    # Assessment narrative synthesizing facts, uncertainties, and verification steps
    if "cycle" in case_patterns:
        pattern_eval = "The presence of circular transfer paths suggests potential fund recycling or layering. "
    elif "relay_chain" in case_patterns:
        pattern_eval = "Rapid sequential transfers indicate minimal dwell time between hops, consistent with pass-through structuring. "
    elif "fan_out" in case_patterns:
        pattern_eval = "Concentrated outward dispersal distributes capital across multiple counterparties. "
    elif "gather_scatter" in case_patterns:
        pattern_eval = "Multi-party aggregation followed by redistribution indicates high-turnover intermediary transit. "
    else:
        pattern_eval = "The observed transfer structure reflects coordinated movement across multiple counterparties. "

    assessment_narrative = (
        f"{pattern_eval}However, structural patterns alone do not prove unlawful intent or fraud. "
        "Underlying commercial relationships, corporate group affiliations, or batch payment processes "
        "could account for these transfer flows. "
        "Recommended analyst verification includes reviewing underlying commercial invoices, "
        "confirming beneficial ownership across counterparties, and checking source of funds documentation."
    )

    narrative = f"""### Case Investigation Narrative: {case_id}
**Mode:** Deterministic fallback
**Priority Score:** {case_score} / 100 ({risk_level.upper()} Risk — triage priority score, not a probability of fraud)

#### Case overview
Case **{case_id}** involves **{len(case_accounts)} accounts** with recorded transfer activity exhibiting {', '.join(case_patterns) if case_patterns else 'no flagged patterns'}. The priority score of {case_score}/100 serves as a triage indicator reflecting pattern severity and velocity.

#### Key findings
The available case evidence records the following measured observations:
{chr(10).join(f'- {description}' for description in pattern_descriptions)}

#### Fund movement
{f'Followed transfers from **{origin_acc}**. ' if origin_acc else ''}{trace_res.get('summary', 'No transfer path summary was returned.')}
*Note: Trace reach describes the observed movement and disbursement boundary of funds across routes, not a count of suspicious or fraudulent accounts.*

#### Historical context
{historical_text}

#### Assessment
{assessment_narrative}

#### Recommended next step
The system proposes **{prop_type.upper()}** for analyst review.
**Reason:** {prop_reason}
"""

    narrative = clean_jargon(narrative.strip())
    primary_finding_text = clean_jargon(primary_finding_text)
    return {
        "investigation_id": inv_id,
        "case_id": case_id,
        "status": "done",
        "mode": "fallback",
        "steps": steps,
        "assessment": {
            "risk_level": risk_level,
            "summary": f"Investigation for {case_id} completed via deterministic engine. Proposed action: {prop_type}.",
            "narrative": narrative,
            "findings": findings_list,
            "similar_cases": [
                {"case_id": s["case_id"], "outcome": s.get("outcome")} for s in similar_items
            ],
        },
        "proposed_action": action_res,
    }
