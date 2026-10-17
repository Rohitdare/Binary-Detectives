# RingTrace Simulator Field Mapping

**Target Graph Schema:**
- **Transaction Graph (`txn`):**
  `(:Account {id, type, community, created})-[:SENT {tx_id, amount, ts, step, tx_type}]->(:Account)`
- **Evaluation Labels Graph (`labels`):**
  `(:LabelAlert {id, pattern, kind, is_fraud, tx_ids})-[:HAS_ACCOUNT {role}]->(:LabelAccount {id})`

---

## 1. Schema Mapping Table

| Simulator File | Simulator Field | RingTrace Field | Target Entity & Graph | Transformation | Validation Rules |
|---|---|---|---|---|---|
| `accounts.csv` | `account_id` | `id` | `Account.id` (`txn`) | Direct string pass-through | Non-empty regex `^ACC_\d{5}$`, must be globally unique across accounts. |
| `accounts.csv` | `type` | `type` | `Account.type` (`txn`) | Direct string pass-through | Must be one of `['personal', 'merchant', 'payroll']`. |
| `accounts.csv` | `community` | `community` | `Account.community` (`txn`) | `int(community)` | Non-negative integer. |
| `accounts.csv` | `created_date`| `created` | `Account.created` (`txn`) | String `YYYY-MM-DD` | Valid ISO date string; date must precede transaction window. |
| `transactions.csv` | `tx_id` | `tx_id` | `SENT.tx_id` (`txn`) | Direct string pass-through | Non-empty regex `^TX_\d{7}$`, must be globally unique across transactions. |
| `transactions.csv` | `src` | *(source node)* | `(a:Account {id: src})` (`txn`) | Graph node lookup | Must reference an existing `Account.id`. Cannot equal `dst` (no self-loops). |
| `transactions.csv` | `dst` | *(target node)* | `(b:Account {id: dst})` (`txn`) | Graph node lookup | Must reference an existing `Account.id`. Cannot equal `src`. |
| `transactions.csv` | `amount` | `amount` | `SENT.amount` (`txn`) | `float(amount)` | Numeric, strictly greater than 0.00 (`amount > 0`). |
| `transactions.csv` | `ts_epoch` | `ts` | `SENT.ts` (`txn`) | `int(ts_epoch)` | Unix timestamp in seconds; must fall within `[t0, t0 + days*86400)`. |
| `transactions.csv` | `ts` | *(debug/audit)*| N/A (stored in raw CSV) | Parse ISO-8601 string | UTC formatted `YYYY-MM-DDTHH:MM:SSZ`. |
| `transactions.csv` | `step` | `step` | `SENT.step` (`txn`) | `int(step)` | Non-negative integer representing simulation day index (`0 <= step < days`). |
| `transactions.csv` | `tx_type` | `tx_type` | `SENT.tx_type` (`txn`) | Direct string pass-through | Must be in `['UPI', 'NEFT', 'IMPS', 'RTGS']`. |
| `alerts.csv` | `alert_id` | `id` | `LabelAlert.id` (`labels`) | Direct string pass-through | Non-empty regex `^ALERT_[a-z_]+_\d{3}$`, unique across alerts. |
| `alerts.csv` | `pattern` | `pattern` | `LabelAlert.pattern` (`labels`) | Direct string pass-through | Recognized pattern name (e.g. `cycle`, `fan_in`, `relay_chain`). |
| `alerts.csv` | `kind` | `kind` | `LabelAlert.kind` (`labels`) | Direct string pass-through | Specific scenario variant identifier. |
| `alerts.csv` | `is_fraud` | `is_fraud` | `LabelAlert.is_fraud` (`labels`) | `is_fraud.lower() == 'true'` | Boolean. **NEVER stored in `txn` graph**. |
| `alert_transactions.csv` | `tx_id` | `tx_ids` | `LabelAlert.tx_ids` (`labels`) | Aggregated list of string transaction IDs | All IDs must exist in `transactions.csv`. Length `>= 2`. |
| `alert_accounts.csv` | `account_id` | `id` | `LabelAccount.id` (`labels`) | Direct string pass-through | Must exist in `accounts.csv`. |
| `alert_accounts.csv` | `role` | `role` | `HAS_ACCOUNT.role` (`labels`) | Direct string pass-through | Valid role string (e.g., `origin`, `sink`, `intermediary`, etc.). |

---

## 2. Integrity and Label Isolation Guarantees

1. **Strict Zero-Leakage Enforcement:**
   Ground-truth attributes (`is_fraud`, `alert_id`, `pattern`, `kind`, `role`) are strictly forbidden on `Account` nodes or `SENT` edges in the `txn` graph. The RingTrace ingestion pipeline runs an automated audit query:
   ```cypher
   MATCH (a:Account) WHERE a.is_fraud IS NOT NULL OR a.alert_id IS NOT NULL RETURN count(a)
   ```
   If this count is greater than 0, the load immediately fails with an assertion error.

2. **Reconciliation Invariant:**
   Upon completing data import:
   - `count((a:Account))` in `txn` MUST equal `len(accounts.csv)`.
   - `count(()-[t:SENT]->())` in `txn` MUST equal `len(transactions.csv)` (or `len(loaded)` if replay holdback is enabled).
   - Any discrepancy halts the pipeline and logs an audit error.

3. **Replay Holdback:**
   By default, the last 10% of transactions sorted chronologically by `(ts_epoch, tx_id)` are withheld from `txn` and saved to `data/replay.csv` for live streaming simulation demonstrations.
