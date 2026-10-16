"""Memory graph lifecycle: name, indexes, wipe and counts.

All database access goes through `FalkorDBClient` (app/db.py) and all Cypher
comes from `app/queries_memory.py`.
"""
import os
from typing import Dict, Optional

try:
    from app.db import FalkorDBClient
    from app.queries_memory import COUNT_MEMORY_NODES, MEMORY_INDEXES
except ImportError:
    from backend.app.db import FalkorDBClient
    from backend.app.queries_memory import COUNT_MEMORY_NODES, MEMORY_INDEXES

# The plan document calls this graph `memory`; this project uses `memorygraph`.
# Override with the FALKORDB_MEMORY_GRAPH environment variable if needed.
MEMORY_GRAPH = os.getenv("FALKORDB_MEMORY_GRAPH", "memorygraph")
TXN_GRAPH = os.getenv("FALKORDB_GRAPH", "txn")


def init_memory_graph(db: Optional[FalkorDBClient] = None, graph: str = MEMORY_GRAPH) -> None:
    """Create the id indexes. Safe to call repeatedly."""
    client = db or FalkorDBClient()
    for q in MEMORY_INDEXES:
        try:
            client.execute_query(graph, q, caller="memory:init_index")
        except Exception as e:  # FalkorDB raises if the index already exists
            if "already indexed" not in str(e).lower():
                raise


def wipe_memory_graph(db: Optional[FalkorDBClient] = None, graph: str = MEMORY_GRAPH) -> None:
    """Delete the whole memory graph. Never call this with the `txn` or `labels` name."""
    if graph in (TXN_GRAPH, "labels"):
        raise ValueError(f"Refusing to wipe protected graph '{graph}'")
    (db or FalkorDBClient()).delete_graph(graph, caller="memory:wipe")


def memory_counts(db: Optional[FalkorDBClient] = None, graph: str = MEMORY_GRAPH) -> Dict[str, int]:
    """Return {label: node_count} for the memory graph (empty dict if it does not exist)."""
    client = db or FalkorDBClient()
    try:
        res = client.execute_query(graph, COUNT_MEMORY_NODES, caller="memory:counts")
    except Exception:
        return {}
    return {str(r[0]): int(r[1]) for r in res.result_set}
