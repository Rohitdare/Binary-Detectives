"""The 8 restricted MCP Graph Tools for RingTrace (Member B).

These functions serve as the strict, secure boundary for the autonomous investigation
agent. The LLM is never allowed to execute arbitrary Cypher queries. Instead, it
interacts solely by calling these 8 validated Python functions.

Tool catalog:
  1. get_case(case_id) -> Reads case metadata, score breakdown, hits, and accounts from memory.
  2. expand_neighborhood(account_id, hops, limit) -> Queries txn for 1- or 2-hop transfer graph.
  3. trace_funds(account_id, direction, max_hops, window_seconds) -> Follows money flow BFS.
  4. shortest_path(src, dst) -> Evaluates bounded shortest path between two accounts in txn.
  5. run_algorithm(name, scope) -> Runs PageRank or community detection on txn accounts.
  6. find_similar_cases(case_id, limit) -> Matches historical cases by shared accounts or signature.
  7. record_finding(case_id, text, evidence_ids, investigation_id) -> Writes finding to memory.
  8. propose_action(case_id, type, reason, investigation_id) -> Proposes pending action in memory.

Safety & Design Guarantees:
  - All return payloads are pure JSON-serializable dictionaries.
  - Every tool returns a human-readable `summary` and an `evidence` dict (`account_ids`, `tx_ids`).
  - No tool touches the `labels` evaluation graph.
  - Cypher queries live exclusively in the queries layer or are cleanly parameterized.
"""
import hashlib
import json
import time
import uuid
from typing import Any, Dict, List, Optional, Set, Tuple

try:
    from app.db import FalkorDBClient
    from app.memory.graph import MEMORY_GRAPH, TXN_GRAPH
    from app.queries_memory import (
        FIND_SIMILAR_CASES_SAME_SIGNATURE,
        FIND_SIMILAR_CASES_SHARED_ACCOUNTS,
        GET_CASE_ACCOUNTS,
        GET_CASE_BY_ID,
        GET_CASE_DECISIONS,
        GET_CASE_HITS,
        LINK_FINDING_TO_INVESTIGATION,
        PROPOSE_ACTION_CYPHER,
        RECORD_FINDING_CYPHER,
    )
except ImportError:
    from backend.app.db import FalkorDBClient
    from backend.app.memory.graph import MEMORY_GRAPH, TXN_GRAPH
    from backend.app.queries_memory import (
        FIND_SIMILAR_CASES_SAME_SIGNATURE,
        FIND_SIMILAR_CASES_SHARED_ACCOUNTS,
        GET_CASE_ACCOUNTS,
        GET_CASE_BY_ID,
        GET_CASE_DECISIONS,
        GET_CASE_HITS,
        LINK_FINDING_TO_INVESTIGATION,
        PROPOSE_ACTION_CYPHER,
        RECORD_FINDING_CYPHER,
    )

VALID_ACTION_TYPES = {"escalate", "monitor", "dismiss", "draft_sar"}
VALID_ALGORITHMS = {"pagerank", "community", "labelpropagation", "connected_components", "wcc"}


# ---------------------------------------------------------------------------
# Tool 1: get_case
# ---------------------------------------------------------------------------

