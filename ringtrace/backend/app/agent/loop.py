"""Multi-turn autonomous investigation agent loop for RingTrace (Member B).

Orchestrates the investigation:
  1. Coordinates an 8-turn budget with Gemini 1.5 Flash.
  2. Invocates the 8 MCP tools, streaming step events in real-time.
  3. Validates the final narrative through the anti-hallucination validator.
  4. Records findings and proposes an action exactly once.
  5. Automatically falls back to the deterministic safe fallback on any failure.
"""
import json
import uuid
from typing import Any, Callable, Dict, List, Optional, Set

try:
    from app.agent.fallback import run_fallback_investigation
    from app.agent.llm import generate_content_with_timeout, get_client, is_llm_available
    from app.agent.tool_definitions import (
        GEMINI_CALLABLE_TOOLS,
        GEMINI_TOOL_NAME_MAP,
    )
    from app.agent.validator import validate_narrative
    from app.mcp_server.tools import get_case, propose_action, record_finding
except ImportError:
    from backend.app.agent.fallback import run_fallback_investigation
    from backend.app.agent.llm import generate_content_with_timeout, get_client, is_llm_available
    from backend.app.agent.tool_definitions import (
        GEMINI_CALLABLE_TOOLS,
        GEMINI_TOOL_NAME_MAP,
    )
    from backend.app.agent.validator import validate_narrative
    from backend.app.mcp_server.tools import get_case, propose_action, record_finding

AGENT_SYSTEM_INSTRUCTION = """You are RingTrace's Senior Financial Crime & AML Graph Investigation Agent.
Your job is to investigate flagged money-laundering cases in FalkorDB using the provided graph tools.

RULES:
1. Grounding Guarantee: You must NEVER invent or hallucinate account IDs (ACC_...), transaction IDs (TX_...), or case IDs (CASE_...).
   You may ONLY cite entity IDs that exist in the case evidence or were returned by tool results.
2. Tool Budget & Workflow: You have up to 8 tool calls. Be strategic:
   - Always start by getting case details if not already present.
   - CRITICAL INSTITUTIONAL MEMORY CHECK: You MUST invoke `find_similar_cases` to see if this account cluster or topological pattern was previously investigated or decided.
   - Expand neighborhoods to look for structural patterns (cycles, fan-in, fan-out, layering).
   - Use trace_funds to follow money flows chronologically.
   - Run graph algorithms (pagerank, community, betweenness) as needed to evaluate centrality.
3. Precedent Citation & Decision Consistency:
   - If `find_similar_cases` returns historical cases (e.g. CASE_0002), you MUST cite the earlier case ID (e.g. "CASE_0002") in your summary and narrative.
   - If the prior case was dismissed (e.g. routine salary or benign payroll fan-out), state that this case matches the dismissed precedent and recommend dismissing with low risk.
   - If the prior case was escalated, mention the previous escalation as corroboration.
4. Recommendations: Propose an action (escalate, monitor, dismiss, or draft_sar) with factual justifications.
5. Output Format:
   In your final turn, output a structured JSON object with these keys:
   {
       "risk_level": "high" | "medium" | "low",
       "summary": "1-2 sentence executive summary citing any prior case IDs found",
       "narrative": "Detailed Markdown investigative assessment detailing graph topology, evidence, and prior precedents",
       "findings": [{"text": "...", "evidence_ids": ["ACC_...", "TX_...", "CASE_..."]}],
       "proposed_action": {"type": "escalate"|"monitor"|"dismiss"|"draft_sar", "reason": "..."}
   }
"""


