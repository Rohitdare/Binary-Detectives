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
    "ORDER BY t.ts ASC, t.tx_id ASC LIMIT $limit"
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

# Fan-In Detection Queries
FIND_FAN_IN_CANDIDATES = (
    "MATCH (src:Account)-[t:SENT]->(dst:Account) "
    "WITH dst, count(DISTINCT src) AS distinct_senders "
    "WHERE distinct_senders >= $min_senders "
    "RETURN dst.id, dst.type, distinct_senders "
    "ORDER BY distinct_senders DESC "
    "LIMIT $limit"
)

GET_ACCOUNT_INCOMING_TRANSFERS = (
    "MATCH (src:Account)-[t:SENT]->(dst:Account {id: $account_id}) "
    "RETURN t.tx_id, src.id, dst.id, t.amount, t.ts, t.step, t.tx_type "
    "ORDER BY t.ts ASC "
    "LIMIT $limit"
)

COUNT_ACCOUNT_INCOMING_TOTAL = (
    "MATCH ()-[t:SENT]->(dst:Account {id: $account_id}) "
    "RETURN count(t)"
)

# Fan-Out Detection Queries
FIND_FAN_OUT_CANDIDATES = (
    "MATCH (src:Account)-[t:SENT]->(dst:Account) "
    "WITH src, count(DISTINCT dst) AS distinct_receivers "
    "WHERE distinct_receivers >= $min_receivers "
    "RETURN src.id, src.type, distinct_receivers "
    "ORDER BY distinct_receivers DESC "
    "LIMIT $limit"
)

GET_ACCOUNT_OUTGOING_TRANSFERS = (
    "MATCH (src:Account {id: $account_id})-[t:SENT]->(dst:Account) "
    "RETURN t.tx_id, src.id, dst.id, t.amount, t.ts, t.step, t.tx_type "
    "ORDER BY t.ts ASC "
    "LIMIT $limit"
)

COUNT_ACCOUNT_OUTGOING_TOTAL = (
    "MATCH (src:Account {id: $account_id})-[t:SENT]->() "
    "RETURN count(t)"
)

