"""Plain-language descriptions for compliance review, based on measured facts."""
import re
from typing import Any, Dict, Optional

PLAIN_LANGUAGE_RULES = """Write for a compliance officer in simple AML language. Do not mention algorithm names or graph-theory terms. Use only IDs and amounts returned by tools, and use tool-provided totals rather than calculating totals. A priority score is a triage aid, not a probability. Do not state that a structural pattern proves fraud."""

JARGON = (
    "GraphBLAS", "PageRank", "centrality", "WCC", "community detection",
    "adjacency", "topology", "subgraph", "in-degree", "out-degree",
    "conservation ratio", "edge weight", "attenuation", "hop", "hops",
    "connected component", "label propagation",
)
JARGON_REPLACEMENTS = {
    "PageRank hub": "central aggregator account",
    "PageRank": "account activity ranking",
    "centrality": "account activity measure",
    "topology": "transfer pattern",
    "subgraph": "account group",
    "in-degree": "number of sending accounts",
    "out-degree": "number of receiving accounts",
    "conservation ratio": "share of the original amount retained",
    "edge weight": "transfer amount",
    "attenuation": "reduction in the amount transferred",
    "hops": "steps",
    "hop": "step",
}
_JARGON_RE = [(re.compile(r"\b" + re.escape(term) + r"\b", re.I), term) for term in JARGON]


def find_jargon(text: str):
    """Return distinct known graph or algorithm terms present in text."""
    value = str(text or "")
    return [term for pattern, term in _JARGON_RE if pattern.search(value)]


def clean_jargon(text: str) -> str:
    """Apply safe phrase substitutions for common jargon before validation."""
    value = str(text or "")
    for source, replacement in sorted(JARGON_REPLACEMENTS.items(), key=lambda item: -len(item[0])):
        value = re.sub(r"\b" + re.escape(source) + r"\b", replacement, value, flags=re.I)
    return value


def _number(measurements: Dict[str, Any], *keys: str) -> Optional[float]:
    for key in keys:
        value = measurements.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return float(value)
    return None


def _hours(seconds: float) -> str:
    hours = seconds / 3600
    return f"{hours:.1f}".rstrip("0").rstrip(".")


def describe_pattern(pattern: str, measurements: Optional[Dict[str, Any]] = None) -> str:
    """Describe a detector hit using only measurement keys present in this repo."""
    m = measurements if isinstance(measurements, dict) else {}
    count = None
    amount = None
    span = _number(m, "duration_seconds", "time_span_seconds", "observation_span_seconds", "time_span")
    if pattern == "cycle":
        count = _number(m, "cycle_length", "length")
        retained = _number(m, "amount_conservation_ratio", "retention")
        text = "Circular fund movement: transfers returned to an earlier account"
        if count is not None:
            text += f" through {max(0, int(count) - 1)} intermediary accounts"
        if span is not None:
            text += f" within {_hours(span)} hours"
        if retained is not None:
            text += f", with {round(retained * 100)}% of the amount retained"
        return text + ". This pattern merits review and does not by itself prove fraud."
    if pattern == "fan_out":
        count = _number(m, "distinct_receivers")
        amount = _number(m, "total_outflow")
        text = "Dispersal pattern: one funding account sent transfers to multiple recipient accounts"
    elif pattern in ("fan_in", "hub_account"):
        count = _number(m, "distinct_senders", "distinct_counterparties")
        amount = _number(m, "total_amount")
        text = "Central receiving account collected transfers from multiple accounts"
    elif pattern == "relay_chain":
        count = _number(m, "hop_count")
        retained = _number(m, "overall_retention_ratio")
        text = "Rapid pass-through: money moved through a sequence of accounts"
        if count is not None:
            text += f" across {int(count)} transfers"
        if span is not None:
            text += f" within {_hours(span)} hours"
        if retained is not None:
            text += f", retaining {round(retained * 100)}% of the initial amount"
        return text + ". This pattern merits review and does not by itself prove fraud."
    elif pattern == "scatter_gather":
        count = _number(m, "intermediary_count", "path_count")
        text = "Several transfer routes connected a shared source with a shared receiving account"
    elif pattern == "gather_scatter":
        incoming = _number(m, "distinct_incoming_counterparties")
        outgoing = _number(m, "distinct_outgoing_counterparties")
        amount = _number(m, "incoming_amount")
        text = "An account received transfers from several senders and later sent transfers to other accounts"
        if incoming is not None and outgoing is not None:
            text += f" ({int(incoming)} senders and {int(outgoing)} recipients)"
        return _append_window(text, span)
    elif pattern == "bipartite":
        sources = _number(m, "source_count")
        targets = _number(m, "target_count")
        text = "Multiple sending accounts shared a set of recipient accounts"
        if sources is not None and targets is not None:
            text += f" ({int(sources)} senders and {int(targets)} recipients)"
        return text + ". This is structural evidence only, not a fraud finding."
    elif pattern == "dense_cluster":
        count = _number(m, "account_count")
        text = "A group of accounts made repeated transfers among members"
    else:
        return "The available case data shows a transfer pattern that merits review."

    if count is not None and pattern not in ("gather_scatter", "bipartite"):
        noun = "recipient accounts" if pattern == "fan_out" else "counterparties" if pattern == "hub_account" else "sender accounts" if pattern == "fan_in" else "intermediary accounts"
        text += f" involving {int(count)} {noun}"
    if amount is not None:
        text += f"; the reported total was ₹{amount:,.2f}"
    return _append_window(text, span)


def _append_window(text: str, span: Optional[float]) -> str:
    if span is not None:
        text += f" over {_hours(span)} hours"
    return text + ". This pattern merits review and does not by itself prove fraud."
