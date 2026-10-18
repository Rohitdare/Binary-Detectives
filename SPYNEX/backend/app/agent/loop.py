"""Evidence-checked autonomous investigation loop with deterministic fallback."""
import inspect
import json
import os
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

try:
    from app.agent import llm
    from app.agent.evidence import EvidenceStore
    from app.agent.fallback import run_fallback_investigation
    from app.agent.plain_language import PLAIN_LANGUAGE_RULES, clean_jargon
    from app.agent.tool_definitions import GEMINI_TOOL_NAME_MAP
    from app.agent.validator import validate_evidence_ids
except ImportError:
    from backend.app.agent import llm
    from backend.app.agent.evidence import EvidenceStore
    from backend.app.agent.fallback import run_fallback_investigation
    from backend.app.agent.plain_language import PLAIN_LANGUAGE_RULES, clean_jargon
    from backend.app.agent.tool_definitions import GEMINI_TOOL_NAME_MAP
    from backend.app.agent.validator import validate_evidence_ids


AGENT_SYSTEM_INSTRUCTION = f"""You investigate an existing RingTrace case using only the supplied tools.
{PLAIN_LANGUAGE_RULES}

Investigation Standards:
1. Workflow: Start by calling get_case. Inspect relevant funds and accounts, and call find_similar_cases to review precedents before deciding what to report. Record each distinct finding with record_finding and call propose_action exactly once.
2. Tone & Vocabulary: Write for a compliance officer in clear, professional AML investigation language. Explain observed fund movements using plain financial terms. Avoid graph theory or algorithm names.
3. Grounding & Anti-Hallucination: Use ONLY IDs, amounts, and facts returned by tools. Never invent missing IDs, amounts, timestamps, or counterparties. If evidence is missing, state that it is unavailable.
4. Structure: Explain each finding in terms of observed behavior, supported by specific accounts, amounts, elapsed time, and transfer sequences. Separate observed facts from interpretations and uncertainties.
5. Anti-Repetition & Anti-Boilerplate: Avoid generic filler, repeated caveats, and boilerplate disclaimers. Do NOT append the same disclaimer after each finding.
6. Risk Interpretation: The priority score is a triage priority score reflecting pattern severity, NOT a statistical probability of fraud. Trace reach describes the observed movement and disbursement scope of funds across accounts and routes, NOT a count of fraudulent accounts.
7. Action Proposals: Propose ESCALATE, MONITOR, or DISMISS with concrete, evidence-supported reasons. Explain specific uncertainties and next verification steps.
8. Output Format: Conclude with exactly one JSON object containing risk_level ("low", "medium", or "high"), summary, narrative (structured by Case Overview, Key Findings, Fund Movement, Historical Context, Assessment, and Recommended Next Step), findings, and proposed_action."""


def _turn_budget() -> int:
    try:
        return min(8, max(6, int(os.getenv("AGENT_MAX_TURNS", "8"))))
    except (TypeError, ValueError):
        return 8


def _timeout_seconds() -> float:
    try:
        return max(1.0, float(os.getenv("AGENT_TIMEOUT_S", "45")))
    except (TypeError, ValueError):
        return 45.0


def _parse_assessment(raw: str) -> Dict[str, Any]:
    cleaned = (raw or "").strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
    try:
        parsed = json.loads(cleaned)
        if not isinstance(parsed, dict):
            raise ValueError("assessment must be an object")
    except (ValueError, json.JSONDecodeError):
        raise ValueError("model did not return the required JSON assessment")
    if not isinstance(parsed.get("findings", []), list):
        raise ValueError("findings must be a list")
    if not isinstance(parsed.get("proposed_action"), dict):
        raise ValueError("proposed_action must be an object")
    return parsed


def _fallback(case_id, inv_id, step_callback, db, memory_graph, txn_graph):
    return run_fallback_investigation(
        case_id=case_id,
        investigation_id=inv_id,
        step_callback=step_callback,
        db=db,
        memory_graph=memory_graph,
        txn_graph=txn_graph,
    )


