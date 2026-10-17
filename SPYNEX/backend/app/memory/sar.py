"""Deterministic SAR-style draft builder; it never files or sends a report."""
from typing import Any, Dict, List

try:
    from app.agent.plain_language import describe_pattern
except ImportError:
    from backend.app.agent.plain_language import describe_pattern


DISCLAIMER = "DRAFT for analyst review. Synthetic data, demonstration only. Not filed with any regulator."


def build_sar(data: Dict[str, Any]) -> Dict[str, str]:
    """Create a fixed-format report from already verified case and analyst data."""
    case_id = str(data.get("case_id", ""))
    sar_id = str(data.get("sar_id", ""))
    generated_at = str(data.get("generated_at", ""))
    account_ids = sorted(set(data.get("account_ids") or []))
    tx_ids = sorted(set(data.get("tx_ids") or []))
    patterns = data.get("patterns") or []
    hit_by_pattern = {hit.get("pattern"): hit for hit in data.get("hits", []) if isinstance(hit, dict)}
    observations = [
        describe_pattern(pattern, hit_by_pattern.get(pattern, {}).get("measurements", {}))
        for pattern in patterns
    ] or ["No detector pattern details were recorded in the case summary."]

    amount = data.get("total_amount")
    amount_line = f"Reported case total: ₹{float(amount):,.2f}." if isinstance(amount, (int, float)) else "Reported case total: not recorded."
    count = data.get("tx_count")
    if not isinstance(count, int) or count < 0:
        count = len(tx_ids)
    score = data.get("score")
    score_line = f"Priority score: {score}/100. This is a triage priority, not a probability." if isinstance(score, (int, float)) else "Priority score: not recorded. This is a triage aid, not a probability."
    time_range = data.get("time_range") or "Not recorded in the case summary."
    score_breakdown = data.get("score_breakdown") or {}
    breakdown_line = ", ".join(f"{key}: {score_breakdown[key]}" for key in sorted(score_breakdown)) or "Not recorded."

    listed_tx_ids = tx_ids[:20]
    more_count = max(0, count - len(listed_tx_ids))
    evidence_lines = [f"- {tx_id}" for tx_id in listed_tx_ids] or ["- No transaction IDs were recorded."]
    if more_count:
        evidence_lines.append(f"- {more_count} additional transaction(s) are represented in the case record.")
    findings = [str(item.get("text", "")).strip() for item in data.get("findings", []) if isinstance(item, dict) and item.get("text")]
    clarifications = [str(item.get("answer", "")).strip() for item in data.get("chat_notes", []) if isinstance(item, dict) and item.get("answer")]
    precedents = [
        f"Similar case {item.get('case_id')} had outcome {item.get('outcome')}" +
        (f" and SAR reference {', '.join(item.get('sar_ids') or [])}" if item.get("sar_ids") else "") + "."
        for item in data.get("precedents", []) if isinstance(item, dict) and item.get("case_id")
    ]
    decision = data.get("decision") or {}
    decision_text = (
        f"Approved for a draft by {decision.get('actor') or 'analyst'} at {decision.get('ts') or 'an unrecorded time'}. "
        f"Rationale: {decision.get('note') or 'No rationale was recorded.'}"
    )
    summary = " ".join(observations[:2])
    narrative = f"""# Suspicious Activity Report Draft

**SAR reference:** {sar_id}  
**Case:** {case_id}  
**Generated:** {generated_at}

> {DISCLAIMER}

## Subject accounts
{', '.join(account_ids) if account_ids else 'No account IDs were recorded.'}

## Summary of recorded activity
{' '.join(observations)}

## Key figures
- {amount_line}
- Transaction count: {count}.
- {score_line}
- Score details: {breakdown_line}
- Time range: {time_range}

## Transaction evidence
The report lists up to 20 transaction IDs; the case record contains {count} transaction(s).
{chr(10).join(evidence_lines)}

## Investigator findings
{chr(10).join('- ' + item for item in findings) if findings else 'No investigator findings were recorded.'}

## Analyst clarifications
{chr(10).join('- ' + item for item in clarifications) if clarifications else 'No verified chat clarifications were recorded.'}

## Prior decisions on similar cases
{chr(10).join('- ' + item for item in precedents) if precedents else 'No decided precedent was available.'}

## Analyst decision and rationale
{decision_text}

## Recommended action
Submit this draft for analyst review. This demonstration does not submit the report to a regulator.
"""
    return {"summary": summary, "narrative": narrative.strip()}
