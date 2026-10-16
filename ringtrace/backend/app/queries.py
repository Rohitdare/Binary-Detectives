"""Centralized Cypher queries for RingTrace."""

# Schema & Indexing Queries
CREATE_ACCOUNT_INDEX = "CREATE INDEX FOR (a:Account) ON (a.id)"
CREATE_SENT_INDEX = "CREATE INDEX FOR ()-[t:SENT]-() ON (t.tx_id)"
CREATE_LABEL_ALERT_INDEX = "CREATE INDEX FOR (a:LabelAlert) ON (a.id)"
CREATE_LABEL_ACCOUNT_INDEX = "CREATE INDEX FOR (a:LabelAccount) ON (a.id)"

# Ingestion Queries
MERGE_ACCOUNTS = (
    "UNWIND $rows AS r "
    "MERGE (a:Account {id:r.id}) "
    "SET a.type=r.type, a.community=r.community, a.created=r.created"
)

MERGE_TRANSACTIONS = (
    "UNWIND $rows AS r "
    "MATCH (a:Account {id:r.src}), (b:Account {id:r.dst}) "
    "MERGE (a)-[t:SENT {tx_id:r.tx_id}]->(b) "
    "SET t.amount=r.amount, t.ts=r.ts, t.step=r.step, t.tx_type=r.tx_type"
)

MERGE_LABEL_ALERTS = (
    "UNWIND $rows AS r "
    "MERGE (al:LabelAlert {id:r.alert_id}) "
    "SET al.pattern=r.pattern, al.kind=r.kind, al.is_fraud=r.is_fraud, al.tx_ids=r.tx_ids"
)

MERGE_LABEL_MEMBERS = (
    "UNWIND $rows AS r "
    "MATCH (al:LabelAlert {id:r.alert_id}) "
    "MERGE (a:LabelAccount {id:r.account_id}) "
    "MERGE (al)-[m:HAS_ACCOUNT]->(a) "
    "SET m.role=r.role"
)

# Audit, Count & Reconciliation Queries
COUNT_ACCOUNTS = "MATCH (a:Account) RETURN count(a)"
COUNT_SENT = "MATCH ()-[t:SENT]->() RETURN count(t)"
COUNT_LABEL_ALERTS = "MATCH (al:LabelAlert) RETURN count(al)"
COUNT_LABEL_MEMBERS = "MATCH ()-[m:HAS_ACCOUNT]->() RETURN count(m)"

GET_LABEL_ALERTS_BY_PATTERN = (
    "MATCH (al:LabelAlert) WHERE al.pattern = $pattern "
    "OPTIONAL MATCH (al)-[:HAS_ACCOUNT]->(la:LabelAccount) "
    "RETURN al.id, al.pattern, al.kind, al.is_fraud, al.tx_ids, collect(la.id) "
    "ORDER BY al.id"
)

# Label Leakage Guard (must return 0 on txn graph)
LABEL_LEAKAGE_CHECK = (
    "MATCH (a:Account) "
    "WHERE a.is_fraud IS NOT NULL OR a.alert_id IS NOT NULL "
    "RETURN count(a)"
)

# API & Exploration Queries
GET_RECENT_TRANSACTIONS = (
    "MATCH (a:Account)-[t:SENT]->(b:Account) "
    "RETURN t.tx_id, a.id, b.id, t.amount, t.ts, t.step, t.tx_type "
    "ORDER BY t.ts DESC LIMIT $limit"
)

GET_GRAPH_SAMPLE = (
    "MATCH (a:Account)-[t:SENT]->(b:Account) "
    "RETURN a.id, a.type, a.community, b.id, b.type, b.community, t.tx_id, t.amount, t.ts, t.tx_type "
    "LIMIT $limit"
)

# Cycle detection reads one bounded evidence set, then applies temporal and
# amount pruning in Python instead of asking Cypher to enumerate every 3-5 hop
# path before LIMIT can take effect.
GET_CYCLE_EDGES = (
    "MATCH (a:Account)-[t:SENT]->(b:Account) "
    "RETURN a.id, b.id, t.tx_id, t.amount, t.ts, t.step, t.tx_type "
    "ORDER BY t.ts DESC, t.tx_id DESC SKIP $offset LIMIT $limit"
)