def get_case(
    case_id: str,
    db: Optional[FalkorDBClient] = None,
    memory_graph: str = MEMORY_GRAPH,
) -> Dict[str, Any]:
    """Fetch case profile, score breakdown, detector hits, and involved accounts from memory."""
    if not case_id or not isinstance(case_id, str):
        return {
            "status": "error",
            "error": "Invalid case_id provided",
            "summary": "Case ID must be a non-empty string.",
            "evidence": {"account_ids": [], "tx_ids": []},
        }

    client = db or FalkorDBClient()
    try:
        case_res = client.execute_query(
            memory_graph,
            GET_CASE_BY_ID,
            {"case_id": case_id.strip()},
            caller="tool:get_case:meta",
        )
        if not case_res or not case_res.result_set:
            return {
                "status": "error",
                "error": f"Case {case_id} not found in memory graph '{memory_graph}'",
                "summary": f"Case '{case_id}' does not exist.",
                "evidence": {"account_ids": [], "tx_ids": []},
            }

        row = case_res.result_set[0]
        cid, status, score, raw_breakdown, patterns, signature, updated_at = row
        score_breakdown = json.loads(raw_breakdown) if isinstance(raw_breakdown, str) else (raw_breakdown or {})

        # Fetch Hits
        hits_res = client.execute_query(
            memory_graph,
            GET_CASE_HITS,
            {"case_id": case_id},
            caller="tool:get_case:hits",
        )
        hits = []
        evidence_tx_ids: Set[str] = set()
        evidence_acc_ids: Set[str] = set()

        for h in (hits_res.result_set if hits_res else []):
            hid, pat, acc_ids, tx_ids, raw_meas, expl = h
            meas = json.loads(raw_meas) if isinstance(raw_meas, str) else (raw_meas or {})
            acc_list = acc_ids or []
            tx_list = tx_ids or []
            evidence_acc_ids.update(acc_list)
            evidence_tx_ids.update(tx_list)
            hits.append({
                "hit_id": hid,
                "pattern": pat,
                "account_ids": acc_list,
                "tx_ids": tx_list,
                "measurements": meas,
                "explanation": expl,
            })

        # Fetch Accounts
        acc_res = client.execute_query(
            memory_graph,
            GET_CASE_ACCOUNTS,
            {"case_id": case_id},
            caller="tool:get_case:accounts",
        )
        accounts = []
        for a in (acc_res.result_set if acc_res else []):
            aid, atype, aroles = a
            evidence_acc_ids.add(aid)
            accounts.append({
                "id": aid,
                "type": atype,
                "roles": aroles or [],
            })

        # Fetch Decisions
        dec_res = client.execute_query(
            memory_graph,
            GET_CASE_DECISIONS,
            {"case_id": case_id},
            caller="tool:get_case:decisions",
        )
        decisions = [
            {"decision_id": d[0], "decision": d[1], "note": d[2], "actor": d[3], "ts": d[4]}
            for d in (dec_res.result_set if dec_res else [])
        ]

        summary = (
            f"Case {case_id} ({status}, score {score}/100) involving {len(accounts)} accounts "
            f"and {len(hits)} detector hits ({', '.join(patterns or [])})."
        )

        return {
            "status": "success",
            "case_id": cid,
            "case_status": status,
            "score": score,
            "score_breakdown": score_breakdown,
            "patterns": patterns or [],
            "signature": signature,
            "updated_at": updated_at,
            "hits": hits,
            "accounts": accounts,
            "decisions": decisions,
            "summary": summary,
            "evidence": {
                "account_ids": sorted(evidence_acc_ids),
                "tx_ids": sorted(evidence_tx_ids),
            },
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "summary": f"Failed to retrieve case {case_id}: {e}",
            "evidence": {"account_ids": [], "tx_ids": []},
        }


# ---------------------------------------------------------------------------
# Tool 2: expand_neighborhood
# ---------------------------------------------------------------------------

def expand_neighborhood(
    account_id: str,
    hops: int = 1,
    limit: int = 50,
    db: Optional[FalkorDBClient] = None,
    txn_graph: str = TXN_GRAPH,
) -> Dict[str, Any]:
    """Expand the 1-hop or 2-hop transfer neighborhood around an account in the txn graph."""
    if not account_id or not isinstance(account_id, str):
        return {
            "status": "error",
            "error": "Invalid account_id",
            "summary": "Must provide a valid string account ID.",
            "evidence": {"account_ids": [], "tx_ids": []},
        }

    clamped_hops = max(1, min(int(hops), 2))
    clamped_limit = max(1, min(int(limit), 100))
    client = db or FalkorDBClient()

    try:
        if clamped_hops == 1:
            q = """
            MATCH (src:Account)-[t:SENT]->(dst:Account)
            WHERE src.id = $aid OR dst.id = $aid
            RETURN src.id, src.type, src.community,
                   dst.id, dst.type, dst.community,
                   t.tx_id, t.amount, t.ts, t.step, t.tx_type
            ORDER BY t.ts DESC
            LIMIT $limit
            """
            params = {"aid": account_id.strip(), "limit": clamped_limit}
        else:
            q = """
            MATCH (origin:Account {id: $aid})-[t1:SENT]-(hop1:Account)-[t2:SENT]-(hop2:Account)
            WHERE hop2.id <> $aid
            WITH DISTINCT t2.tx_id AS tid, startNode(t2) AS s, endNode(t2) AS d, t2
            RETURN s.id, s.type, s.community,
                   d.id, d.type, d.community,
                   t2.tx_id, t2.amount, t2.ts, t2.step, t2.tx_type
            ORDER BY t2.ts DESC
            LIMIT $limit
            """
            params = {"aid": account_id.strip(), "limit": clamped_limit}

        res = client.execute_query(txn_graph, q, params, caller="tool:expand_neighborhood")
        nodes_dict: Dict[str, Dict[str, Any]] = {}
        edges: List[Dict[str, Any]] = []
        evidence_acc_ids: Set[str] = {account_id.strip()}
        evidence_tx_ids: Set[str] = set()

        total_volume = 0.0
        for row in (res.result_set if res else []):
            s_id, s_type, s_comm, d_id, d_type, d_comm, tx_id, amount, ts, step, tx_type = row
            amt = float(amount)
            total_volume += amt
            evidence_acc_ids.add(s_id)
            evidence_acc_ids.add(d_id)
            evidence_tx_ids.add(tx_id)

            if s_id not in nodes_dict:
                nodes_dict[s_id] = {"id": s_id, "type": s_type, "community": s_comm, "is_target": (s_id == account_id)}
            if d_id not in nodes_dict:
                nodes_dict[d_id] = {"id": d_id, "type": d_type, "community": d_comm, "is_target": (d_id == account_id)}

            edges.append({
                "tx_id": tx_id,
                "source": s_id,
                "target": d_id,
                "amount": amt,
                "ts": int(ts),
                "step": int(step),
                "tx_type": tx_type,
            })

        summary = (
            f"Expanded {clamped_hops}-hop neighborhood for {account_id}: found {len(nodes_dict)} accounts "
            f"and {len(edges)} transfers totaling Rs {total_volume:,.2f}."
        )

        return {
            "status": "success",
            "account_id": account_id,
            "hops": clamped_hops,
            "nodes": list(nodes_dict.values()),
            "edges": edges,
            "total_nodes": len(nodes_dict),
            "total_edges": len(edges),
            "total_volume": round(total_volume, 2),
            "summary": summary,
            "evidence": {
                "account_ids": sorted(evidence_acc_ids),
                "tx_ids": sorted(evidence_tx_ids),
            },
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "summary": f"Failed to expand neighborhood for {account_id}: {e}",
            "evidence": {"account_ids": [account_id], "tx_ids": []},
        }


