"""Deterministic grouping and idempotent memory-graph persistence for cases."""
import hashlib
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional

try:
    from app.cases.scorer import score_case
    from app.db import FalkorDBClient
    from app.queries import GET_ACCOUNT_TYPES_BY_IDS, UPSERT_CASES, UPSERT_CASE_HITS
except ImportError:
    from backend.app.cases.scorer import score_case
    from backend.app.db import FalkorDBClient
    from backend.app.queries import GET_ACCOUNT_TYPES_BY_IDS, UPSERT_CASES, UPSERT_CASE_HITS


class HitGroupResult(list):
    """List of grouped hit clusters augmented with component metadata."""

    def __init__(
        self,
        groups: List[Dict[str, Any]],
        non_case_generating_hit_ids: Optional[List[str]] = None,
        skipped_oversized_hit_ids: Optional[List[str]] = None,
    ):
        super().__init__(groups)
        self.non_case_generating_hit_ids = non_case_generating_hit_ids or []
        self.skipped_oversized_hit_ids = skipped_oversized_hit_ids or []


def _hit_account_ids(hit: Mapping[str, Any]) -> set[str]:
    raw = hit.get("account_ids")
    if raw is None:
        raw = hit.get("accounts")
    if not raw:
        return set()
    return {str(account) for account in raw if account}


def _hit_tx_ids(hit: Mapping[str, Any]) -> set[str]:
    raw = hit.get("tx_ids")
    if raw is None:
        raw = hit.get("canonical_edge_sequence")
    ids = set()
    if raw:
        ids.update(str(t) for t in raw if t)
    for tx in hit.get("transactions", []):
        if isinstance(tx, dict) and tx.get("tx_id"):
            ids.add(str(tx["tx_id"]))
    return ids


