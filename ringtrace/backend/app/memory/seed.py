"""Hand-made seed cases for the memory graph (Day 1, before Member A's case builder).

Each seed case lists only real transaction IDs from the `txn` graph. At seed time
we read those transactions back from `txn`, derive the accounts and measurements
from them, and write Case / Hit / AccountRef nodes. If any transaction is missing,
seeding stops with `SeedError` instead of writing made-up data.

Seed cases (all from the seed-42 simulator run, found by reading `txn` only,
never the `labels` graph):

  CASE_0001  4-hop money cycle among personal accounts, closes in ~20h and
             keeps ~84% of the amount. Should look suspicious.
  CASE_0002  Payroll account ACC_02975 pays 15 people within an hour on
             2026-01-05. A benign look-alike: the demo dismisses it.
  CASE_0003  The same payroll account pays the same 15 people on 2026-02-04.
             Used to show "seen before" once CASE_0002 has been dismissed.

Scores are hand-assigned for the seed only; Member A's scorer replaces them.
"""
import hashlib
import json
from collections import Counter
from typing import Any, Dict, List, Optional

try:
    from app.db import FalkorDBClient
    from app.memory.graph import MEMORY_GRAPH, TXN_GRAPH, init_memory_graph, wipe_memory_graph
    from app.queries_memory import (
        LIST_CASES_SUMMARY,
        SEED_FETCH_TXS,
        SEED_UPSERT_ACCOUNT_REFS,
        SEED_UPSERT_CASE,
        SEED_UPSERT_HIT,
    )
except ImportError:
    from backend.app.db import FalkorDBClient
    from backend.app.memory.graph import MEMORY_GRAPH, TXN_GRAPH, init_memory_graph, wipe_memory_graph
    from backend.app.queries_memory import (
        LIST_CASES_SUMMARY,
        SEED_FETCH_TXS,
        SEED_UPSERT_ACCOUNT_REFS,
        SEED_UPSERT_CASE,
        SEED_UPSERT_HIT,
    )


class SeedError(Exception):
    """Raised when a seed case refers to data that does not exist in `txn`."""


SEED_CASES: List[Dict[str, Any]] = [
    {
        "case_id": "CASE_0001",
        "updated_at": "2026-02-01T21:00:00Z",
        "score_breakdown": {"severity": 30, "amount": 10, "velocity": 15,
                            "account_count": 5, "corroboration": 12},
        "hits": [
            {"pattern": "cycle",
             "tx_ids": ["TX_0014054", "TX_0014056", "TX_0014344", "TX_0014580"]},
        ],
    },
    {
        "case_id": "CASE_0002",
        "updated_at": "2026-01-05T11:30:00Z",
        "score_breakdown": {"severity": 15, "amount": 20, "velocity": 12,
                            "account_count": 8, "corroboration": 0},
        "hits": [
            {"pattern": "fan_out",
             "tx_ids": ["TX_0002386", "TX_0002401", "TX_0002473", "TX_0002483", "TX_0002492",
                        "TX_0002503", "TX_0002516", "TX_0002527", "TX_0002535", "TX_0002550",
                        "TX_0002556", "TX_0002559", "TX_0002597", "TX_0002623", "TX_0002663"]},
        ],
    },
    {
        "case_id": "CASE_0003",
        "updated_at": "2026-02-04T11:30:00Z",
        "score_breakdown": {"severity": 15, "amount": 20, "velocity": 12,
                            "account_count": 8, "corroboration": 0},
        "hits": [
            {"pattern": "fan_out",
             "tx_ids": ["TX_0015840", "TX_0015845", "TX_0015899", "TX_0015904", "TX_0015938",
                        "TX_0015942", "TX_0015965", "TX_0015985", "TX_0016014", "TX_0016026",
                        "TX_0016075", "TX_0016080", "TX_0016094", "TX_0016099", "TX_0016113"]},
        ],
    },
]


# ---------------------------------------------------------------------------
# Pure helpers (no database): easy to unit test
# ---------------------------------------------------------------------------

def hit_id_for(pattern: str, tx_ids: List[str]) -> str:
    """Stable hit id, e.g. HIT_cycle_6d93455ad5 (same txs -> same id)."""
    digest = hashlib.sha256(",".join(sorted(tx_ids)).encode("utf-8")).hexdigest()[:10]
    return f"HIT_{pattern}_{digest}"