# ---------------------------------------------------------------------------
# Tool 3: trace_funds
# ---------------------------------------------------------------------------

def trace_funds(
    account_id: str,
    direction: str = "forward",
    max_hops: int = 3,
    window_seconds: int = 604800,
    db: Optional[FalkorDBClient] = None,
    txn_graph: str = TXN_GRAPH,
) -> Dict[str, Any]:
    """Trace funds forward (dispersal) or backward (sourcing) along chronological paths in txn."""
    if not account_id or not isinstance(account_id, str):
        return {
            "status": "error",
            "error": "Invalid account_id",
            "summary": "Must provide a valid string account ID.",
            "evidence": {"account_ids": [], "tx_ids": []},
        }

    dir_norm = direction.strip().lower()
    if dir_norm not in ("forward", "backward"):
        dir_norm = "forward"

    clamped_hops = max(1, min(int(max_hops), 4))
    clamped_window = max(3600, min(int(window_seconds), 30 * 86400))
    client = db or FalkorDBClient()

    try:
        # Step-by-step BFS ensures strict chronological ordering and prevents exponential explosions
        evidence_acc_ids: Set[str] = {account_id.strip()}
        evidence_tx_ids: Set[str] = set()
        paths: List[Dict[str, Any]] = []
        reached_accounts: Set[str] = set()
        total_amount_traced = 0.0

        # Query initial edge out/in from account_id
        if dir_norm == "forward":
            init_q = """
            MATCH (src:Account {id: $aid})-[t:SENT]->(dst:Account)
            RETURN src.id, dst.id, t.tx_id, t.amount, t.ts, t.tx_type
            ORDER BY t.ts ASC
            LIMIT 15
            """
        else:
            init_q = """
            MATCH (src:Account)-[t:SENT]->(dst:Account {id: $aid})
            RETURN src.id, dst.id, t.tx_id, t.amount, t.ts, t.tx_type
            ORDER BY t.ts DESC
            LIMIT 15
            """

        res = client.execute_query(txn_graph, init_q, {"aid": account_id.strip()}, caller="tool:trace_funds:init")
        queue: List[Tuple[List[str], List[Dict[str, Any]], int, float]] = []

        for row in (res.result_set if res else []):
            s_id, d_id, tx_id, amount, ts, tx_type = row
            amt, ts_int = float(amount), int(ts)
            evidence_acc_ids.add(s_id)
            evidence_acc_ids.add(d_id)
            evidence_tx_ids.add(tx_id)
            reached = d_id if dir_norm == "forward" else s_id
            reached_accounts.add(reached)
            total_amount_traced += amt

            tx_info = {"tx_id": tx_id, "src": s_id, "dst": d_id, "amount": amt, "ts": ts_int, "tx_type": tx_type}
            path_nodes = [s_id, d_id] if dir_norm == "forward" else [d_id, s_id]
            queue.append((path_nodes, [tx_info], ts_int, amt))
            paths.append({
                "nodes": path_nodes,
                "transactions": [tx_info],
                "start_amount": amt,
                "final_amount": amt,
                "duration_seconds": 0,
            })

        # Multi-hop progression
        hop = 1
        while hop < clamped_hops and queue:
            next_queue = []
            for curr_nodes, curr_txs, start_ts, start_amt in queue:
                last_node = curr_nodes[-1]
                last_ts = curr_txs[-1]["ts"]

                if dir_norm == "forward":
                    step_q = """
                    MATCH (src:Account {id: $aid})-[t:SENT]->(dst:Account)
                    WHERE t.ts >= $min_ts AND (t.ts - $base_ts) <= $win
                      AND dst.id <> $aid
                    RETURN src.id, dst.id, t.tx_id, t.amount, t.ts, t.tx_type
                    ORDER BY t.ts ASC
                    LIMIT 5
                    """
                    step_params = {
                        "aid": last_node,
                        "min_ts": last_ts,
                        "base_ts": start_ts,
                        "win": clamped_window,
                    }
                else:
                    step_q = """
                    MATCH (src:Account)-[t:SENT]->(dst:Account {id: $aid})
                    WHERE t.ts <= $max_ts AND ($base_ts - t.ts) <= $win
                      AND src.id <> $aid
                    RETURN src.id, dst.id, t.tx_id, t.amount, t.ts, t.tx_type
                    ORDER BY t.ts DESC
                    LIMIT 5
                    """
                    step_params = {
                        "aid": last_node,
                        "max_ts": last_ts,
                        "base_ts": start_ts,
                        "win": clamped_window,
                    }

                step_res = client.execute_query(txn_graph, step_q, step_params, caller=f"tool:trace_funds:hop_{hop}")
                for s_row in (step_res.result_set if step_res else []):
                    s_id, d_id, tx_id, amount, ts, tx_type = s_row
                    nxt_node = d_id if dir_norm == "forward" else s_id
                    if nxt_node in curr_nodes:
                        continue  # avoid trivial cycles in trace

                    amt, ts_int = float(amount), int(ts)
                    evidence_acc_ids.add(nxt_node)
                    evidence_tx_ids.add(tx_id)
                    reached_accounts.add(nxt_node)

                    tx_info = {"tx_id": tx_id, "src": s_id, "dst": d_id, "amount": amt, "ts": ts_int, "tx_type": tx_type}
                    extended_nodes = curr_nodes + [nxt_node]
                    extended_txs = curr_txs + [tx_info]
                    dur = abs(ts_int - start_ts)

                    next_queue.append((extended_nodes, extended_txs, start_ts, start_amt))
                    paths.append({
                        "nodes": extended_nodes,
                        "transactions": extended_txs,
                        "start_amount": start_amt,
                        "final_amount": amt,
                        "duration_seconds": dur,
                    })
                    if len(paths) >= 30:
                        break
                if len(paths) >= 30:
                    break
            queue = next_queue[:15]
            hop += 1

        summary = (
            f"Traced funds {dir_norm} from {account_id} up to {clamped_hops} hops (window {clamped_window // 86400}d): "
            f"reached {len(reached_accounts)} accounts across {len(paths)} paths, tracking Rs {total_amount_traced:,.2f} initial volume."
        )

        return {
            "status": "success",
            "account_id": account_id,
            "direction": dir_norm,
            "max_hops": clamped_hops,
            "window_seconds": clamped_window,
            "reached_accounts": sorted(reached_accounts),
            "paths_count": len(paths),
            "paths": paths[:15],
            "total_initial_amount": round(total_amount_traced, 2),
            "summary": summary,
            "evidence": {
                "account_ids": sorted(evidence_acc_ids),
                "tx_ids": sorted(evidence_tx_ids),
            },
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "summary": f"Failed to trace funds for {account_id}: {e}",
            "evidence": {"account_ids": [account_id], "tx_ids": []},
        }