PING_FALKORDB = "RETURN 1"

# The three graph-wide path detectors read a single bounded, deterministic edge
# sample and do their bounded path search in Python. The extra row reveals caps.
GET_PATTERN_TRANSACTION_EDGES = (
    "MATCH (src:Account)-[t:SENT]->(dst:Account) "
    "RETURN t.tx_id, src.id, dst.id, t.amount, t.ts, t.step, t.tx_type "
    "ORDER BY t.ts DESC, t.tx_id DESC SKIP $offset LIMIT $limit"
)

GET_ACCOUNT_BY_ID = (
    "MATCH (a:Account {id: $account_id}) "
    "RETURN a.id, a.type, a.community, a.created"
)

GET_ACCOUNT_TRANSFERS_OUT = (
    "MATCH (a:Account {id: $account_id})-[t:SENT]->(b:Account) "
    "RETURN t.tx_id, a.id, b.id, t.amount, t.ts, t.step, t.tx_type "
    "ORDER BY t.ts DESC LIMIT $limit"
)

GET_ACCOUNT_TRANSFERS_IN = (
    "MATCH (b:Account)-[t:SENT]->(a:Account {id: $account_id}) "
    "RETURN t.tx_id, b.id, a.id, t.amount, t.ts, t.step, t.tx_type "
    "ORDER BY t.ts DESC LIMIT $limit"
)

# Search & Exploration Queries
SEARCH_ACCOUNTS = (
    "MATCH (a:Account) "
    "WHERE a.id CONTAINS $query "
    "RETURN a.id, a.type, a.community "
    "LIMIT $limit"
)

# Case building and retrieval. The API stores complete JSON payloads for stable,
# explainable responses, while keeping Member B's decision/status property intact.
GET_ACCOUNT_TYPES_BY_IDS = (
    "MATCH (a:Account) WHERE a.id IN $account_ids "
    "RETURN a.id, a.type"
)

UPSERT_CASES = (
    "UNWIND $rows AS r "
    "MERGE (c:Case {id:r.case_id}) "
    "ON CREATE SET c.status = 'open' "
    "SET c.signature = r.signature, c.score = r.score, c.severity = r.severity, c.patterns = r.patterns, "
    "c.updated_at = r.updated_at, c.payload = r.payload "
    "WITH c, r UNWIND r.account_ids AS account_id "
    "MERGE (a:AccountRef {id:account_id}) "
    "MERGE (c)-[:INVOLVES]->(a)"
)

UPSERT_CASE_HITS = (
    "UNWIND $rows AS r "
    "MATCH (c:Case {id:r.case_id}) "
    "MERGE (h:Hit {hit_id:r.hit_id}) "
    "SET h.pattern = r.pattern, h.tx_ids = r.tx_ids, h.account_ids = r.account_ids, "
    "h.measurements = r.measurements, h.payload = r.payload "
    "MERGE (c)-[:HAS_HIT]->(h)"
)

GET_CASES = (
    "MATCH (c:Case) RETURN c.payload, c.status "
    "ORDER BY c.score DESC, c.id ASC LIMIT $limit"
)

GET_CASES_BY_SCORE = (
    "MATCH (c:Case) "
    "WHERE ($status IS NULL OR c.status = $status) "
    "AND ($severity IS NULL OR c.severity = $severity) "
    "AND ($pattern IS NULL OR $pattern IN c.patterns) "
    "RETURN c.payload, c.status ORDER BY c.score DESC, c.id ASC SKIP $offset LIMIT $limit"
)

GET_CASES_BY_UPDATED = (
    "MATCH (c:Case) "
    "WHERE ($status IS NULL OR c.status = $status) "
    "AND ($severity IS NULL OR c.severity = $severity) "
    "AND ($pattern IS NULL OR $pattern IN c.patterns) "
    "RETURN c.payload, c.status ORDER BY c.updated_at DESC, c.id ASC SKIP $offset LIMIT $limit"
)

GET_CASE_BY_ID = (
    "MATCH (c:Case {id:$case_id}) RETURN c.payload, c.status"
)

