"""Tool declarations and dispatch registry for Gemini function calling.

Exposes the 8 MCP tools with clear schema descriptions, parameter types,
and documentation so Gemini 1.5 Flash knows exactly when and how to invoke them.
"""
from typing import Any, Callable, Dict, List, Optional

try:
    from app.mcp_server.tools import (
        expand_neighborhood,
        find_similar_cases,
        get_case,
        propose_action,
        record_finding,
        run_algorithm,
        shortest_path,
        trace_funds,
    )
except ImportError:
    from backend.app.mcp_server.tools import (
        expand_neighborhood,
        find_similar_cases,
        get_case,
        propose_action,
        record_finding,
        run_algorithm,
        shortest_path,
        trace_funds,
    )


# ---------------------------------------------------------------------------
# Python Callables for Gemini Function Calling
# ---------------------------------------------------------------------------

def tool_get_case(case_id: str) -> Dict[str, Any]:
    """Retrieve complete metadata, priority score breakdown, detected hits, and involved accounts for a case.

    Args:
        case_id: The unique ID of the case (e.g. 'CASE_0001').
    """
    return get_case(case_id=case_id)


def tool_expand_neighborhood(account_id: str, hops: int = 1, limit: int = 50) -> Dict[str, Any]:
    """Query the transaction graph for 1-hop or 2-hop transfer neighbors of an account.

    Args:
        account_id: The account ID to inspect (e.g. 'ACC_01911').
        hops: Number of hops to expand (1 or 2).
        limit: Maximum number of transactions to return (1-100).
    """
    return expand_neighborhood(account_id=account_id, hops=hops, limit=limit)


def tool_trace_funds(
    account_id: str,
    direction: str = "forward",
    max_hops: int = 3,
    window_seconds: int = 604800,
) -> Dict[str, Any]:
    """Follow money flow forward (dispersal) or backward (sourcing) along chronological transfer paths.

    Args:
        account_id: The root account ID to trace from.
        direction: 'forward' to trace outbound payments, or 'backward' to trace source of incoming funds.
        max_hops: Number of transfer hops to follow (1-4).
        window_seconds: Time window in seconds across the path (default 604800, which is 7 days).
    """
    return trace_funds(
        account_id=account_id,
        direction=direction,
        max_hops=max_hops,
        window_seconds=window_seconds,
    )


def tool_shortest_path(src: str, dst: str) -> Dict[str, Any]:
    """Find the shortest directed transfer path between two accounts in the transaction graph.

    Args:
        src: Source account ID (e.g. 'ACC_01911').
        dst: Destination account ID (e.g. 'ACC_02729').
    """
    return shortest_path(src=src, dst=dst)


def tool_run_algorithm(name: str, scope: Optional[List[str]] = None) -> Dict[str, Any]:
    """Execute graph algorithms on accounts in the transaction graph.

    Args:
        name: Name of algorithm: 'pagerank' (velocity hub ranking), 'community' (cluster partition), or 'connected_components'.
        scope: Optional list of account IDs to focus or score.
    """
    return run_algorithm(name=name, scope=scope)


def tool_find_similar_cases(case_id: str, limit: int = 5) -> Dict[str, Any]:
    """Search institutional memory for past cases sharing accounts or structural signatures, returning past outcomes.

    Args:
        case_id: The case ID to compare (e.g. 'CASE_0002').
        limit: Maximum number of similar cases to return (1-20).
    """
    return find_similar_cases(case_id=case_id, limit=limit)


def tool_record_finding(case_id: str, text: str, evidence_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """Record a factual finding with supporting account and transaction IDs in institutional memory.

    Args:
        case_id: The case ID to attach this finding to.
        text: Objective explanation of the observed graph pattern.
        evidence_ids: List of account IDs (ACC_...) and transaction IDs (TX_...) supporting this finding.
    """
    return record_finding(case_id=case_id, text=text, evidence_ids=evidence_ids)


def tool_propose_action(case_id: str, type: str, reason: str) -> Dict[str, Any]:
    """Propose an investigative action for human analyst approval. Does NOT execute the action.

    Args:
        case_id: The case ID this recommendation is for.
        type: Proposed action: 'escalate' (high risk AML), 'monitor' (watch for changes), 'dismiss' (benign look-alike), or 'draft_sar'.
        reason: Factual explanation justifying the proposed action.
    """
    return propose_action(case_id=case_id, type=type, reason=reason)


# List of Python callables passed directly to Gemini types.GenerateContentConfig(tools=...)
GEMINI_CALLABLE_TOOLS: List[Callable[..., Any]] = [
    tool_get_case,
    tool_expand_neighborhood,
    tool_trace_funds,
    tool_shortest_path,
    tool_run_algorithm,
    tool_find_similar_cases,
    tool_record_finding,
    tool_propose_action,
]

GEMINI_TOOL_NAME_MAP: Dict[str, Callable[..., Any]] = {
    "tool_get_case": tool_get_case,
    "get_case": tool_get_case,
    "tool_expand_neighborhood": tool_expand_neighborhood,
    "expand_neighborhood": tool_expand_neighborhood,
    "tool_trace_funds": tool_trace_funds,
    "trace_funds": tool_trace_funds,
    "tool_shortest_path": tool_shortest_path,
    "shortest_path": tool_shortest_path,
    "tool_run_algorithm": tool_run_algorithm,
    "run_algorithm": tool_run_algorithm,
    "tool_find_similar_cases": tool_find_similar_cases,
    "find_similar_cases": tool_find_similar_cases,
    "tool_record_finding": tool_record_finding,
    "record_finding": tool_record_finding,
    "tool_propose_action": tool_propose_action,
    "propose_action": tool_propose_action,
}