# ---------------------------------------------------------------------------
# Tool 4: shortest_path
# ---------------------------------------------------------------------------

def shortest_path(
    src: str,
    dst: str,
    db: Optional[FalkorDBClient] = None,
    txn_graph: str = TXN_GRAPH,
) -> Dict[str, Any]:
    """Find the shortest directed transfer path between two accounts in txn (up to 6 hops)."""
    if not src or not dst or not isinstance(src, str) or not isinstance(dst, str):
        return {
            "status": "error",
            "error": "Must provide both valid src and dst account IDs",
            "summary": "Invalid source or destination account ID.",
            "evidence": {"account_ids": [], "tx_ids": []},
        }

    src_id, dst_id = src.strip(), dst.strip()
    if src_id == dst_id:
        return {
            "status": "success",
            "src": src_id,
            "dst": dst_id,
            "found": True,
            "length": 0,
            "path_nodes": [src_id],
            "path_transactions": [],
            "summary": f"Source and destination are the same account ({src_id}).",
            "evidence": {"account_ids": [src_id], "tx_ids": []},
        }

    client = db or FalkorDBClient()
    try:
        q = """
        MATCH (a:Account {id: $src}), (b:Account {id: $dst})
        RETURN shortestPath((a)-[:SENT*..6]->(b))
        """
        res = client.execute_query(txn_graph, q, {"src": src_id, "dst": dst_id}, caller="tool:shortest_path")

        if not res or not res.result_set or not res.result_set[0] or res.result_set[0][0] is None:
            return {
                "status": "success",
                "src": src_id,
                "dst": dst_id,
                "found": False,
                "length": -1,
                "path_nodes": [],
                "path_transactions": [],
                "summary": f"No directed path found from {src_id} to {dst_id} within 6 hops.",
                "evidence": {"account_ids": [src_id, dst_id], "tx_ids": []},
            }

        path_obj = res.result_set[0][0]
        # Parse FalkorDB Path object
        nodes = [{"id": n.properties.get("id"), "type": n.properties.get("type")} for n in path_obj.nodes()]
        edges = []
        evidence_tx_ids = []
        evidence_acc_ids = [n["id"] for n in nodes if n["id"]]

        for e in path_obj.edges():
            props = e.properties
            tid = props.get("tx_id")
            if tid:
                evidence_tx_ids.append(tid)
            edges.append({
                "tx_id": tid,
                "amount": float(props.get("amount", 0.0)),
                "ts": int(props.get("ts", 0)),
                "step": int(props.get("step", 0)),
                "tx_type": props.get("tx_type"),
            })

        hops = len(edges)
        total_amt = round(sum(e["amount"] for e in edges), 2)
        dur = abs(edges[-1]["ts"] - edges[0]["ts"]) if edges else 0

        summary = (
            f"Found {hops}-hop shortest path from {src_id} to {dst_id} "
            f"({' -> '.join(evidence_acc_ids)}) across {len(edges)} transfers totaling Rs {total_amt:,.2f} "
            f"spanning {dur // 3600} hours."
        )

        return {
            "status": "success",
            "src": src_id,
            "dst": dst_id,
            "found": True,
            "length": hops,
            "path_nodes": nodes,
            "path_transactions": edges,
            "duration_seconds": dur,
            "total_flow_amount": total_amt,
            "summary": summary,
            "evidence": {
                "account_ids": evidence_acc_ids,
                "tx_ids": evidence_tx_ids,
            },
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "summary": f"Error finding shortest path from {src_id} to {dst_id}: {e}",
            "evidence": {"account_ids": [src_id, dst_id], "tx_ids": []},
        }


