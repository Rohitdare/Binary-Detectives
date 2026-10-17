"""Anti-Hallucination Evidence Validator for RingTrace (Member B).

Guarantees factual integrity across all LLM-generated investigative narratives.
Parses every Account ID (ACC_xxxxx, demo_...), Transaction ID (TX_xxxxxxx),
and Case ID (CASE_xxxx) from the model's text, asserting that each referenced
entity exists in either:
  1. The initial case evidence bundle, or
  2. The result payload of a tool invoked during this investigation.

If the LLM mentions an invented or non-existent ID, the validator rejects
the answer so the agent loop can prompt for correction or trigger the deterministic fallback.
"""
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

# Regex patterns matching RingTrace identifiers
RE_ACCOUNT_ID = re.compile(r"\b(ACC_\d+|demo_[a-zA-Z0-9_]+)\b")
RE_TRANSACTION_ID = re.compile(r"\bTX_\d+\b")
RE_CASE_ID = re.compile(r"\bCASE_[a-zA-Z0-9_]{4,16}\b")
RE_SAR_ID = re.compile(r"\bSAR_[A-Za-z0-9_-]+\b")
RE_RUPEE_AMOUNT = re.compile(r"(?:₹|\bINR\s*|\bRs\.?\s*)(\d[\d,]*(?:\.\d{1,2})?)", re.I)


@dataclass
class ValidationResult:
    """Outcome of validating an agent narrative against evidence."""
    is_valid: bool
    hallucinated_ids: List[str] = field(default_factory=list)
    referenced_accounts: List[str] = field(default_factory=list)
    referenced_transactions: List[str] = field(default_factory=list)
    referenced_cases: List[str] = field(default_factory=list)
    hallucinated_amounts: List[str] = field(default_factory=list)
    jargon_terms: List[str] = field(default_factory=list)
    error_message: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "is_valid": self.is_valid,
            "hallucinated_ids": self.hallucinated_ids,
            "referenced_accounts": self.referenced_accounts,
            "referenced_transactions": self.referenced_transactions,
            "referenced_cases": self.referenced_cases,
            "hallucinated_amounts": self.hallucinated_amounts,
            "jargon_terms": self.jargon_terms,
            "error_message": self.error_message,
        }


def extract_referenced_ids(text: str) -> Dict[str, List[str]]:
    """Extract all accounts, transactions, and case IDs mentioned in text."""
    if not text:
        return {"accounts": [], "transactions": [], "cases": []}

    accounts = sorted(list(set(RE_ACCOUNT_ID.findall(text))))
    transactions = sorted(list(set(RE_TRANSACTION_ID.findall(text))))
    cases = sorted(list(set(RE_CASE_ID.findall(text))))

    return {
        "accounts": accounts,
        "transactions": transactions,
        "cases": cases,
    }


def validate_narrative(
    text: str,
    allowed_accounts: Set[str],
    allowed_transactions: Set[str],
    allowed_cases: Optional[Set[str]] = None,
    current_case_id: Optional[str] = None,
    allowed_sar_ids: Optional[Set[str]] = None,
    allowed_amounts: Optional[Set[Any]] = None,
) -> ValidationResult:
    """Validate that every entity ID in text is authorized by known evidence.

    Args:
        text: The prose narrative or finding text written by the model.
        allowed_accounts: Set of account IDs that appeared in tool outputs or initial case.
        allowed_transactions: Set of transaction IDs from tool outputs or initial case.
        allowed_cases: Set of case IDs returned by tools (e.g. similar cases).
        current_case_id: The ID of the case currently being investigated.

    Returns:
        ValidationResult indicating validity, list of hallucinated IDs, and error message.
    """
    refs = extract_referenced_ids(text)
    ref_accounts = refs["accounts"]
    ref_txs = refs["transactions"]
    ref_cases = refs["cases"]
    ref_sars = sorted(set(RE_SAR_ID.findall(text or "")))

    valid_cases = set(allowed_cases or set())
    if current_case_id:
        valid_cases.add(current_case_id)

    hallucinated: List[str] = []

    # Check Accounts
    for acc in ref_accounts:
        if acc not in allowed_accounts:
            hallucinated.append(acc)

    # Check Transactions
    for tx in ref_txs:
        if tx not in allowed_transactions:
            hallucinated.append(tx)

    # Check Cases
    for cid in ref_cases:
        if cid not in valid_cases:
            hallucinated.append(cid)

    valid_sars = set(allowed_sar_ids or set())
    for sar_id in ref_sars:
        if sar_id not in valid_sars:
            hallucinated.append(sar_id)

    hallucinated_amounts: List[str] = []
    if allowed_amounts is not None:
        from app.agent.evidence import normalize_amount
        normalized_allowed = {normalize_amount(value) for value in allowed_amounts}
        normalized_allowed.discard(None)
        for amount_text in RE_RUPEE_AMOUNT.findall(text or ""):
            normalized = normalize_amount(amount_text)
            if normalized is not None and normalized not in normalized_allowed:
                hallucinated_amounts.append(amount_text)

    jargon_terms: List[str] = []

    if hallucinated or hallucinated_amounts or jargon_terms:
        reasons = []
        if hallucinated:
            reasons.append(f"unverified IDs: {', '.join(hallucinated)}")
        if hallucinated_amounts:
            reasons.append(f"unverified amounts: {', '.join(hallucinated_amounts)}")
        if jargon_terms:
            reasons.append(f"technical terms: {', '.join(jargon_terms)}")
        error_msg = (
            "Evidence validation failed: " + "; ".join(reasons) + "."
        )
        return ValidationResult(
            is_valid=False,
            hallucinated_ids=hallucinated,
            referenced_accounts=ref_accounts,
            referenced_transactions=ref_txs,
            referenced_cases=ref_cases,
            hallucinated_amounts=hallucinated_amounts,
            jargon_terms=jargon_terms,
            error_message=error_msg,
        )

    return ValidationResult(
        is_valid=True,
        hallucinated_ids=[],
        referenced_accounts=ref_accounts,
        referenced_transactions=ref_txs,
        referenced_cases=ref_cases,
        hallucinated_amounts=[],
        jargon_terms=[],
        error_message=None,
    )


def validate_evidence_ids(text: str, evidence_store: Any) -> ValidationResult:
    """Validate IDs, SAR IDs, rupee amounts, and plain language against tool evidence."""
    result = validate_narrative(
        text=text,
        allowed_accounts=set(evidence_store.account_ids),
        allowed_transactions=set(evidence_store.tx_ids),
        allowed_cases=set(evidence_store.case_ids),
        allowed_sar_ids=set(evidence_store.sar_ids),
        allowed_amounts=set(evidence_store.amounts),
    )
    try:
        from app.agent.plain_language import find_jargon
    except ImportError:
        from backend.app.agent.plain_language import find_jargon
    jargon_terms = find_jargon(text or "")
    if jargon_terms:
        result.is_valid = False
        result.jargon_terms = jargon_terms
        result.error_message = (result.error_message or "Evidence validation failed") + "; technical terms: " + ", ".join(jargon_terms)
    return result
