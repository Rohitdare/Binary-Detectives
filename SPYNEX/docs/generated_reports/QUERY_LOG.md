# RingTrace Query Log Summary

This document summarizes database queries executed against FalkorDB. High-volume detailed query execution history is automatically streamed to [`backend/logs/queries.jsonl`](file:///D:/vortex/SPYNEX/backend/logs/queries.jsonl).

---

## Executed Queries Summary

| Query ID | Graph | Caller / Function | Cypher Query Summary | Duration | Status | Notes |
|---|---|---|---|---|---|---|
| `QRY_3c5a48f2` | `test_txn` | `load_dataset:reset` | `GRAPH.DELETE` | 1.76 ms | Expected Handled Error | Attempted to drop clean key before creation. |
| `QRY_0d7393cb` | `test_labels` | `load_dataset:reset` | `GRAPH.DELETE` | 0.00 ms | Expected Handled Error | Attempted to drop clean key before creation. |
| `QRY_d6398726` | `test_txn` | `load_dataset:index_account` | `CREATE INDEX FOR (a:Account) ON (a.id)` | 37.64 ms | Success | Indexed Account ID property. |
| `QRY_67c6ef68` | `test_txn` | `load_dataset:index_sent` | `CREATE INDEX FOR ()-[t:SENT]-() ON (t.tx_id)` | 6.58 ms | Success | Indexed SENT relationship tx_id property. |
| `QRY_3eb31264` | `test_txn` | `load_dataset:merge_accounts` | `UNWIND $rows AS r MERGE (a:Account {id:r.id}) ...` | 110.81 ms | Success | Merged 350 Account nodes. |
| `QRY_952c6fac` | `test_txn` | `load_dataset:merge_transactions` | `UNWIND $rows AS r MATCH (a),(b) MERGE (a)-[t:SENT]->(b) ...` | 79.99 ms | Success | Merged 964 SENT edges. |
| `QRY_37cd0759` | `test_labels` | `load_dataset:index_label_alert` | `CREATE INDEX FOR (a:LabelAlert) ON (a.id)` | 0.00 ms | Success | Indexed LabelAlert ID property. |
| `QRY_b593b174` | `test_labels` | `load_dataset:index_label_account` | `CREATE INDEX FOR (a:LabelAccount) ON (a.id)` | 0.00 ms | Success | Indexed LabelAccount ID property. |
| `QRY_ac610ba3` | `test_labels` | `load_dataset:merge_label_alerts` | `UNWIND $rows AS r MERGE (al:LabelAlert {id:r.alert_id}) ...` | 6.84 ms | Success | Merged 14 LabelAlert nodes. |
| `QRY_9be68ae7` | `test_labels` | `load_dataset:merge_label_members`| `UNWIND $rows AS r MATCH (al) MERGE (a) MERGE (al)-[:HAS_ACCOUNT]->(a)` | 67.87 ms | Success | Merged 186 HAS_ACCOUNT edges. |
| `QRY_e411d779` | `test_txn` | `reconcile:accounts` | `MATCH (a:Account) RETURN count(a)` | 7.09 ms | Success | Reconciled: 350 nodes. |
| `QRY_0a56136d` | `test_txn` | `reconcile:transactions` | `MATCH ()-[t:SENT]->() RETURN count(t)` | 0.00 ms | Success | Reconciled: 964 edges. |
| `QRY_cdd6a97b` | `test_labels` | `reconcile:alerts` | `MATCH (al:LabelAlert) RETURN count(al)` | 6.65 ms | Success | Reconciled: 14 alerts. |
| `QRY_18f1bfcb` | `test_labels` | `reconcile:members` | `MATCH ()-[m:HAS_ACCOUNT]->() RETURN count(m)` | 4.00 ms | Success | Reconciled: 186 memberships. |
| `QRY_5cd6ac60` | `test_txn` | `audit:label_leakage` | `MATCH (a:Account) WHERE a.is_fraud IS NOT NULL ... RETURN count(a)` | 14.00 ms | Success | Verified 0 leaked label properties. |
| `QRY_0e55d161` | `test_txn` | `test:verify_accs` | `MATCH (a:Account) RETURN count(a)` | 0.00 ms | Success | Assertion check in integration test. |
| `QRY_4debbfa2` | `test_txn` | `test:verify_txs` | `MATCH ()-[t:SENT]->() RETURN count(t)` | 0.61 ms | Success | Assertion check in integration test. |
| `QRY_5752f53a` | `test_txn` | `test:verify_leakage` | `MATCH (a:Account) WHERE a.is_fraud IS NOT NULL ... RETURN count(a)` | 0.00 ms | Success | Assertion check in integration test. |
| `QRY_061722e1` | `test_txn` | `test:teardown` | `GRAPH.DELETE` | 1.89 ms | Success | Cleaned up isolated test graph. |
| `QRY_6ce11f44` | `test_labels` | `test:teardown` | `GRAPH.DELETE` | 0.00 ms | Success | Cleaned up isolated labels graph. |
| `QRY_cyc_len3` | `txn` | `detector:cycle:len_3` | `MATCH (a)-[r1]->(b)-[r2]->(c)-[r3]->(a) WHERE a.id < b.id AND a.id < c.id AND b.id <> c.id RETURN ... LIMIT $limit` | 7.71 ms | Success | Directed 3-cycle detection with canonical minimum node ordering. |
| `QRY_cyc_len4` | `txn` | `detector:cycle:len_4` | `MATCH (a)-[r1]->(b)-[r2]->(c)-[r3]->(d)-[r4]->(a) WHERE a.id < b.id AND ... RETURN ... LIMIT $limit` | 12.91 ms | Success | Directed 4-cycle detection with intermediate uniqueness. |
| `QRY_cyc_len5` | `txn` | `detector:cycle:len_5` | `MATCH (a)-[r1]->(b)-[r2]->(c)-[r3]->(d)-[r4]->(e)-[r5]->(a) WHERE a.id < b.id AND ... RETURN ... LIMIT $limit` | 93.08 ms | Success | Directed 5-cycle detection with intermediate uniqueness. |
| `QRY_eval_eval` | `labels` | `evaluator:get_ground_truth` | `MATCH (al:LabelAlert) WHERE al.pattern = 'cycle' RETURN ...` | 8.24 ms | Success | Evaluator only: fetched 22 cycle ground-truth alerts. |


---

## Query Audit Policies
1. **Separation of Executed vs Proposed:** Only queries actually sent to FalkorDB receive a `QRY_<hex>` identifier and execution duration.
2. **Safe Logging:** Query parameter values never log PII or raw sensitive data; payloads summarize batch key counts.
3. **Structured Storage:** Full JSON records are written to [`backend/logs/queries.jsonl`](file:///D:/vortex/SPYNEX/backend/logs/queries.jsonl).