def _run_llm_investigation(case_id, inv_id, step_callback, db, memory_graph, txn_graph):
    budget = _turn_budget()
    deadline = time.monotonic() + _timeout_seconds()
    evidence = EvidenceStore()
    evidence.case_ids.add(case_id)
    declarations = llm.tool_declarations()
    contents = [llm.user_message(f"Investigate case {case_id}.")]
    cached_results: Dict[str, Dict[str, Any]] = {}
    recorded_findings: List[Dict[str, Any]] = []
    steps: List[Dict[str, Any]] = []
    proposal: Optional[Dict[str, Any]] = None
    tool_calls = 0
    step_index = 0
    reminded = False
    final_text = ""

    def emit_step(name, args, result, thought=""):
        nonlocal step_index
        step_index += 1
        result_evidence = result.get("evidence", {}) if isinstance(result, dict) else {}
        step = {
            "index": step_index,
            "tool": name.removeprefix("tool_"),
            "args": args,
            "summary": result.get("summary", "Evidence retrieved.") if isinstance(result, dict) else "Evidence retrieved.",
            "evidence": {
                "account_ids": result_evidence.get("account_ids", []),
                "tx_ids": result_evidence.get("tx_ids", []),
            },
        }
        if thought:
            checked = validate_evidence_ids(thought, evidence)
            if checked.is_valid:
                step["thought"] = thought[:300]
        steps.append(step)
        if step_callback:
            step_callback(step)

    for _turn in range(budget + 2):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("investigation time budget exhausted")
        response = llm.generate_with_timeout(
            contents,
            AGENT_SYSTEM_INSTRUCTION,
            declarations,
            timeout_seconds=min(remaining, _timeout_seconds()),
        )
        calls = llm.function_calls(response)
        response_part = llm.response_content(response)
        if response_part is not None:
            contents.append(response_part)

        if not calls:
            candidate_text = llm.text(response)
            if not recorded_findings or proposal is None:
                if reminded:
                    raise ValueError("model omitted required finding or action tool calls")
                contents.append(llm.user_message("Conclude now: call record_finding for each finding and propose_action once."))
                reminded = True
                continue
            final_text = candidate_text
            break

        response_parts = []
        thought = llm.text(response).strip()[:300]
        for tool_name, args in calls:
            tool_calls += 1
            if tool_calls > budget:
                raise RuntimeError("agent tool-call budget exhausted")
            tool = GEMINI_TOOL_NAME_MAP.get(tool_name)
            if tool is None:
                raise ValueError("model requested an unknown tool")
            signature = inspect.signature(tool)
            signature.bind(**args)
            cache_key = tool_name + ":" + json.dumps(args, sort_keys=True, separators=(",", ":"), default=str)
            if cache_key in cached_results:
                result = dict(cached_results[cache_key])
                result["cached"] = True
                result["summary"] = (result.get("summary", "Evidence retrieved.") + " This evidence was already retrieved.").strip()
            else:
                if tool_name in ("tool_record_finding", "record_finding"):
                    text_value = clean_jargon(str(args.get("text", "")))
                    args["text"] = text_value
                    if any(not evidence.has_id(item) for item in (args.get("evidence_ids") or [])):
                        raise ValueError("finding cited evidence not returned by tools")
                    if not validate_evidence_ids(text_value, evidence).is_valid:
                        raise ValueError("finding did not pass evidence and language validation")
                if tool_name in ("tool_propose_action", "propose_action"):
                    if proposal is not None:
                        raise ValueError("model requested more than one proposed action")
                    args["reason"] = clean_jargon(str(args.get("reason", "")))
                    if not validate_evidence_ids(args["reason"], evidence).is_valid:
                        raise ValueError("action reason did not pass evidence and language validation")

                result = tool(**args)
                if not isinstance(result, dict):
                    raise ValueError("tool returned an invalid result")
                cached_results[cache_key] = result
                evidence.add(result)

                if tool_name in ("tool_record_finding", "record_finding"):
                    recorded_findings.append({"text": args["text"], "evidence_ids": list(args.get("evidence_ids") or [])})
                elif tool_name in ("tool_propose_action", "propose_action"):
                    proposal = result

            if cache_key in cached_results and result.get("cached"):
                evidence.add(result)
            emit_step(tool_name, args, result, thought=thought)
            response_parts.append(llm.tool_result_part(tool_name, result))
        contents.append(llm.function_response_message(response_parts))

    if not final_text or proposal is None or not recorded_findings:
        raise ValueError("agent did not complete the required investigation workflow")
    parsed = _parse_assessment(final_text)
    proposed = parsed.get("proposed_action") or {}
    findings_text = "\n".join(str(item.get("text", "")) for item in recorded_findings)
    action_reason = str(proposed.get("reason") or proposal.get("reason") or "")
    narrative = clean_jargon(str(parsed.get("narrative", "")))
    summary = clean_jargon(str(parsed.get("summary", "")))
    checked = validate_evidence_ids("\n".join((summary, narrative, findings_text, action_reason)), evidence)
    if not checked.is_valid:
        # One correction attempt; if the model still fails the caller uses fallback.
        contents.append(llm.user_message(
            "Correct the assessment once. " + (checked.error_message or "Use only verified evidence and plain language.")
        ))
        retry = llm.generate_with_timeout(
            contents, AGENT_SYSTEM_INSTRUCTION, declarations,
            timeout_seconds=max(0.1, min(deadline - time.monotonic(), _timeout_seconds())),
        )
        parsed = _parse_assessment(llm.text(retry))
        proposed = parsed.get("proposed_action") or {}
        narrative = clean_jargon(str(parsed.get("narrative", "")))
        summary = clean_jargon(str(parsed.get("summary", "")))
        action_reason = str(proposed.get("reason") or proposal.get("reason") or "")
        checked = validate_evidence_ids("\n".join((summary, narrative, findings_text, action_reason)), evidence)
        if not checked.is_valid:
            raise ValueError("assessment failed evidence validation after one retry")

    action = dict(proposal)
    action.setdefault("type", proposed.get("type", "monitor"))
    action.setdefault("reason", action_reason)
    return {
        "investigation_id": inv_id,
        "case_id": case_id,
        "status": "done",
        "mode": "llm",
        "steps": steps,
        "assessment": {
            "risk_level": parsed.get("risk_level", "medium"),
            "summary": summary,
            "narrative": narrative,
            "findings": recorded_findings,
            "similar_cases": [],
        },
        "proposed_action": action,
    }


def run_investigation(
    case_id: str,
    investigation_id: Optional[str] = None,
    step_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    db: Any = None,
    memory_graph: str = "memory",
    txn_graph: str = "txn",
    force_fallback: bool = False,
) -> Dict[str, Any]:
    """Run the multi-turn agent, falling back safely for all provider or validation errors."""
    inv_id = investigation_id or f"INV_{uuid.uuid4().hex[:8]}"
    if force_fallback or not llm.is_llm_available():
        return _fallback(case_id, inv_id, step_callback, db, memory_graph, txn_graph)
    try:
        return _run_llm_investigation(case_id, inv_id, step_callback, db, memory_graph, txn_graph)
    except Exception:
        return _fallback(case_id, inv_id, step_callback, db, memory_graph, txn_graph)
