# RingTrace Demo, Pitch, and Evaluation Guide

---

## 1. Executive Summary & Value Proposition

**RingTrace** is an explainable graph-based financial crime investigation platform powered by **FalkorDB**. Traditional anti-money laundering (AML) systems suffer from high false-positive rates (often >95%) because they inspect isolated transactions using static thresholds. RingTrace models the complete payment topology in FalkorDB, detecting complex multi-hop laundering topologies—including structuring, layering chains, circular flows, and dispersal/aggregation networks—while separating illicit patterns from legitimate commercial activities (e.g. corporate payroll runs and merchant payment surges).

---

## 2. Role of the Synthetic Simulator

In financial crime detection, real banking transaction data cannot be publicized due to strict banking secrecy and privacy regulations (GDPR, GLBA, PII laws). To validate graph detection algorithms rigorously and reproducibly, RingTrace leverages an AMLSim-inspired synthetic simulator (`simulate.py`):

1. **Realistic Financial Topography:** Synthesizes communities of personal, merchant, and payroll accounts with Pareto-distributed transaction frequencies and diurnal banking hour distributions.
2. **Planted Typologies with Ground Truth:** Injects 8 distinct money laundering typologies alongside deceptive benign look-alikes (e.g., family cycles, payroll fan-outs, and merchant surges).
3. **Disjoint Evaluation Labels:** Every planted alert utilizes exclusive accounts, guaranteeing that ground-truth labels never overlap or introduce ambiguity.
4. **Deterministic Benchmarking:** Fully reproducible through fixed random seeds (`--seed 42`), enabling objective precision/recall scoring across algorithm iterations.

---

## 3. Data Flow: From Generation to FalkorDB Graph

```
+-------------------+
|    simulate.py    |  Generates accounts.csv, transactions.csv, alerts.csv, etc.
+-------------------+
          |
          v
+-------------------+
| simulator_adapter |  Strict schema validation, regex validation, positive amounts
+-------------------+
          |
          v
+-------------------+
|    data_loader    |  UNWIND batch insertion with index optimization
+-------------------+
     /         \
    v           v
+-------+   +--------+
|  txn  |   | labels |  Strict isolation: detectors NEVER query labels graph!
+-------+   +--------+
```

1. **Transaction Graph (`txn`):**
   `(:Account {id, type, community, created})-[:SENT {tx_id, amount, ts, step, tx_type}]->(:Account)`
   - Used by Cypher query detectors and investigation agents.
   - Guarded by automated audit queries ensuring zero ground-truth leakage.
2. **Evaluation Graph (`labels`):**
   `(:LabelAlert {id, pattern, kind, is_fraud, tx_ids})-[:HAS_ACCOUNT {role}]->(:LabelAccount {id})`
   - Read exclusively by the benchmark evaluation suite to calculate True Positives, False Positives, False Negatives, Precision, Recall, and F1 Score.

---

## 4. Typology Representation & Distinctions

| Category | Patterns Represented | Key Distinguishing Factors |
|---|---|---|
| **Planted Fraud** | `cycle`, `fan_in`, `fan_out`, `relay_chain`, `scatter_gather`, `gather_scatter`, `bipartite`, `dense_cluster` | Rapid execution window, capital conservation (slight fee decay), structured amounts just below reporting thresholds ($50k). |
| **Planted Benign** | `payroll_fan_out`, `merchant_fan_in`, `slow_family_cycle`, `near_miss_fan_in`, `near_miss_relay`, `unordered_cycle` | Recurring payroll schedule, merchant account type, long temporal spacing (weeks), chronological disorder. |
| **Algorithmic Signal** | `hub_account` | High PageRank and degree centrality emerging from retail payment concentration. |

### Data Categorization:
- **Synthetic:** Account IDs, customer identities, payment networks, and planted laundering events.
- **Measured:** Database query durations, graph traversal latency, batch ingestion speed, and memory usage.
- **Inferred:** Anomaly scores, risk classifications, and agent investigation summaries.
- **Simulated:** Payment channels (UPI, NEFT, IMPS, RTGS) and chronological timeline pacing.

> [!WARNING]
> Detection metrics measured on synthetic benchmarks reflect algorithmic pattern recovery against simulated mechanics. They must not be claimed as guaranteed real-world field accuracy without calibration against production banking data.

---

## 5. Reproducible Hackathon Demonstration Script

### Step 1: Generate Standard Benchmark Dataset
```powershell
python simulate.py --seed 42 --out data/sim
```
*Expected Output:* ~3,000 accounts, ~36,000-40,000 transactions, 116 labeled alert scenarios.

### Step 2: Load into FalkorDB with Live Replay Holdback
```powershell
python -m app.data_loader --data data/sim --graph txn --labels-graph labels --reset
```
*Expected Output:*
- 3,000 accounts loaded into `txn` graph.
- ~90% transactions loaded; remaining 10% held in `data/sim/replay.csv` for streaming replay.
- Count reconciliation: OK.
- Label leakage audit: PASS (0 leaked labels).

### Step 3: Run Centralized Centrality & Path Traversal Queries
Run graph algorithms in FalkorDB:
```cypher
CALL algo.pageRank('Account', 'SENT') YIELD node, score
CALL algo.WCC({nodeLabels:['Account'], relationshipTypes:['SENT']}) YIELD node, componentId
```

---

## 6. Dataset Limitations
- **Synthetic Uniformity:** Background transactions follow stationary lognormal and diurnal distributions without sudden macroeconomic shocks.
- **Disjoint Account Constraint:** Each account participates in at most one labeled alert scenario to ensure clean evaluation boundaries.
- **Offline Generation:** Graph is statically generated in batches prior to streaming replay.
