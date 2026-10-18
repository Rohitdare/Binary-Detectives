"""Plain-language descriptions for compliance review, based on measured facts."""
import re
from typing import Any, Dict, Optional

PLAIN_LANGUAGE_RULES = (
    "Write for a compliance officer in clear, professional AML investigation language. "
    "Explain each finding in terms of actual observed fund movement and evidence without graph jargon. "
    "Do not mention algorithm names or graph-theory terms. "
    "Use only IDs and amounts returned by tools, and use tool-provided totals rather than calculating totals. "
    "A priority score is a triage priority reflecting pattern severity and velocity, not a statistical probability of fraud. "
    "Trace reach describes the observed movement and disbursement scope of funds, not a count of fraudulent accounts. "
    "Avoid generic filler, repeated caveats, and boilerplate disclaimers. "
    "Do not repeat the same disclaimer after each finding. "
    "Do not infer intent, criminality, or fraud from a structural graph pattern alone; separate observed facts from interpretations and uncertainties."
)

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
    """Describe a detector hit using only measured facts without generic repeated boilerplate.
    
    Structure:
      1. Observed behavior: What fund movement occurred.
      2. Evidence: Counts, amounts, time window, retention ratios.
      3. Interpretation: Relevance to AML review.
      4. Qualification: Commercial context vs. layering risk.
    """
    m = measurements if isinstance(measurements, dict) else {}
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
            if retained > 1.0:
                text += f", with downstream transfers reaching {round(retained * 100)}% of the starting amount (indicating fund aggregation along the path)"
            else:
                text += f", with {round(retained * 100)}% of the amount retained"
        return text + ". This closed-loop flow suggests fund recycling or layering; verify whether an underlying commercial purpose exists."

    if pattern == "relay_chain":
        count = _number(m, "hop_count")
        retained = _number(m, "overall_retention_ratio")
        text = "Rapid pass-through: money moved through a sequence of accounts"
        if count is not None:
            text += f" across {int(count)} transfers"
        if span is not None:
            text += f" within {_hours(span)} hours"
        if retained is not None:
            if retained > 1.0:
                text += f", with downstream transfer amounts reaching {round(retained * 100)}% of the initial amount (indicating possible fund aggregation or co-mingling along the path)"
            else:
                text += f", retaining {round(retained * 100)}% of the initial amount"
        return text + ". Low-dwell transit sequences are characteristic of layering, though automated payment routing can also exhibit this structure."

    if pattern == "fan_out":
        count = _number(m, "distinct_receivers")
        amount = _number(m, "total_outflow")
        text = "Dispersal pattern: one funding account sent transfers to multiple recipient accounts"
        if count is not None:
            text += f" involving {int(count)} recipient accounts"
        if amount is not None:
            text += f"; the reported total was ₹{amount:,.2f}"
        if span is not None:
            text += f" over {_hours(span)} hours"
        return text + ". Outward dispersal across multiple counterparties warrants verifying recipient ownership and disbursement purpose."

    if pattern in ("fan_in", "hub_account"):
        count = _number(m, "distinct_senders", "distinct_counterparties")
        amount = _number(m, "total_amount")
        noun = "counterparties" if pattern == "hub_account" else "sender accounts"
        text = "Convergence pattern: central receiving account collected transfers from multiple accounts"
        if count is not None:
            text += f" involving {int(count)} {noun}"
        if amount is not None:
            text += f"; the reported total was ₹{amount:,.2f}"
        if span is not None:
            text += f" over {_hours(span)} hours"
        return text + ". Inward concentration from multiple distinct sources warrants verifying counterparty relationships and account capacity."

    if pattern == "scatter_gather":
        count = _number(m, "intermediary_count", "path_count")
        text = "Split-and-recombine routing: several transfer routes connected a shared source with a shared receiving account"
        if count is not None:
            text += f" across {int(count)} intermediary accounts"
        if span is not None:
            text += f" within {_hours(span)} hours"
        return text + ". Parallel split routing that reconverges downstream is consistent with layering or channel diversification."

    if pattern == "gather_scatter":
        incoming = _number(m, "distinct_incoming_counterparties")
        outgoing = _number(m, "distinct_outgoing_counterparties")
        amount = _number(m, "incoming_amount")
        text = "Transit hub pattern: an account received transfers from several senders and later sent transfers to other accounts"
        if incoming is not None and outgoing is not None:
            text += f" ({int(incoming)} senders and {int(outgoing)} recipients)"
        if amount is not None:
            text += f"; the reported total was ₹{amount:,.2f}"
        if span is not None:
            text += f" over {_hours(span)} hours"
        return text + ". High-turnover pass-through behavior is characteristic of transit nodes, collection hubs, or merchant settlement."

    if pattern == "bipartite":
        sources = _number(m, "source_count")
        targets = _number(m, "target_count")
        text = "Multi-party settlement mesh: multiple sending accounts shared a set of recipient accounts"
        if sources is not None and targets is not None:
            text += f" ({int(sources)} senders and {int(targets)} recipients)"
        if span is not None:
            text += f" over {_hours(span)} hours"
        return text + ". Multi-party transfer meshes warrant reviewing whether participants share corporate affiliation or commercial agreements."

    if pattern == "dense_cluster":
        count = _number(m, "account_count")
        text = "Interconnected cluster: a group of accounts made repeated transfers among members"
        if count is not None:
            text += f" involving {int(count)} intermediary accounts"
        if span is not None:
            text += f" over {_hours(span)} hours"
        return text + ". High reciprocal activity within a closed group indicates closely linked counterparties requiring entity linkage review."

    return "The available case data shows a structured transfer pattern that warrants investigation against expected customer activity."