def size_bucket(n_accounts: int) -> str:
    return "s" if n_accounts <= 5 else ("m" if n_accounts <= 20 else "l")


def compute_signature(patterns: List[str], account_types: Dict[str, str]) -> str:
    """Sorted patterns + account-type mix + size bucket.

    Member A owns the official signature; this mirrors the format agreed in the
    plan so seed cases and real cases compare the same way.
    Example: 'fan_out|payroll:1,personal:15|m'
    """
    mix = Counter(account_types.values())
    mix_str = ",".join(f"{t}:{n}" for t, n in sorted(mix.items()))
    return f"{'+'.join(sorted(set(patterns)))}|{mix_str}|{size_bucket(len(account_types))}"


def _cycle_measurements(txs: List[Dict[str, Any]]) -> Dict[str, Any]:
    txs = sorted(txs, key=lambda t: t["ts"])
    amounts = [t["amount"] for t in txs]
    ordered = all(txs[i]["dst"] == txs[i + 1]["src"] for i in range(len(txs) - 1)) \
        and txs[-1]["dst"] == txs[0]["src"]
    return {
        "length": len(txs),
        "duration_seconds": txs[-1]["ts"] - txs[0]["ts"],
        "amount_conservation_ratio": round(min(amounts) / max(amounts), 4),
        "is_time_ordered": ordered,
        "total_amount": round(sum(amounts), 2),
        "suspicious": True,
    }


def _fan_out_measurements(txs: List[Dict[str, Any]]) -> Dict[str, Any]:
    amounts = [t["amount"] for t in txs]
    ts = [t["ts"] for t in txs]
    return {
        "fan_out_degree": len({t["dst"] for t in txs}),
        "duration_seconds": max(ts) - min(ts),
        "total_amount": round(sum(amounts), 2),
        "min_amount": round(min(amounts), 2),
        "max_amount": round(max(amounts), 2),
        "origin_type": txs[0]["src_type"],
        "suspicious": True,
    }


def _explain(pattern: str, m: Dict[str, Any], txs: List[Dict[str, Any]]) -> str:
    hours = m["duration_seconds"] / 3600
    if pattern == "cycle":
        start = sorted(txs, key=lambda t: t["ts"])[0]["src"]
        return (f"Funds left {start} and returned through {m['length']} accounts in {hours:.1f}h, "
                f"keeping {m['amount_conservation_ratio']:.0%} of the amount.")
    if pattern == "fan_out":
        return (f"{txs[0]['src']} ({m['origin_type']}) sent Rs {m['total_amount']:,.2f} to "
                f"{m['fan_out_degree']} accounts within {hours:.1f}h.")
    return f"{pattern} pattern across {len(txs)} transactions."


