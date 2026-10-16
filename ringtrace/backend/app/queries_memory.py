"""Cypher queries for the RingTrace memory graph (Member B's queries layer).

The memory graph lives in the same FalkorDB instance as `txn`, but in its own
graph (default name `memorygraph`, see `app/memory/graph.py`).

Schema (owners marked):
  Member A: (:Case {id, patterns, score, score_breakdown, status, signature, updated_at})
            (:Case)-[:INVOLVES {roles}]->(:AccountRef {id, type})
            (:Case)-[:HAS_HIT]->(:Hit {hit_id, pattern, account_ids, tx_ids, measurements, explanation})
  Member B: (:Case)-[:DECIDED]->(:Decision {decision_id, decision, note, actor, ts})
            (:Investigation {id, ts, assessment})-[:ABOUT]->(:Case)
            (:Investigation)-[:FOUND]->(:Finding {id, text, evidence_ids})

FalkorDB properties cannot hold nested maps, so `score_breakdown` and `measurements`
are stored as JSON strings and decoded by the Python layer.

Every write uses MERGE on a stable id, so running the same write twice never
creates duplicates. All queries are parameterised (no string-built Cypher).
"""

# ---------------------------------------------------------------------------
# Indexes: one per id property, so MERGE / MATCH by id is a fast lookup
# instead of a full scan. Creating an index that already exists raises an
# error in FalkorDB, so the caller ignores "already indexed" errors.
# ---------------------------------------------------------------------------
MEMORY_INDEXES = [
    "CREATE INDEX FOR (c:Case) ON (c.id)",
    "CREATE INDEX FOR (h:Hit) ON (h.hit_id)",
    "CREATE INDEX FOR (a:AccountRef) ON (a.id)",
    "CREATE INDEX FOR (d:Decision) ON (d.decision_id)",
    "CREATE INDEX FOR (i:Investigation) ON (i.id)",
    "CREATE INDEX FOR (f:Finding) ON (f.id)",
]

# ---------------------------------------------------------------------------
# Seeding (Day 1 only). These write Member A's node types (Case, Hit,
# AccountRef) so Member B can build before the real case builder exists.
# Once Member A's builder runs, it owns these writes.
# ---------------------------------------------------------------------------

# Read the real transactions behind a seed case from the `txn` graph.
# UNWIND turns the list of ids into rows; each row looks up one SENT edge.
SEED_FETCH_TXS = """
UNWIND $tx_ids AS tid
MATCH (s:Account)-[t:SENT {tx_id: tid}]->(d:Account)
RETURN t.tx_id, s.id, s.type, d.id, d.type, t.amount, t.ts, t.tx_type
"""

# Create or update a case. SET overwrites, so re-seeding resets status to 'open'.
SEED_UPSERT_CASE = """
MERGE (c:Case {id: $case_id})
SET c.patterns = $patterns,
    c.score = $score,
    c.score_breakdown = $score_breakdown,
    c.status = $status,
    c.signature = $signature,
    c.updated_at = $updated_at,
    c.source = $source
"""

# Create or update a hit and link it to its case.
SEED_UPSERT_HIT = """
MATCH (c:Case {id: $case_id})
MERGE (h:Hit {hit_id: $hit_id})
SET h.pattern = $pattern,
    h.account_ids = $account_ids,
    h.tx_ids = $tx_ids,
    h.measurements = $measurements,
    h.explanation = $explanation
MERGE (c)-[:HAS_HIT]->(h)
"""

# Link a case to every account it involves. AccountRef nodes are shared
# between cases: two cases touching the same account point at the same node,
# which is what lets find_similar_cases match on shared accounts later.
SEED_UPSERT_ACCOUNT_REFS = """
MATCH (c:Case {id: $case_id})
UNWIND $accounts AS acc
MERGE (a:AccountRef {id: acc.id})
SET a.type = acc.type
MERGE (c)-[r:INVOLVES]->(a)
SET r.roles = acc.roles
"""

# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

# One row per case with account and hit counts (used by the seed summary).
LIST_CASES_SUMMARY = """
MATCH (c:Case)
OPTIONAL MATCH (c)-[:INVOLVES]->(a:AccountRef)
WITH c, count(DISTINCT a) AS account_count
OPTIONAL MATCH (c)-[:HAS_HIT]->(h:Hit)
RETURN c.id, c.patterns, c.score, c.status, c.signature, account_count, count(DISTINCT h) AS hit_count
ORDER BY c.id
"""

# Node counts per label, used to verify seeding and idempotency.
COUNT_MEMORY_NODES = """
MATCH (n)
RETURN labels(n)[0] AS label, count(n) AS n
ORDER BY label
"""
