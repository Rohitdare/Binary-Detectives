"""Read-only, evidence-checked investigator chat."""
import json
import os
import time
import uuid
from typing import Any, Dict, List, Optional

try:
    from app.agent import llm
    from app.agent.evidence import EvidenceStore
    from app.agent.plain_language import PLAIN_LANGUAGE_RULES, clean_jargon, describe_pattern
    from app.agent.validator import validate_evidence_ids
    from app.db import FalkorDBClient
    from app.mcp_server.tools import expand_neighborhood, get_case, shortest_path, trace_funds
    from app.queries_memory import SAVE_CHAT_NOTE_CYPHER
except ImportError:
    from backend.app.agent import llm
    from backend.app.agent.evidence import EvidenceStore
    from backend.app.agent.plain_language import PLAIN_LANGUAGE_RULES, clean_jargon, describe_pattern
    from backend.app.agent.validator import validate_evidence_ids
    from backend.app.db import FalkorDBClient
    from backend.app.mcp_server.tools import expand_neighborhood, get_case, shortest_path, trace_funds
    from backend.app.queries_memory import SAVE_CHAT_NOTE_CYPHER


class ChatCaseNotFound(LookupError):
    pass


def _max_turns() -> int:
    try:
        return min(4, max(1, int(os.getenv("CHAT_MAX_TURNS", "4"))))
    except (TypeError, ValueError):
        return 4


def run_case_chat(
    case_id: str,
    message: str,
    history: Optional[List[Dict[str, str]]] = None,
    db: Any = None,
    memory_graph: str = "memory",
    txn_graph: str = "txn",
) -> Dict[str, Any]:
    """Answer a case question using only four read-only tools and verified evidence."""
    case_id = case_id.strip()
    message = message.strip()
    history = list(history or [])[-10:]
    case_result = get_case(case_id, db=db, memory_graph=memory_graph)
    if case_result.get("status") != "success":
        raise ChatCaseNotFound(case_id)

    evidence = EvidenceStore()
    evidence.add(case_result)
    evidence.case_ids.add(case_id)
    step_events: List[Dict[str, Any]] = []
    tool_cache: Dict[str, Dict[str, Any]] = {}
    final_reply = ""

    def get_case_for_chat(case_id: str):
        return get_case(case_id, db=db, memory_graph=memory_graph)

    def expand_for_chat(account_id: str, hops: int = 1, limit: int = 50):
        return expand_neighborhood(account_id, hops=hops, limit=limit, db=db, txn_graph=txn_graph)

    def trace_for_chat(account_id: str, direction: str = "forward", max_hops: int = 3, window_seconds: int = 30 * 86400):
        return trace_funds(account_id, direction=direction, max_hops=max_hops, window_seconds=window_seconds, db=db, txn_graph=txn_graph)

    def path_for_chat(src: str, dst: str):
        return shortest_path(src, dst, db=db, txn_graph=txn_graph)

    get_case_for_chat.__name__ = "get_case"
    expand_for_chat.__name__ = "expand_neighborhood"
    trace_for_chat.__name__ = "trace_funds"
    path_for_chat.__name__ = "shortest_path"
    allowed_tools = {
        "get_case": get_case_for_chat,
        "expand_neighborhood": expand_for_chat,
        "trace_funds": trace_for_chat,
        "shortest_path": path_for_chat,
    }
    system_prompt = f"""You are RingTrace's read-only case assistant. Answer the analyst in one short paragraph using only the four supplied read-only tools. Never write findings, propose actions, or record decisions. If evidence says an account or path was not found, say so clearly.
{PLAIN_LANGUAGE_RULES}"""

    if llm.is_llm_available():
        declarations = llm.tool_declarations(list(allowed_tools.values()))
        contents = [llm.user_message(f"Investigate case {case_id}.")]
        for item in history:
            contents.append(llm.history_message(item["role"], item["content"]))
        contents.append(llm.user_message(f"Analyst question: {message}"))
        for turn in range(_max_turns()):
            try:
                response = llm.generate_with_timeout(contents, system_prompt, declarations)
            except Exception:
                break
            response_content = llm.response_content(response)
            if response_content is not None:
                contents.append(response_content)
            calls = llm.function_calls(response)
            if not calls:
                final_reply = llm.text(response).strip()
                break
            response_parts = []
            for name, args in calls:
                tool = allowed_tools.get(name)
                if tool is None:
                    response_parts = []
                    break
                key = name + ":" + json.dumps(args, sort_keys=True, separators=(",", ":"), default=str)
                if key in tool_cache:
                    result = tool_cache[key]
                else:
                    try:
                        result = tool(**args)
                    except Exception:
                        response_parts = []
                        break
                    if not isinstance(result, dict):
                        raise ValueError("chat tool returned an invalid result")
                    tool_cache[key] = result
                    evidence.add(result)
                ev = result.get("evidence", {})
                step_events.append({
                    "tool": name,
                    "args": args,
                    "summary": clean_jargon(str(result.get("summary", "Evidence retrieved."))),
                    "evidence": {
                        "account_ids": ev.get("account_ids", []),
                        "tx_ids": ev.get("tx_ids", []),
                    },
                })
                response_parts.append(llm.tool_result_part(name, result))
            contents.append(llm.function_response_message(response_parts))
            if turn == _max_turns() - 1:
                final_reply = llm.text(response).strip()

    validation = validate_evidence_ids(final_reply, evidence) if final_reply else None
    verified = bool(validation and validation.is_valid and step_events)
    if not verified:
        # This answer is assembled from the stored case findings and verified tool summaries.
        descriptions = [
            describe_pattern(hit.get("pattern", ""), hit.get("measurements", {}))
            for hit in case_result.get("hits", [])
        ]
        summaries = [item["summary"] for item in step_events if item.get("summary")]
        raw_lines = descriptions or summaries or ["No additional transaction evidence was returned for this question."]
        final_reply = clean_jargon(" ".join(raw_lines))
        validation = validate_evidence_ids(final_reply, evidence)
        verified = validation.is_valid

    evidence_summary = evidence.summary()
    response = {
        "reply": final_reply,
        "steps": step_events,
        "evidence": {
            "account_ids": evidence_summary["account_ids"],
            "tx_ids": evidence_summary["tx_ids"],
        },
        "verified": verified,
    }
    if verified:
        note_id = f"NOTE_{uuid.uuid4().hex[:10]}"
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        evidence_ids = sorted(set(evidence_summary["account_ids"] + evidence_summary["tx_ids"] + evidence_summary["case_ids"] + evidence_summary["sar_ids"]))
        saved = (db or FalkorDBClient()).execute_query(
            memory_graph,
            SAVE_CHAT_NOTE_CYPHER,
            {"case_id": case_id, "note_id": note_id, "question": message, "answer": final_reply, "evidence_ids": evidence_ids, "ts": ts},
            caller="agent:save_chat_note",
        )
        if not saved or not saved.result_set:
            response["verified"] = False
    return response
