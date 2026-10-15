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

SEARCH_ACCOUNTS = (
    "MATCH (a:Account) "
    "WHERE a.id CONTAINS $query "
    "RETURN a.id, a.type, a.community "
    "LIMIT $limit"
)