def run_investigation(
    case_id: str,
    investigation_id: Optional[str] = None,
    step_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    db: Any = None,
    memory_graph: str = "memory",
    txn_graph: str = "txn",
    force_fallback: bool = False,
) -> Dict[str, Any]:
    """Execute the complete investigation workflow for a case.

    Guarantees that a valid, safe investigation response is ALWAYS returned,
    either via Gemini 1.5 Flash or via the deterministic rule engine.
    """
    inv_id = investigation_id or f"INV_{uuid.uuid4().hex[:8]}"

    # If fallback is forced or LLM is not configured, run fallback directly
    if force_fallback or not is_llm_available():
        return run_fallback_investigation(
            case_id=case_id,
            investigation_id=inv_id,
            step_callback=step_callback,
            db=db,
            memory_graph=memory_graph,
            txn_graph=txn_graph,
        )

    # Initialize Gemini client & tracking
    try:
        from google.genai import types

        client = get_client()
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

        # Initial Case Context Retrieval
        init_case = get_case(case_id, db=db, memory_graph=memory_graph)
        record_step("get_case", {"case_id": case_id}, init_case)

        if init_case.get("status") == "error":
            return {
                "investigation_id": inv_id,
                "case_id": case_id,
                "status": "error",
                "mode": "llm",
                "error": init_case.get("error", "Case not found"),
                "steps": steps,
                "assessment": None,
                "proposed_action": None,
            }

        # Conversation history for Gemini multi-turn
        prompt = (
            f"Please conduct an investigation on {case_id}. Initial case details:\n"
            f"{json.dumps(init_case, indent=2)}\n"
            f"Use the available graph tools to inspect connections, run algorithms, and check memory before rendering your final assessment."
        )

        chat_contents = [types.Content(role="user", parts=[types.Part.from_text(text=prompt)])]
        config = types.GenerateContentConfig(
            system_instruction=AGENT_SYSTEM_INSTRUCTION,
            tools=GEMINI_CALLABLE_TOOLS,
            temperature=0.2,
        )

        turn = 0
        final_text = ""

        while turn < 8:
            turn += 1
            response = generate_content_with_timeout(
                client=client,
                model="gemini-1.5-flash",
                contents=chat_contents,
                config=config,
            )

            # Check if Gemini requested function/tool calls
            candidates = response.candidates or []
            if not candidates:
                break

            candidate = candidates[0]
            content = candidate.content
            chat_contents.append(content)

            function_calls = [p.function_call for p in content.parts if p.function_call]

            if not function_calls:
                # LLM finished tool calls and provided final text
                final_text = "".join(p.text for p in content.parts if p.text)
                break

            # Execute tool calls and send results back
            tool_response_parts = []
            for fc in function_calls:
                tool_name = fc.name
                tool_args = dict(fc.args) if fc.args else {}

                tool_func = GEMINI_TOOL_NAME_MAP.get(tool_name)
                if tool_func:
                    try:
                        result = tool_func(**tool_args)
                    except Exception as err:
                        result = {"status": "error", "error": str(err), "summary": f"Tool error: {err}"}
                else:
                    result = {"status": "error", "error": f"Unknown tool '{tool_name}'"}

                record_step(tool_name.replace("tool_", ""), tool_args, result)
                tool_response_parts.append(
                    types.Part.from_function_response(name=tool_name, response={"result": result})
                )

            chat_contents.append(types.Content(role="user", parts=tool_response_parts))

        # Anti-Hallucination Validation
        val_res = validate_narrative(
            text=final_text,
            allowed_accounts=allowed_accounts,
            allowed_transactions=allowed_txs,
            allowed_cases=allowed_cases,
            current_case_id=case_id,
        )

        if not val_res.is_valid:
            # Retry once with feedback
            retry_prompt = (
                f"Your assessment mentioned hallucinated entity ID(s) not in evidence: {', '.join(val_res.hallucinated_ids)}.\n"
                f"Please regenerate your assessment citing ONLY verified IDs from the tool evidence."
            )
            chat_contents.append(types.Content(role="user", parts=[types.Part.from_text(text=retry_prompt)]))
            retry_resp = generate_content_with_timeout(
                client=client,
                model="gemini-1.5-flash",
                contents=chat_contents,
                config=config,
            )
            final_text = "".join(p.text for p in retry_resp.candidates[0].content.parts if p.text)

            # Re-validate
            val_res_2 = validate_narrative(
                text=final_text,
                allowed_accounts=allowed_accounts,
                allowed_transactions=allowed_txs,
                allowed_cases=allowed_cases,
                current_case_id=case_id,
            )
            if not val_res_2.is_valid:
                # Trigger safe fallback on stubborn hallucination
                return run_fallback_investigation(
                    case_id=case_id,
                    investigation_id=inv_id,
                    step_callback=step_callback,
                    db=db,
                    memory_graph=memory_graph,
                    txn_graph=txn_graph,
                )

        # Parse structured assessment JSON or Markdown
        try:
            # Strip markdown json codeblocks if present
            clean_json = final_text.strip()
            if clean_json.startswith("```json"):
                clean_json = clean_json[7:]
            if clean_json.startswith("```"):
                clean_json = clean_json[3:]
            if clean_json.endswith("```"):
                clean_json = clean_json[:-3]
            parsed = json.loads(clean_json.strip())
        except Exception:
            parsed = {
                "risk_level": "medium",
                "summary": f"Investigation for {case_id} concluded with LLM reasoning.",
                "narrative": final_text,
                "findings": [],
                "proposed_action": {"type": "monitor", "reason": "Further monitoring required."},
            }

        # Write Findings and Proposed Action to Memory
        findings = parsed.get("findings", [])
        for f in findings:
            record_finding(
                case_id=case_id,
                text=f.get("text", ""),
                evidence_ids=f.get("evidence_ids", []),
                investigation_id=inv_id,
                db=db,
                memory_graph=memory_graph,
            )

        prop_act = parsed.get("proposed_action", {})
        act_res = propose_action(
            case_id=case_id,
            type=prop_act.get("type", "monitor"),
            reason=prop_act.get("reason", "Investigation completed."),
            investigation_id=inv_id,
            db=db,
            memory_graph=memory_graph,
        )

        return {
            "investigation_id": inv_id,
            "case_id": case_id,
            "status": "done",
            "mode": "llm",
            "steps": steps,
            "assessment": {
                "risk_level": parsed.get("risk_level", "medium"),
                "summary": parsed.get("summary", ""),
                "narrative": parsed.get("narrative", final_text),
                "findings": findings,
                "similar_cases": [],
            },
            "proposed_action": act_res,
        }

    except Exception:
        # Seamlessly fall back to deterministic engine on any exception/timeout
        return run_fallback_investigation(
            case_id=case_id,
            investigation_id=inv_id,
            step_callback=step_callback,
            db=db,
            memory_graph=memory_graph,
            txn_graph=txn_graph,
        )
