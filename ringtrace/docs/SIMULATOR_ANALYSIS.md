# RingTrace Simulator Analysis

**Version:** 1.0  
**Date:** 2026-10-15  
**Author:** RingTrace Architecture Team  
**Status:** Validated  

---

## 1. Overview & File Locations

The RingTrace synthetic banking simulator consists of two companion scripts located in the backend directory:

- **Simulator:** [`simulate.py`](file:///D:/vortex/ringtrace/backend/simulate.py) (423 lines, 17.9 KB)
- **FalkorDB Loader:** [`load_falkordb.py`](file:///D:/vortex/ringtrace/backend/load_falkordb.py) (142 lines, 5.9 KB)

The simulator is a self-contained, AMLSim-inspired synthetic transaction generator capable of generating background banking flows, planted financial crime typologies, and deceptive benign look-alikes with strict ground-truth separation.

---

## 2. Execution & Runtime Requirements

- **Language / Runtime:** Python 3.10+ (Verified on Python 3.10.0 on Windows x86_64).
- **External Dependencies for Simulation:** None. `simulate.py` relies exclusively on Python standard library modules (`argparse`, `csv`, `hashlib`, `json`, `math`, `os`, `random`, `collections`, `datetime`, `itertools`).
- **External Dependencies for Database Ingestion:** `falkordb` Python client (`pip install falkordb`) connecting to FalkorDB running via Docker on port 6379.
- **Main Entry Point:** `simulate.py`
- **Standard Execution Command:**
  ```powershell
  python simulate.py --seed 42 --out data/sim
  ```
- **Evaluation Dataset Command:**
  ```powershell
  python simulate.py --seed 43 --out data/sim2
  ```
- **Minimal Safe Test Command:**
  ```powershell
  python simulate.py --seed 42 --accounts 100 --days 10 --tx-per-account 2.0 --fraud-per-pattern 1 --benign-per-kind 1 --out data/test_sim
  ```

---

## 3. Configuration Parameters

| Flag | Type | Default | Description |
|---|---|---|---|
| `--seed` | int | `42` | Random seed controlling all stochastic distributions |
| `--accounts` | int | `3000` | Total number of generated accounts |
| `--days` | int | `90` | Time horizon in calendar days (starting `2026-01-01T00:00:00Z`) |
| `--tx-per-account` | float | `12.0` | Multiplier for background peer transactions |
| `--fraud-per-pattern` | int | `10` | Number of instances planted for each fraud typology |
| `--benign-per-kind` | int | `6` | Number of instances planted for each benign look-alike |
| `--out` | str | `data/sim` | Destination directory for generated CSV and JSON files |

---

## 4. Expected Inputs and Outputs

### Inputs
The simulator takes command-line arguments. It does not require any external input files or proprietary datasets.

### Generated Artifacts
When executed, `simulate.py` creates six files in the target directory:

1. **`accounts.csv`**:
   - `account_id` (e.g. `ACC_00001`)
   - `type` (`personal`, `merchant`, `payroll`)
   - `community` (cluster integer `0..ncomm`)
   - `created_date` (ISO date `YYYY-MM-DD`, 30 to 1800 days before base date)
2. **`transactions.csv`**:
   - `tx_id` (e.g. `TX_0000001`)
   - `src` (sender account ID)
   - `dst` (recipient account ID)
   - `amount` (string formatted with 2 decimals, e.g. `12450.00`)
   - `ts` (ISO-8601 UTC string: `YYYY-MM-DDTHH:MM:SSZ`)
   - `ts_epoch` (Unix timestamp integer in seconds)
   - `step` (Day index integer: `0..days-1`)
   - `tx_type` (Channel: `UPI`, `NEFT`, `IMPS`, `RTGS`)
3. **`alerts.csv`** *(Ground Truth — Evaluator Only)*:
   - `alert_id` (e.g. `ALERT_cycle_001`)
   - `pattern` (`cycle`, `fan_in`, `fan_out`, `relay_chain`, `scatter_gather`, `gather_scatter`, `bipartite`, `dense_cluster`)
   - `kind` (Specific scenario name matching fraud or benign kind)
   - `is_fraud` (`true` or `false`)
   - `n_accounts` (Count of accounts involved)
   - `n_tx` (Count of transactions involved)
   - `start_ts` (ISO-8601 earliest transaction timestamp)
   - `end_ts` (ISO-8601 latest transaction timestamp)
4. **`alert_accounts.csv`** *(Ground Truth — Evaluator Only)*:
   - `alert_id`
   - `account_id`
   - `role` (`origin`, `intermediary`, `relay`, `sink`, `source`, `recipient`, `hub`, `member`, `employer`, `employee`, `customer`, `merchant`, `source_group`, `target_group`)
5. **`alert_transactions.csv`** *(Ground Truth — Evaluator Only)*:
   - `alert_id`
   - `tx_id`
6. **`meta.json`**:
   - Execution parameters, entity counts, breakdown of alerts by kind, and the SHA-256 digest of `transactions.csv`.

---

## 5. Account & Transaction Generation Mechanics

- **Account Distribution:**
  - 5% `merchant` accounts (receive weight 20x higher to create realistic payment concentration).
  - 1% `payroll` accounts (execute bulk payments to 15-60 personal staff accounts every 30 days).
  - 94% `personal` accounts.
  - Accounts belong to synthesized synthetic communities (`ncomm = max(5, n // 150)`).
- **Background Transfers:**
  - 75% of background peer transactions are routed within the same community, 25% cross-community.
  - Activity is governed by Pareto-distributed weights (`min(r.paretovariate(1.5), 50.0)`).
  - Amounts follow lognormal distributions (median ₹1,500, log-sigma 1.1, bounded ₹50 to ₹250,000).
- **Temporal Distribution:**
  - Background transaction hours follow realistic diurnal banking patterns via `HOUR_W` weights (peaking between 09:00 and 18:00 UTC).
- **Channels:**
  - Randomly assigned across major payment rails: UPI, NEFT, IMPS, RTGS.

---

## 6. Supported Typologies and Patterns

### Planted Fraud Typologies (`is_fraud = True`)
1. **`cycle`**: Closed money loop across 3 to 5 nodes. Amount slightly decays at each hop (90-99%) to simulate transaction fees/cuts. Offsets spaced 10 minutes to 12 hours.
2. **`fan_in`**: 8 to 25 accounts transmitting funds into a single sink within a 2-48 hour window. 40% of instances implement smurfing/structuring (amounts just below ₹50,000 regulatory reporting thresholds).
3. **`fan_out`**: 1 origin account disbursing to 8-25 recipients within 2-48 hours.
4. **`relay_chain`**: Multi-hop layering chain (3 to 6 hops) with small amount reductions (85-98%) and rapid succession (5 minutes to 6 hours between hops).
5. **`scatter_gather`**: 1 origin splits funds to 3-6 intermediaries, which subsequently re-aggregate at a single sink account within 30 minutes to 24 hours.
6. **`gather_scatter`**: Inflow from 5-12 source accounts to a central hub during day 1, followed by outflow to 5-12 different recipient accounts during day 2.
7. **`bipartite`**: Dense cross-transfers between a source group (3-5 accounts) and a target group (3-5 accounts) over 48 hours.
8. **`dense_cluster`**: Highly interconnected group of 5-10 accounts engaging in circular and cross-transfers over 4 days.

### Planted Benign Look-Alikes (`is_fraud = False`)
1. **`payroll_fan_out`**: Genuine corporate payroll disbursement to 15-40 staff accounts.
2. **`merchant_fan_in`**: Legitimate customer retail payments to a merchant account.
3. **`slow_family_cycle`**: Casual transfers between family members spread across 8-20 days per leg with large drop-offs (20-60%), not time-urgent.
4. **`near_miss_fan_in`**: Small casual group pooling (3-5 sources) below typical structuring thresholds.
5. **`near_miss_relay`**: Sluggish transfers between individuals spread over 3-10 days per hop.
6. **`unordered_cycle`**: A structural ring in the graph whose timestamps do not satisfy chronological forward flow from any origin node.

### Graph-Algorithmic Signal (Not Planted)
- **`hub_account`**: Naturally occurring high-degree / high-PageRank accounts (primarily merchant and corporate accounts in the background data), detectable via PageRank or in/out-degree scoring.

---

## 7. Ground Truth & Disjoint Account Isolation

- **Disjoint Account Guarantee:** The simulator employs `self.pick(n, kind)` which records all assigned accounts into `self.used`. Every labeled instance (fraud and benign) is guaranteed to use exclusive accounts. Ground-truth alerts never overlap.
- **Strict Separation:** The core detection pipeline reads solely from the `txn` graph. Ground-truth alert metadata (`alerts.csv`, `alert_accounts.csv`, `alert_transactions.csv`) is only loaded into the separate `labels` graph, preventing label leakage into production detectors.

---

## 8. Reproducibility & Performance

- **Determinism:** When provided with the same `--seed`, `simulate.py` yields byte-identical output, verified via SHA-256 calculation of `transactions.csv` stored in `meta.json`.
- **Runtime Performance:**
  - 3,000 accounts / 90 days / ~37,000 transactions: ~1.2 seconds simulation time.
  - FalkorDB ingestion (`load_falkordb.py`): ~2.0 seconds.
- **Memory Footprint:** In-memory simulation structures consume < 50 MB RAM for 50,000 transactions.

---

## 9. Known Limitations & Failure Points

1. **Account Pool Exhaustion:** If `--accounts` is set too low (e.g., < 200) while requesting many fraud/benign instances, `self.pick()` will raise `SystemExit` due to insufficient free accounts.
2. **Temporal Window Overflow:** If a pattern's offset span exceeds `--days * 86400`, `emit()` raises `SystemExit`.
3. **No Dynamic Graph Streamer Built-In:** While `load_falkordb.py` produces `replay.csv` for holding back 10% of transactions, a real-time event pump or WebSocket streamer must consume this file to simulate live streaming.

---

## 10. Integration Architecture

RingTrace integrates the simulator via:
1. `backend/app/db.py`: Centralized singleton and connection manager for FalkorDB.
2. `backend/app/queries.py`: Centralized Cypher query definitions.
3. `backend/app/simulator_adapter.py`: Validates CSVs, parses fields, and verifies schema contracts.
4. `backend/app/data_loader.py`: Programmatic import into FalkorDB with batching, index creation, count reconciliation, and label leakage safeguards.