# ---------------------------------------------------------------------------
# Tool 5: run_algorithm
# ---------------------------------------------------------------------------

def run_algorithm(
    name: str,
    scope: Optional[List[str]] = None,
    db: Optional[FalkorDBClient] = None,
    txn_graph: str = TXN_GRAPH,
) -> Dict[str, Any]:
    """Execute graph algorithms (PageRank, Community Detection, or WCC) on txn accounts."""
    algo_name = (name or "").strip().lower()
    if algo_name not in VALID_ALGORITHMS:
        return {
            "status": "error",
            "error": f"Unknown algorithm '{name}'. Supported: {sorted(VALID_ALGORITHMS)}",
            "summary": f"Unsupported algorithm '{name}'.",
            "evidence": {"account_ids": [], "tx_ids": []},
        }

    client = db or FalkorDBClient()
    scoped_set = set(scope) if scope else None

    try:
        if algo_name in ("pagerank",):
            # FalkorDB native PageRank
            q = "CALL algo.pageRank('Account', 'SENT') YIELD node, score RETURN node.id, node.type, score ORDER BY score DESC LIMIT 25"
            res = client.execute_query(txn_graph, q, caller="tool:run_algo:pagerank")
            results = []
            for row in (res.result_set if res else []):
                aid, atype, sc = row[0], row[1], float(row[2])
                if not scoped_set or aid in scoped_set:
                    results.append({"account_id": aid, "type": atype, "score": round(sc, 6)})

            # If scoped accounts weren't top 25 overall, fetch their specific rank scores
            if scoped_set:
                found_ids = {r["account_id"] for r in results}
                missing_scope = list(scoped_set - found_ids)
                if missing_scope:
                    scoped_q = """
                    UNWIND $ids AS aid
                    MATCH (a:Account {id: aid})
                    OPTIONAL MATCH (a)-[out:SENT]->()
                    OPTIONAL MATCH ()-[inc:SENT]->(a)
                    RETURN a.id, a.type, count(DISTINCT out) AS out_deg, count(DISTINCT inc) AS in_deg
                    """
                    s_res = client.execute_query(txn_graph, scoped_q, {"ids": missing_scope}, caller="tool:run_algo:scope_degrees")
                    for row in (s_res.result_set if s_res else []):
                        aid, atype, out_deg, in_deg = row
                        proxy_score = round(0.0001 * (1 + in_deg + 0.5 * out_deg), 6)
                        results.append({"account_id": aid, "type": atype, "score": proxy_score, "is_inferred": True})

            results.sort(key=lambda x: x["score"], reverse=True)
            top = results[:10]
            evidence_accs = [r["account_id"] for r in top]
            summary = (
                f"Executed PageRank on transaction graph: top hub account {top[0]['account_id']} "
                f"(score {top[0]['score']}). Analyzed {len(results)} accounts."
            )
            return {
                "status": "success",
                "algorithm": "pagerank",
                "scope_applied": bool(scope),
                "total_analyzed": len(results),
                "top_ranked": top,
                "summary": summary,
                "evidence": {"account_ids": evidence_accs, "tx_ids": []},
            }

        elif algo_name in ("community", "labelpropagation"):
            # Community partition query
            q = """
            MATCH (a:Account)
            RETURN a.id, a.type, a.community
            LIMIT 50
            """
            res = client.execute_query(txn_graph, q, caller="tool:run_algo:community")
            clusters: Dict[int, List[str]] = {}
            evidence_accs = []
            for row in (res.result_set if res else []):
                aid, atype, comm = row[0], row[1], int(row[2]) if row[2] is not None else 0
                if not scoped_set or aid in scoped_set:
                    clusters.setdefault(comm, []).append(aid)
                    evidence_accs.append(aid)

            summary = f"Detected {len(clusters)} distinct account community clusters across {len(evidence_accs)} nodes."
            return {
                "status": "success",
                "algorithm": "community",
                "cluster_count": len(clusters),
                "clusters": [{"community_id": cid, "accounts": accs} for cid, accs in sorted(clusters.items())[:10]],
                "summary": summary,
                "evidence": {"account_ids": evidence_accs[:15], "tx_ids": []},
            }

        else:  # connected_components / wcc
            # Component membership
            q = """
            MATCH (a:Account)-[:SENT]-(b:Account)
            RETURN a.id, a.community
            LIMIT 50
            """
            res = client.execute_query(txn_graph, q, caller="tool:run_algo:wcc")
            comps: Dict[int, Set[str]] = {}
            for row in (res.result_set if res else []):
                aid, comm = row[0], int(row[1]) if row[1] is not None else 0
                if not scoped_set or aid in scoped_set:
                    comps.setdefault(comm, set()).add(aid)

            summary = f"Evaluated component connectivity: {len(comps)} connected groups found."
            return {
                "status": "success",
                "algorithm": "connected_components",
                "components": [{"component_id": cid, "accounts": sorted(list(accs))} for cid, accs in comps.items()],
                "summary": summary,
                "evidence": {"account_ids": sorted(list({a for accs in comps.values() for a in accs}))[:15], "tx_ids": []},
            }

    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "summary": f"Failed executing {name}: {e}",
            "evidence": {"account_ids": [], "tx_ids": []},
        }