def group_hits(
    hits: Iterable[Mapping[str, Any]],
    max_accounts: int = 60,
    include_hub_only: bool = False,
) -> HitGroupResult:
    """Group detector hits sharing accounts using union-find, capped at max_accounts.

    - Merges hits that share one or more account IDs (transitive connected components).
    - Keeps unrelated hits in separate groups.
    - Preserves every original hit ID, transaction ID, pattern, measurement, and explanation.
    - Does not create duplicate evidence when combining hits.
    - Partitions components under max_accounts (default 60); tracks oversized hits.
    - Produces deterministic grouping results for identical inputs.
    """
    if not 1 <= max_accounts <= 100:
        raise ValueError("max_accounts must be between 1 and 100")

    rows = [dict(hit) for hit in hits]
    if not rows:
        return HitGroupResult([])

    parent = list(range(len(rows)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    owner: Dict[str, int] = {}
    for index, hit in enumerate(rows):
        for account_id in _hit_account_ids(hit):
            if account_id in owner:
                left, right = find(index), find(owner[account_id])
                if left != right:
                    parent[max(left, right)] = min(left, right)
            else:
                owner[account_id] = index

    components: Dict[int, List[dict]] = defaultdict(list)
    for index, hit in enumerate(rows):
        components[find(index)].append(hit)

    packs: List[List[dict]] = []
    non_case_hit_ids: List[str] = []
    oversized_hit_ids: List[str] = []

    for root in sorted(components.keys()):
        component = components[root]
        if not include_hub_only and all(hit.get("pattern") == "hub_account" for hit in component):
            non_case_hit_ids.extend(str(hit.get("hit_id", "")) for hit in component if hit.get("hit_id"))
            continue

        packs_in_component: List[List[dict]] = []
        sorted_hits = sorted(
            component,
            key=lambda item: (
                str(item.get("pattern", "")),
                str(item.get("hit_id", "")),
                sorted(_hit_account_ids(item)),
            ),
        )

        for hit in sorted_hits:
            accounts = _hit_account_ids(hit)
            if len(accounts) > max_accounts:
                if hit.get("hit_id"):
                    oversized_hit_ids.append(str(hit["hit_id"]))
                continue

            destination = next(
                (
                    pack
                    for pack in packs_in_component
                    if len(set().union(*(_hit_account_ids(item) for item in pack), accounts)) <= max_accounts
                ),
                None,
            )
            if destination is None:
                packs_in_component.append([hit])
            else:
                destination.append(hit)

        packs.extend(packs_in_component)

    groups: List[Dict[str, Any]] = []
    for pack in packs:
        accounts = sorted(set().union(*(_hit_account_ids(hit) for hit in pack)))
        all_tx_ids = set()
        tx_by_id: Dict[str, Dict[str, Any]] = {}
        for hit in pack:
            all_tx_ids.update(_hit_tx_ids(hit))
            for tx in hit.get("transactions", []):
                if isinstance(tx, dict) and tx.get("tx_id"):
                    all_tx_ids.add(str(tx["tx_id"]))
                    tx_by_id[str(tx["tx_id"])] = dict(tx)

        patterns = sorted({str(hit.get("pattern", "unknown")) for hit in pack})
        stable_key = hashlib.sha256("\0".join(accounts).encode("utf-8")).hexdigest()[:12]
        groups.append({
            "group_id": f"GRP_{stable_key}",
            "account_ids": accounts,
            "account_count": len(accounts),
            "tx_ids": sorted(all_tx_ids),
            "tx_count": len(all_tx_ids),
            "patterns": patterns,
            "hits": pack,
            "hit_ids": [str(hit.get("hit_id", "")) for hit in pack if hit.get("hit_id")],
            "transactions": sorted(
                tx_by_id.values(),
                key=lambda tx: (int(tx.get("ts", 0) or 0), str(tx.get("tx_id", ""))),
            ),
        })

    groups.sort(key=lambda g: (-g["account_count"], -g["tx_count"], g["group_id"]))
    return HitGroupResult(groups, non_case_hit_ids, oversized_hit_ids)


def build_cases(
    hits: Iterable[Mapping[str, Any]],
    account_types: Optional[Mapping[str, str]] = None,
    max_accounts: int = 60,
) -> Dict[str, Any]:
    """Merge hits sharing accounts, then split connected groups under the account cap."""
    account_types = account_types or {}
    grouped = group_hits(hits, max_accounts=max_accounts, include_hub_only=False)

    cases = []
    for group in grouped:
        pack = group["hits"]
        accounts = group["account_ids"]
        tx_by_id = {str(tx["tx_id"]): tx for tx in group["transactions"] if tx.get("tx_id")}
        patterns = group["patterns"]

        score = score_case(pack, tx_by_id.values(), len(accounts), account_types)
        type_counts = Counter(account_types.get(item, "unknown") for item in accounts)
        account_mix = ",".join(f"{name}:{type_counts[name]}" for name in sorted(type_counts))
        n_accounts = len(accounts)
        size_bucket = "1-5" if n_accounts <= 5 else "6-15" if n_accounts <= 15 else "16-30" if n_accounts <= 30 else "31-60"
        similarity_signature = f"{'|'.join(patterns)}:{account_mix}:{size_bucket}"
        stable_key = hashlib.sha256("\0".join(accounts).encode("utf-8")).hexdigest()[:12]
        timestamps = [int(tx["ts"]) for tx in tx_by_id.values() if tx.get("ts") is not None]
        case_id = f"CASE_{stable_key}"
        cases.append({
            "case_id": case_id,
            "signature": similarity_signature,
            "status": "open",
            "severity": score["severity_label"],
            "score": score["total"],
            "score_breakdown": {key: score[key] for key in ("severity", "amount", "velocity", "account_count", "corroboration", "total")},
            "patterns": patterns,
            "account_ids": accounts,
            "account_types": {account_id: account_types.get(account_id, "unknown") for account_id in accounts},
            "account_count": len(accounts),
            "tx_count": len(tx_by_id),
            "total_amount": score["total_amount"],
            "first_ts": datetime.fromtimestamp(min(timestamps), timezone.utc).isoformat().replace("+00:00", "Z") if timestamps else None,
            "last_ts": datetime.fromtimestamp(max(timestamps), timezone.utc).isoformat().replace("+00:00", "Z") if timestamps else None,
            "similar_case_count": 0,
            "updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "hits": pack,
            "transactions": group["transactions"],
        })
    cases.sort(key=lambda case: (-case["score"], case["case_id"]))
    return {
        "cases": cases,
        "non_case_generating_hit_ids": grouped.non_case_generating_hit_ids,
        "skipped_oversized_hit_ids": grouped.skipped_oversized_hit_ids,
    }


def persist_cases(cases: Iterable[Mapping[str, Any]], db: Optional[FalkorDBClient] = None,
                  graph_name: str = "memory") -> int:
    """Upsert Member A owned Case, Hit and AccountRef records into memory graph."""
    rows = list(cases)
    if not rows:
        return 0
    client = db or FalkorDBClient()
    case_rows = []
    hit_rows = []
    for case in rows:
        summary_payload = {key: value for key, value in case.items() if key not in {"hits", "transactions"}}
        case_rows.append({
            "case_id": case["case_id"], "signature": case["signature"], "score": case["score"],
            "severity": case["severity"], "patterns": case["patterns"], "updated_at": case["updated_at"],
            "account_ids": case["account_ids"], "payload": json.dumps(summary_payload, sort_keys=True),
        })
        for hit in case.get("hits", []):
            measurements = hit.get("measurements", {})
            measurements_str = (
                json.dumps(measurements, sort_keys=True)
                if isinstance(measurements, (dict, list))
                else str(measurements or "{}")
            )
            hit_rows.append({
                "case_id": case["case_id"],
                "hit_id": hit["hit_id"],
                "pattern": hit["pattern"],
                "tx_ids": hit.get("tx_ids", []),
                "account_ids": hit.get("account_ids", []),
                "measurements": measurements_str,
                "payload": json.dumps(hit, sort_keys=True),
            })
    if case_rows:
        client.execute_query(graph_name, UPSERT_CASES, {"rows": case_rows}, caller="cases:upsert_cases")
    if hit_rows:
        client.execute_query(graph_name, UPSERT_CASE_HITS, {"rows": hit_rows}, caller="cases:upsert_hits")
    return len(case_rows)


def load_account_types(account_ids: Iterable[str], db: Optional[FalkorDBClient] = None,
                       graph_name: str = "txn") -> Dict[str, str]:
    ids = sorted(set(account_ids))
    if not ids:
        return {}
    client = db or FalkorDBClient()
    result = client.execute_query(graph_name, GET_ACCOUNT_TYPES_BY_IDS, {"account_ids": ids}, caller="cases:account_types")
    return {str(row[0]): str(row[1] or "unknown") for row in (result.result_set or [])}
