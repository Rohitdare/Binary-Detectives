# RingTrace Function Map

This document catalogues the modules, classes, and key functions in the RingTrace codebase, detailing their responsibilities and calling hierarchy.

---

## 1. Simulation Layer (`backend/simulate.py`)

- **`class Sim`**: Main synthetic banking simulation engine.
  - `__init__(args)`: Initializes RNG with seed, sets base timestamp, initializes entity lists and used-account sets.
  - `iso(ts)`: Converts Unix timestamp to ISO-8601 UTC string (`%Y-%m-%dT%H:%M:%SZ`).
  - `amt(median, sigma, lo, hi)`: Generates lognormally distributed currency amounts.
  - `rand_ts()`: Selects a timestamp biased by realistic daily banking activity hours.
  - `add_tx(src, dst, amount, ts)`: Appends an edge record and assigns monotonic UID.
  - `pick(n, kind)`: Selects `n` unused accounts of type `kind` and marks them used, enforcing strict disjointness between ground-truth alerts.
  - `emit(pattern, kind, is_fraud, roles, rel)`: Plants a scenario in the timeline and emits ground-truth alert records.
  - `make_accounts()`: Instantiates accounts across merchant (5%), payroll (1%), and personal (94%) types with Pareto weights.
  - `background()`: Generates standard intra-community (75%) and inter-community (25%) peer transactions.
  - `payroll_runs()`: Generates periodic 30-day salary batches from payroll accounts to personal staff.
  - `inj_<pattern>()`: Injects specific fraud typologies (`cycle`, `fan_in`, `fan_out`, `relay_chain`, `scatter_gather`, `gather_scatter`, `bipartite`, `dense_cluster`).
  - `ben_<kind>()`: Injects benign look-alike scenarios (`payroll_fan_out`, `merchant_fan_in`, `slow_family_cycle`, `near_miss_fan_in`, `near_miss_relay`, `unordered_cycle`).
  - `run()`: High-level orchestrator calling account creation, background flows, and pattern injections.
  - `write(out)`: Writes the six CSV/JSON output files and returns UID-to-TXID mapping.
  - `validate()`: Verifies integrity constraints (no self-loops, existing accounts, positive amounts, disjoint alert accounts).

---

## 2. Ingestion & Adapter Layer

### `backend/app/simulator_adapter.py`
- **`class SimulatorAdapter`**:
  - `__init__(data_dir: str)`: Binds adapter to a simulator output directory.
  - `load_and_validate_accounts() -> List[Dict]`: Parses `accounts.csv`, enforces ID formats (`ACC_\d{5}`), uniqueness, valid types, non-negative community IDs, and valid dates.
  - `load_and_validate_transactions(valid_account_ids: set) -> List[Dict]`: Parses `transactions.csv`, verifies positive amounts, known endpoints, no self-loops, valid channels, and unique `TX_\d{7}` IDs.
  - `load_and_validate_labels(valid_account_ids: set, valid_tx_ids: set) -> Tuple[List[Dict], List[Dict]]`: Parses `alerts.csv`, `alert_accounts.csv`, and `alert_transactions.csv`, enforcing ground truth isolation from transaction data.

### `backend/app/data_loader.py`
- **`class RingTraceDataLoader`**:
  - `__init__(db: Optional[FalkorDBClient] = None)`: Injects FalkorDB client.
  - `load_dataset(data_dir, txn_graph, labels_graph, replay_fraction, full, reset) -> Dict`: Orchestrates validation, index creation, batch UNWIND MERGE queries, replay holdback file writing, count reconciliation, and label leakage audits.
- **`main()`**: CLI entry point supporting arguments `--data`, `--host`, `--port`, `--graph`, `--labels-graph`, `--replay-fraction`, `--full`, `--reset`.

---

## 3. Database & Query Layer

### `backend/app/db.py`
- **`class FalkorDBClient`**:
  - `__init__(host, port)`: Connects to FalkorDB instance.
  - `select_graph(graph_name)`: Returns graph handle.
  - `execute_query(graph_name, query, params, caller) -> QueryResult`: Executes Cypher query, measures execution duration, and writes structured audit logs to `logs/queries.jsonl`.
  - `try_query(graph_name, query, caller)`: Non-fatal query runner for idempotent index creation.
  - `delete_graph(graph_name, caller)`: Drops specified graph and logs operation.
- **`get_db(host, port) -> FalkorDBClient`**: Singleton accessor for database client.

### `backend/app/queries.py`
Centralized repository of Cypher queries:
- `CREATE_ACCOUNT_INDEX`, `CREATE_SENT_INDEX`: Performance indexes on `txn` graph.
- `CREATE_LABEL_ALERT_INDEX`, `CREATE_LABEL_ACCOUNT_INDEX`: Performance indexes on `labels` graph.
- `MERGE_ACCOUNTS`, `MERGE_TRANSACTIONS`: UNWIND batch insertion queries for graph nodes and edges.
- `MERGE_LABEL_ALERTS`, `MERGE_LABEL_MEMBERS`: UNWIND batch insertion queries for evaluation labels.
- `COUNT_ACCOUNTS`, `COUNT_SENT`, `COUNT_LABEL_ALERTS`, `COUNT_LABEL_MEMBERS`: Reconciliation verification queries.
- `LABEL_LEAKAGE_CHECK`: Audit query asserting zero ground-truth properties on `Account` nodes.