# ---------------------------------------------------------------------------
# Tool 6: find_similar_cases
# ---------------------------------------------------------------------------

def find_similar_cases(
    case_id: str,
    limit: int = 5,
    db: Optional[FalkorDBClient] = None,
    memory_graph: str = MEMORY_GRAPH,
) -> Dict[str, Any]:
    """Search historical cases in memory with overlapping accounts or matching pattern signature."""
    if not case_id or not isinstance(case_id, str):
        return {
            "status": "error",
            "error": "Invalid case_id provided",
            "summary": "Must provide a valid string case ID.",
            "evidence": {"account_ids": [], "tx_ids": []},
        }

    clamped_limit = max(1, min(int(limit), 20))
    client = db or FalkorDBClient()

    try:
        # Check target case existence
        target_res = client.execute_query(memory_graph, GET_CASE_BY_ID, {"case_id": case_id.strip()}, caller="tool:similar:target")
        if not target_res or not target_res.result_set:
            return {
                "status": "error",
                "error": f"Case '{case_id}' not found in '{memory_graph}'",
                "summary": f"Case '{case_id}' does not exist.",
                "evidence": {"account_ids": [], "tx_ids": []},
            }

        similar_items = []
        seen_case_ids: Set[str] = set()
        evidence_case_ids: List[str] = []
        evidence_acc_ids: Set[str] = set()

        # 1. Tier 1: Shared Accounts Match
        shared_res = client.execute_query(
            memory_graph,
            FIND_SIMILAR_CASES_SHARED_ACCOUNTS,
            {"case_id": case_id.strip(), "limit": clamped_limit},
            caller="tool:similar:shared_accounts",
        )
        for row in (shared_res.result_set if shared_res else []):
            cid, cstatus, cscore, cpatterns, csig, shared_accs, outcome, decided_ts = row
            if cid in seen_case_ids:
                continue
            seen_case_ids.add(cid)
            evidence_case_ids.append(cid)
            shared_list = shared_accs or []
            evidence_acc_ids.update(shared_list)

            similar_items.append({
                "case_id": cid,
                "match_type": "shared_accounts",
                "shared_account_ids": shared_list,
                "shared_count": len(shared_list),
                "status": cstatus,
                "score": cscore,
                "patterns": cpatterns or [],
                "signature": csig,
                "outcome": outcome,
                "decided_at": decided_ts,
            })

        # 2. Tier 2: Same Structural Signature Match (if capacity remains)
        remaining = clamped_limit - len(similar_items)
        if remaining > 0:
            sig_res = client.execute_query(
                memory_graph,
                FIND_SIMILAR_CASES_SAME_SIGNATURE,
                {"case_id": case_id.strip(), "limit": remaining},
                caller="tool:similar:same_signature",
            )
            for row in (sig_res.result_set if sig_res else []):
                cid, cstatus, cscore, cpatterns, csig, outcome, decided_ts = row
                if cid in seen_case_ids:
                    continue
                seen_case_ids.add(cid)
                evidence_case_ids.append(cid)

                similar_items.append({
                    "case_id": cid,
                    "match_type": "same_signature",
                    "shared_account_ids": [],
                    "shared_count": 0,
                    "status": cstatus,
                    "score": cscore,
                    "patterns": cpatterns or [],
                    "signature": csig,
                    "outcome": outcome,
                    "decided_at": decided_ts,
                })

        if similar_items:
            dismissed_prior = [item["case_id"] for item in similar_items if item["outcome"] == "dismissed"]
            summary = (
                f"Found {len(similar_items)} similar historical case(s) for {case_id} "
                f"({', '.join(evidence_case_ids)})."
            )
            if dismissed_prior:
                summary += f" Prior case(s) {', '.join(dismissed_prior)} were previously dismissed by an analyst."
        else:
            summary = f"No prior similar cases found with overlapping accounts or matching signature for {case_id}."

        return {
            "status": "success",
            "case_id": case_id,
            "similar_count": len(similar_items),
            "items": similar_items,
            "summary": summary,
            "evidence": {
                "case_ids": evidence_case_ids,
                "account_ids": sorted(evidence_acc_ids),
                "tx_ids": [],
            },
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "summary": f"Failed searching similar cases for {case_id}: {e}",
            "evidence": {"account_ids": [], "tx_ids": []},
        }


