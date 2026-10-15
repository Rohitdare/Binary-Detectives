"""Database client for FalkorDB with query audit logging."""
import json
import os
import sys
import time
import uuid
from typing import Any, Dict, Optional
from falkordb import FalkorDB

DEFAULT_HOST = os.getenv("FALKORDB_HOST", "localhost")
DEFAULT_PORT = int(os.getenv("FALKORDB_PORT", "6379"))
LOG_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logs", "queries.jsonl")


class FalkorDBClient:
    """FalkorDB database client for RingTrace."""

    def __init__(self, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT):
        self.host = host
        self.port = port
        self.client = FalkorDB(host=self.host, port=self.port)

    def select_graph(self, graph_name: str):
        return self.client.select_graph(graph_name)

    def _log(self, qid: str, graph: str, query: str, params: Optional[Dict], caller: str, t0: float, ok: bool, err: Optional[str] = None):
        try:
            os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
            with open(LOG_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps({
                    "query_id": qid,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "graph": graph,
                    "caller": caller,
                    "query": query.strip(),
                    "params_summary": f"{len(params)} keys" if params else None,
                    "duration_ms": round((time.time() - t0) * 1000.0, 2),
                    "success": ok,
                    "error": err
                }) + "\n")
        except Exception:
            pass

    def execute_query(self, graph_name: str, query: str, params: Optional[Dict[str, Any]] = None, caller: str = "unknown"):
        graph = self.select_graph(graph_name)
        qid, t0 = f"QRY_{uuid.uuid4().hex[:8]}", time.time()
        try:
            res = graph.query(query, params or {})
            self._log(qid, graph_name, query, params, caller, t0, True)
            return res
        except Exception as e:
            self._log(qid, graph_name, query, params, caller, t0, False, str(e))
            raise

    def delete_graph(self, graph_name: str, caller: str = "cleanup"):
        qid, t0 = f"QRY_{uuid.uuid4().hex[:8]}", time.time()
        try:
            self.select_graph(graph_name).delete()
            self._log(qid, graph_name, "GRAPH.DELETE", None, caller, t0, True)
        except Exception as e:
            self._log(qid, graph_name, "GRAPH.DELETE", None, caller, t0, False, str(e))