GET_CASE_HITS = (
    "MATCH (:Case {id:$case_id})-[:HAS_HIT]->(h:Hit) "
    "RETURN h.payload ORDER BY h.pattern, h.hit_id"
)

GET_CASE_DECISIONS = (
    "MATCH (:Case {id:$case_id})-[:DECIDED]->(d:Decision) "
    "RETURN d.decision_id, d.decision, d.note, d.actor, d.ts "
    "ORDER BY d.ts DESC"
)

GET_CASES_FOR_ACCOUNT = (
    "MATCH (c:Case)-[:INVOLVES]->(:AccountRef {id:$account_id}) "
    "RETURN c.payload, c.status ORDER BY c.score DESC LIMIT $limit"
)

GET_GRAPH_COUNTS_AND_RANGE = (
    "MATCH (a:Account) WITH count(a) AS account_count "
    "MATCH ()-[t:SENT]->() RETURN account_count, count(t), min(t.ts), max(t.ts)"
)

COUNT_CASES = "MATCH (c:Case) RETURN count(c)"

GET_CASE_PATTERN_COUNTS = (
    "MATCH (c:Case) UNWIND c.patterns AS pattern "
    "RETURN pattern, count(c) ORDER BY pattern"
)

GET_DEMO_ACCOUNT = "MATCH (a:Account) WHERE a.id STARTS WITH 'demo_' RETURN a.id LIMIT 1"

GET_ACCOUNT_NEIGHBORHOOD = (
    "MATCH (a:Account {id:$account_id})-[t:SENT]-(b:Account) "
    "RETURN DISTINCT b.id, b.type, b.community, b.created "
    "ORDER BY b.id LIMIT $limit"
)

GET_NEIGHBORHOOD_EDGES = (
    "MATCH (a:Account)-[t:SENT]->(b:Account) "
    "WHERE a.id IN $account_ids OR b.id IN $account_ids "
    "RETURN a.id, a.type, a.community, b.id, b.type, b.community, "
    "t.tx_id, t.amount, t.ts, t.tx_type "
    "ORDER BY t.ts DESC, t.tx_id DESC LIMIT $limit"
)

# Fan-In Detection Queries
FIND_FAN_IN_CANDIDATES = (
    "MATCH (src:Account)-[t:SENT]->(dst:Account) "
    "WITH dst, count(DISTINCT src) AS distinct_senders, count(t) AS total_transactions "
    "WHERE distinct_senders >= $min_senders "
    "RETURN dst.id, dst.type, distinct_senders, total_transactions "
    "ORDER BY distinct_senders DESC, dst.id ASC "
    "LIMIT $limit"
)

GET_ACCOUNT_INCOMING_TRANSFERS = (
    "MATCH (src:Account)-[t:SENT]->(dst:Account {id: $account_id}) "
    "RETURN t.tx_id, src.id, dst.id, t.amount, t.ts, t.step, t.tx_type "
    "ORDER BY t.ts DESC, t.tx_id DESC "
    "LIMIT $limit"
)

COUNT_ACCOUNT_INCOMING_TOTAL = (
    "MATCH ()-[t:SENT]->(dst:Account {id: $account_id}) "
    "RETURN count(t)"
)

# Fan-Out Detection Queries
FIND_FAN_OUT_CANDIDATES = (
    "MATCH (src:Account)-[t:SENT]->(dst:Account) "
    "WITH src, count(DISTINCT dst) AS distinct_receivers, count(t) AS total_transactions "
    "WHERE distinct_receivers >= $min_receivers "
    "RETURN src.id, src.type, distinct_receivers, total_transactions "
    "ORDER BY distinct_receivers DESC, src.id ASC "
    "LIMIT $limit"
)

GET_ACCOUNT_OUTGOING_TRANSFERS = (
    "MATCH (src:Account {id: $account_id})-[t:SENT]->(dst:Account) "
    "RETURN t.tx_id, src.id, dst.id, t.amount, t.ts, t.step, t.tx_type "
    "ORDER BY t.ts DESC, t.tx_id DESC "
    "LIMIT $limit"
)

COUNT_ACCOUNT_OUTGOING_TOTAL = (
    "MATCH (src:Account {id: $account_id})-[t:SENT]->() "
    "RETURN count(t)"
)