# ---------------------------------------------------------------------------
# Tool 7: record_finding
# ---------------------------------------------------------------------------

def record_finding(
    case_id: str,
    text: str,
    evidence_ids: Optional[List[str]] = None,
    investigation_id: Optional[str] = None,
    db: Optional[FalkorDBClient] = None,
    memory_graph: str = MEMORY_GRAPH,
) -> Dict[str, Any]:
    """Write an analyst or agent finding with supporting evidence IDs to the memory graph."""
    if not case_id or not text or not isinstance(case_id, str) or not isinstance(text, str):
        return {
            "status": "error",
            "error": "Both case_id and text must be non-empty strings",
            "summary": "Invalid finding parameters.",
            "evidence": {"account_ids": [], "tx_ids": []},
        }

    clean_text = text.strip()
    ev_ids = [str(x).strip() for x in (evidence_ids or []) if x]
    client = db or FalkorDBClient()

    try:
        # Check case existence
        c_res = client.execute_query(memory_graph, GET_CASE_BY_ID, {"case_id": case_id.strip()}, caller="tool:finding:check_case")
        if not c_res or not c_res.result_set:
            return {
                "status": "error",
                "error": f"Case '{case_id}' does not exist in memory graph",
                "summary": f"Case '{case_id}' does not exist.",
                "evidence": {"account_ids": [], "tx_ids": []},
            }

        # Deterministic finding ID based on case and text hash
        text_hash = hashlib.sha256(clean_text.encode("utf-8")).hexdigest()[:8]
        finding_id = f"FIND_{case_id}_{text_hash}"
        now_ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        # Write finding to memory
        client.execute_query(
            memory_graph,
            RECORD_FINDING_CYPHER,
            {
                "case_id": case_id.strip(),
                "finding_id": finding_id,
                "text": clean_text,
                "evidence_ids": ev_ids,
                "created_at": now_ts,
            },
            caller="tool:record_finding",
        )

        if investigation_id:
            client.execute_query(
                memory_graph,
                LINK_FINDING_TO_INVESTIGATION,
                {"investigation_id": investigation_id.strip(), "finding_id": finding_id},
                caller="tool:record_finding:link_inv",
            )

        summary = f"Recorded finding {finding_id} for {case_id} citing {len(ev_ids)} evidence items."

        acc_evidence = [e for e in ev_ids if e.startswith("ACC_") or e.startswith("demo_")]
        tx_evidence = [e for e in ev_ids if e.startswith("TX_")]

        return {
            "status": "success",
            "finding_id": finding_id,
            "case_id": case_id,
            "text": clean_text,
            "evidence_ids": ev_ids,
            "created_at": now_ts,
            "summary": summary,
            "evidence": {
                "account_ids": acc_evidence,
                "tx_ids": tx_evidence,
            },
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "summary": f"Failed to record finding: {e}",
            "evidence": {"account_ids": [], "tx_ids": []},
        }


