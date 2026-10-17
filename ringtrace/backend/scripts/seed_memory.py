#!/usr/bin/env python3
"""Seed the memory graph with hand-made cases built from real `txn` transactions.

Usage (from ringtrace/backend, with the venv active):
    python scripts/seed_memory.py            # add / refresh the seed cases
    python scripts/seed_memory.py --reset    # wipe the memory graph first

The memory graph name defaults to `memorygraph` (env FALKORDB_MEMORY_GRAPH).
"""
import argparse
import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.memory.graph import MEMORY_GRAPH, TXN_GRAPH, memory_counts  # noqa: E402
from app.memory.seed import SeedError, list_case_summaries, seed_memory  # noqa: E402


def main() -> int:
    p = argparse.ArgumentParser(description="Seed the RingTrace memory graph")
    p.add_argument("--graph", default=MEMORY_GRAPH, help="memory graph name")
    p.add_argument("--txn-graph", default=TXN_GRAPH, help="transaction graph to read from")
    p.add_argument("--reset", action="store_true", help="delete the memory graph before seeding")
    a = p.parse_args()

    try:
        built = seed_memory(memory_graph=a.graph, txn_graph=a.txn_graph, reset=a.reset)
    except SeedError as e:
        print(f"seed failed: {e}", file=sys.stderr)
        return 1

    print(f"seeded {len(built)} cases into '{a.graph}' (read from '{a.txn_graph}')")
    for c in list_case_summaries(memory_graph=a.graph):
        print(f"  {c['case_id']}  score={c['score']:>3}  status={c['status']:<6} "
              f"patterns={c['patterns']}  accounts={c['account_count']}  hits={c['hit_count']}  "
              f"signature={c['signature']}")
    print(f"node counts: {memory_counts(graph=a.graph)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
