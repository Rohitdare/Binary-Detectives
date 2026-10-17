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
    "CREATE INDEX FOR (act:ProposedAction) ON (act.action_id)",
]

# ---------------------------------------------------------------------------
# Seeding (Day 1 only). These write Member A's node types (Case, Hit,
# AccountRef) so Member B can build before the real case builder exists.
# Once Member A's builder runs, it owns these writes.
# ---------------------------------------------------------------------------

# Read the real transactions behind a seed case from the `txn` graph.
# UNWIND turns the list of ids into rows; each row looks up one SENT edge.
SEED_FETCH_TXS = """
MATCH (s:Account)-[t:SENT]->(d:Account)
WHERE t.tx_id IN $tx_ids
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
    c.source = $source,
    c.payload = $payload
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

# Fetch single case metadata
GET_CASE_BY_ID = """
MATCH (c:Case {id: $case_id})
RETURN c.id, c.status, c.score, c.score_breakdown, c.patterns, c.signature, c.updated_at
"""

# Fetch hits associated with a case
GET_CASE_HITS = """
MATCH (c:Case {id: $case_id})-[:HAS_HIT]->(h:Hit)
RETURN h.hit_id, h.pattern, h.account_ids, h.tx_ids, h.measurements, h.explanation
ORDER BY h.hit_id
"""

# Fetch accounts involved in a case
GET_CASE_ACCOUNTS = """
MATCH (c:Case {id: $case_id})-[r:INVOLVES]->(a:AccountRef)
RETURN a.id, a.type, r.roles
ORDER BY a.id
"""

# Fetch decisions recorded for a case (if any)
GET_CASE_DECISIONS = """
MATCH (c:Case {id: $case_id})-[:DECIDED]->(d:Decision)
RETURN d.decision_id, d.decision, d.note, d.actor, d.ts
ORDER BY d.ts DESC
"""

# Find similar cases by shared accounts
FIND_SIMILAR_CASES_SHARED_ACCOUNTS = """
MATCH (c:Case {id: $case_id})-[:INVOLVES]->(a:AccountRef)<-[:INVOLVES]-(other:Case)
WHERE other.id <> $case_id
OPTIONAL MATCH (other)-[:DECIDED]->(d:Decision)
WITH other, collect(DISTINCT a.id) AS shared_accs, d
ORDER BY d.ts DESC
WITH other, shared_accs, head(collect(d)) AS latest_decision
RETURN other.id, other.status, other.score, other.patterns, other.signature,
       shared_accs, latest_decision.decision, latest_decision.ts
ORDER BY size(shared_accs) DESC, other.score DESC
LIMIT $limit
"""

# Find similar cases by identical structural signature
FIND_SIMILAR_CASES_SAME_SIGNATURE = """
MATCH (c:Case {id: $case_id}), (other:Case)
WHERE other.id <> $case_id AND other.signature = c.signature
OPTIONAL MATCH (other)-[:DECIDED]->(d:Decision)
WITH other, d
ORDER BY d.ts DESC
WITH other, head(collect(d)) AS latest_decision
RETURN other.id, other.status, other.score, other.patterns, other.signature,
       latest_decision.decision, latest_decision.ts
ORDER BY other.score DESC
LIMIT $limit
"""

# Write a Finding node linked to Case (and optionally Investigation)
RECORD_FINDING_CYPHER = """
MATCH (c:Case {id: $case_id})
MERGE (f:Finding {id: $finding_id})
SET f.text = $text,
    f.evidence_ids = $evidence_ids,
    f.created_at = $created_at
MERGE (c)-[:HAS_FINDING]->(f)
"""

# Link Finding to Investigation if investigation_id is provided
LINK_FINDING_TO_INVESTIGATION = """
MATCH (i:Investigation {id: $investigation_id}), (f:Finding {id: $finding_id})
MERGE (i)-[:FOUND]->(f)
"""

# Store ProposedAction linked to Case
PROPOSE_ACTION_CYPHER = """
MATCH (c:Case {id: $case_id})
MERGE (act:ProposedAction {action_id: $action_id})
SET act.type = $type,
    act.reason = $reason,
    act.status = 'pending',
    act.created_at = $created_at
MERGE (c)-[:HAS_PROPOSED_ACTION]->(act)
"""

# Record a human analyst decision and update Case.status in memory
RECORD_DECISION_CYPHER = """
MATCH (c:Case {id: $case_id})
MERGE (d:Decision {decision_id: $decision_id})
SET d.decision = $decision,
    d.note = $note,
    d.actor = $actor,
    d.ts = $ts
MERGE (c)-[:DECIDED]->(d)
SET c.status = $case_status,
    c.updated_at = $ts
"""

# Query ProposedAction by action_id
GET_PROPOSED_ACTION_BY_ID = """
MATCH (c:Case)-[:HAS_PROPOSED_ACTION]->(act:ProposedAction {action_id: $action_id})
RETURN act.action_id, act.type, act.reason, act.status, act.created_at, c.id
"""

# Update ProposedAction status (e.g. approved or rejected)
UPDATE_PROPOSED_ACTION_STATUS = """
MATCH (act:ProposedAction {action_id: $action_id})
SET act.status = $status,
    act.resolved_at = $ts
"""

# Persist an Investigation node in memory
SAVE_INVESTIGATION_CYPHER = """
MATCH (c:Case {id: $case_id})
MERGE (i:Investigation {id: $investigation_id})
SET i.mode = $mode,
    i.status = $status,
    i.assessment = $assessment,
    i.ts = $ts
MERGE (i)-[:ABOUT]->(c)
"""

# Retrieve an Investigation by ID
GET_INVESTIGATION_BY_ID = """
MATCH (i:Investigation {id: $investigation_id})-[:ABOUT]->(c:Case)
RETURN i.id, c.id, i.mode, i.status, i.assessment, i.ts
"""

# Retrieve all Investigations for a specific case
GET_INVESTIGATIONS_BY_CASE = """
MATCH (i:Investigation)-[:ABOUT]->(c:Case {id: $case_id})
RETURN i.id, c.id, i.mode, i.status, i.assessment, i.ts
ORDER BY i.ts DESC
"""