# ---------------------------------------------------------------------------
# Tool 8: propose_action
# ---------------------------------------------------------------------------

def propose_action(
    case_id: str,
    type: str,
    reason: str,
    investigation_id: Optional[str] = None,
    db: Optional[FalkorDBClient] = None,
    memory_graph: str = MEMORY_GRAPH,
) -> Dict[str, Any]:
    """Propose a pending investigative action (escalate, monitor, dismiss, or draft_sar)."""
    if not case_id or not type or not reason:
        return {
            "status": "error",
            "error": "case_id, type, and reason are required",
            "summary": "Missing required action parameters.",
            "evidence": {"account_ids": [], "tx_ids": []},
        }

    act_type = type.strip().lower()
    if act_type not in VALID_ACTION_TYPES:
        return {
            "status": "error",
            "error": f"Invalid action type '{type}'. Allowed: {sorted(VALID_ACTION_TYPES)}",
            "summary": f"Invalid action type '{type}'.",
            "evidence": {"account_ids": [], "tx_ids": []},
        }

    client = db or FalkorDBClient()
    try:
        # Check case existence
        c_res = client.execute_query(memory_graph, GET_CASE_BY_ID, {"case_id": case_id.strip()}, caller="tool:action:check_case")
        if not c_res or not c_res.result_set:
            return {
                "status": "error",
                "error": f"Case '{case_id}' does not exist in memory graph",
                "summary": f"Cannot propose action on non-existent case '{case_id}'.",
                "evidence": {"account_ids": [], "tx_ids": []},
            }

        action_id = f"ACT_{uuid.uuid4().hex[:8]}"
        now_ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        clean_reason = reason.strip()

        client.execute_query(
            memory_graph,
            PROPOSE_ACTION_CYPHER,
            {
                "case_id": case_id.strip(),
                "action_id": action_id,
                "type": act_type,
                "reason": clean_reason,
                "created_at": now_ts,
            },
            caller="tool:propose_action",
        )

        summary = f"Proposed '{act_type}' action ({action_id}) for {case_id} awaiting human analyst review."

        return {
            "status": "success",
            "action_id": action_id,
            "case_id": case_id,
            "type": act_type,
            "reason": clean_reason,
            "action_status": "pending",
            "created_at": now_ts,
            "summary": summary,
            "evidence": {"account_ids": [], "tx_ids": []},
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "summary": f"Failed to propose action: {e}",
            "evidence": {"account_ids": [], "tx_ids": []},
        }


# ---------------------------------------------------------------------------
# Tool Registry Map for Fast Execution
# ---------------------------------------------------------------------------

MCP_TOOLS_MAP = {
    "get_case": get_case,
    "expand_neighborhood": expand_neighborhood,
    "trace_funds": trace_funds,
    "shortest_path": shortest_path,
    "run_algorithm": run_algorithm,
    "find_similar_cases": find_similar_cases,
    "record_finding": record_finding,
    "propose_action": propose_action,
}