def _roles(pattern: str, txs: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    """Structural roles computed from the edges (never from ground-truth labels)."""
    roles: Dict[str, set] = {}
    if pattern == "cycle":
        first = sorted(txs, key=lambda t: t["ts"])[0]["src"]
        for t in txs:
            roles.setdefault(t["src"], set()).add("origin" if t["src"] == first else "cycle_member")
    elif pattern == "fan_out":
        for t in txs:
            roles.setdefault(t["src"], set()).add("origin")
            roles.setdefault(t["dst"], set()).add("recipient")
    else:
        for t in txs:
            roles.setdefault(t["src"], set()).add("sender")
            roles.setdefault(t["dst"], set()).add("receiver")
    return {k: sorted(v) for k, v in roles.items()}


_MEASURE = {"cycle": _cycle_measurements, "fan_out": _fan_out_measurements}


# ---------------------------------------------------------------------------
# Database work
# ---------------------------------------------------------------------------

def _fetch_txs(db: FalkorDBClient, txn_graph: str, tx_ids: List[str]) -> List[Dict[str, Any]]:
    res = db.execute_query(txn_graph, SEED_FETCH_TXS, {"tx_ids": tx_ids}, caller="memory:seed_fetch_txs")
    rows = [{"tx_id": r[0], "src": r[1], "src_type": r[2], "dst": r[3], "dst_type": r[4],
             "amount": float(r[5]), "ts": int(r[6]), "tx_type": r[7]} for r in res.result_set]
    missing = sorted(set(tx_ids) - {r["tx_id"] for r in rows})
    if missing:
        raise SeedError(f"Transactions not found in '{txn_graph}': {missing}. "
                        f"Load the seed-42 simulator data first (load_falkordb.py).")
    return rows


def build_case(db: FalkorDBClient, txn_graph: str, spec: Dict[str, Any]) -> Dict[str, Any]:
    """Turn a seed spec into the full case record by reading its transactions from `txn`."""
    hits, account_types, account_roles, patterns = [], {}, {}, []
    for h in spec["hits"]:
        pattern = h["pattern"]
        txs = _fetch_txs(db, txn_graph, h["tx_ids"])
        measurements = _MEASURE.get(pattern, lambda t: {"suspicious": True})(txs)
        account_ids = sorted({t["src"] for t in txs} | {t["dst"] for t in txs})
        for t in txs:
            account_types[t["src"]] = t["src_type"]
            account_types[t["dst"]] = t["dst_type"]
        for acc, rs in _roles(pattern, txs).items():
            account_roles.setdefault(acc, set()).update(rs)
        patterns.append(pattern)
        hits.append({
            "hit_id": hit_id_for(pattern, h["tx_ids"]),
            "pattern": pattern,
            "account_ids": account_ids,
            "tx_ids": sorted(h["tx_ids"]),
            "measurements": measurements,
            "explanation": _explain(pattern, measurements, txs),
        })
    breakdown = dict(spec["score_breakdown"])
    breakdown["total"] = sum(v for k, v in breakdown.items() if k != "total")
    return {
        "case_id": spec["case_id"],
        "patterns": sorted(set(patterns)),
        "score": breakdown["total"],
        "score_breakdown": breakdown,
        "status": "open",
        "signature": compute_signature(patterns, account_types),
        "updated_at": spec["updated_at"],
        "hits": hits,
        "accounts": [{"id": a, "type": account_types[a], "roles": sorted(account_roles.get(a, []))}
                     for a in sorted(account_types)],
    }


def write_case(db: FalkorDBClient, memory_graph: str, case: Dict[str, Any]) -> None:
    db.execute_query(memory_graph, SEED_UPSERT_CASE, {
        "case_id": case["case_id"],
        "patterns": case["patterns"],
        "score": case["score"],
        "score_breakdown": json.dumps(case["score_breakdown"]),
        "status": case["status"],
        "signature": case["signature"],
        "updated_at": case["updated_at"],
        "source": "seed",
    }, caller="memory:seed_case")
    for h in case["hits"]:
        db.execute_query(memory_graph, SEED_UPSERT_HIT, {
            "case_id": case["case_id"],
            "hit_id": h["hit_id"],
            "pattern": h["pattern"],
            "account_ids": h["account_ids"],
            "tx_ids": h["tx_ids"],
            "measurements": json.dumps(h["measurements"]),
            "explanation": h["explanation"],
        }, caller="memory:seed_hit")
    db.execute_query(memory_graph, SEED_UPSERT_ACCOUNT_REFS,
                     {"case_id": case["case_id"], "accounts": case["accounts"]},
                     caller="memory:seed_account_refs")


def seed_memory(
    db: Optional[FalkorDBClient] = None,
    memory_graph: str = MEMORY_GRAPH,
    txn_graph: str = TXN_GRAPH,
    cases: Optional[List[Dict[str, Any]]] = None,
    reset: bool = False,
) -> List[Dict[str, Any]]:
    """Seed the memory graph. Builds every case first, then writes, so a missing
    transaction leaves the memory graph untouched. Returns the built cases."""
    client = db or FalkorDBClient()
    built = [build_case(client, txn_graph, spec) for spec in (cases or SEED_CASES)]
    if reset:
        wipe_memory_graph(client, memory_graph)
    init_memory_graph(client, memory_graph)
    for case in built:
        write_case(client, memory_graph, case)
    return built


def list_case_summaries(db: Optional[FalkorDBClient] = None, memory_graph: str = MEMORY_GRAPH) -> List[Dict[str, Any]]:
    client = db or FalkorDBClient()
    res = client.execute_query(memory_graph, LIST_CASES_SUMMARY, caller="memory:list_cases")
    return [{"case_id": r[0], "patterns": r[1], "score": r[2], "status": r[3], "signature": r[4],
             "account_count": r[5], "hit_count": r[6]} for r in res.result_set]
