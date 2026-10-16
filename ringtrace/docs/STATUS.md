# RingTrace Project Status & Roadmap

**Current Milestone:** Phase 3 — Directed Transaction Cycle Detector  
**Status:** Complete & Fully Validated (Backend, Cypher, UI, & Tests)  
**Last Updated:** 2026-10-15  

---

## 1. Completed Capabilities

- [x] **Directed Transaction Cycle Detector (Phase 3):**
  - Centralized Cypher queries (`CYCLE_3_QUERY`, `CYCLE_4_QUERY`, `CYCLE_5_QUERY` in `backend/app/queries.py`) with canonical node ordering (`a.id < b.id ...`) to guarantee rotational deduplication at the database query level.
  - Core detector engine in `backend/app/detectors/cycle.py` (`detect_cycles(min_length=3, max_length=5, limit=50)`) calculating cycle length, duration, time-ordering verification, amount conservation ratio, and factual explanations.
  - Zero label leakage: detector operates solely on the `txn` graph and never accesses ground truth `labels`.
  - Bounded traversal: strictly parameterized queries prevent runaway enumerations.
  - FastAPI endpoint `GET /api/detectors/cycles` returning structured candidate evidence with complete supporting transaction objects.
  - Interactive React UI in `frontend/src/components/patterns/CycleDetectionView.tsx` with parameter inputs, candidate list, chronological badges, Cytoscape.js circular topology visualizer, and supporting transaction breakdown.
  - Automated test suite `backend/tests/test_cycle_detector.py` covering all 10 unit, integration, edge-case, and boundary scenarios (10/10 passed in 0.15s on isolated test graphs).
  - Standalone ground-truth evaluation in `backend/app/evaluator.py`: 100.0% structural recovery of all 22 planted cycle alerts (10 fraud cycles, 6 slow family cycles, 6 unordered cycles).


- [x] **Simulator Discovery & Ingestion (Phase 1):** Inspected and validated `backend/simulate.py` and `backend/load_falkordb.py`; populated FalkorDB `txn` graph with 3,000 accounts and 40,661 transactions.
- [x] **FastAPI Backend (`backend/app/main.py`):**
  - Live FalkorDB connectivity & health monitoring (`/api/health`).
  - Real operational stats (`/api/stats` -> 3,000 accounts, 40,661 transactions).
  - Recent transactions ledger queries (`/api/transactions`).
  - Sample network topology generation for Cytoscape.js (`/api/graph`).
  - Account profile, in/out flow metrics, and 1-hop neighborhood queries (`/api/accounts/{id}`).
  - Account prefix search with autocomplete (`/api/search`).
- [x] **React 19 + TypeScript + Vite Dashboard (`frontend/`):**
  - Dark-themed financial intelligence design system with readable typography and subtle borders.
  - Sidebar navigation with brand logo, roadmap badges, and active tab routing.
  - Topbar with global account autocomplete search and live FalkorDB connection status pill.
  - Metric summary cards displaying live counts from `txn` graph.
  - Cytoscape.js interactive graph canvas with color-coded account roles (Merchant: Cyan, Payroll: Emerald, Personal: Slate) and node selection inspector.
  - Recent ledger transactions table with Indian Rupee (₹) currency formatting and account click-through.
  - Transaction Explorer with account profiles, in/outflow tables, and centered 1-hop Cytoscape.js subgraph.
  - Honest empty/placeholder states for upcoming detection and investigation modules.
- [x] **Testing & Verification:**
  - Automated backend API test suite: 10/10 tests passed (`Ran 10 tests in 1.243s — OK`).
  - Frontend production build: `npm run build` completed in 4.12s with 0 errors.
  - Browser subagent validation: Live verification on `http://127.0.0.1:5173/` completed successfully.

---

## 2. Ingestion & Database Metrics

- **Accounts in `txn` Graph:** 3,000 nodes.
- **Transactions in `txn` Graph:** 40,661 `[:SENT]` edges.
- **Backend API Latency:** < 15ms for stats and recent transactions; ~35ms for graph topology samples.
- **Label Leakage:** 0 leaked label properties in `txn` graph.

---

- [x] **Fan-In & Fan-Out Transaction Detectors (Phase 4):**
  - Centralized Cypher queries (`FIND_FAN_IN_CANDIDATES`, `GET_ACCOUNT_INCOMING_TRANSFERS`, `FIND_FAN_OUT_CANDIDATES`, `GET_ACCOUNT_OUTGOING_TRANSFERS`) in `backend/app/queries.py` with degree indexing and safe pagination.
  - Rolling 48-hour window burst algorithms in `backend/app/detectors/fan_in.py` and `backend/app/detectors/fan_out.py` retaining complete evidence (all transaction IDs, including parallel transfers between identical counterparties).
  - Business context preservation: Neither 'personal' accounts are automatically marked suspicious nor 'merchant'/'payroll' accounts automatically marked benign. Explicit suspicion criteria evaluate structuring share, counterparty velocity, and empirical recurrence.
  - Empirical payroll recurrence: Origin historical transactions are evaluated for monthly batches (~20-40 days apart) to distinguish legitimate payroll runs from rapid anomalous dispersals.
  - Configurable simulator structuring range (defaults to ₹42,500–₹49,500) as an empirical indicator, avoiding brittle hardcoded legal assumptions.
  - Endpoints: `GET /api/detectors/fan-in`, `GET /api/detectors/fan-out` (with `/api/v1/...` aliases).
  - Automated test suite: `backend/tests/test_fan_detectors.py` (9/9 tests passed in 0.18s on isolated test graphs, covering positive fixtures, negative window expirations, parallel edge retention, benign merchant handling, and recurring payroll).

---

## 2. Ingestion & Database Metrics

- **Accounts in `txn` Graph:** 3,000 nodes.
- **Transactions in `txn` Graph:** 40,661 `[:SENT]` edges.
- **Backend API Latency:** < 15ms for stats and recent transactions; ~35ms for graph topology samples.
- **Label Leakage:** 0 leaked label properties in `txn` graph.
- **Automated Test Suite:** 34/34 tests passing across full backend test suite (`unittest discover -s tests`).

---

## 3. Next Recommended Development Tasks

1. **Task 1 — Core Detector Suite Completion (`backend/app/detectors/`):**
   - `relay_chain_detector.py` (multi-hop layering with hop decay)
   - `scatter_gather_detector.py` / `gather_scatter_detector.py`
2. **Task 2 — Case Builder & Priority Scorer (`backend/app/cases/`):**
   - Union-find / connected components clustering over detected hits with 60-account cap.
   - Heuristic 0–100 priority scoring breakdown (severity, amount, velocity, account count, corroboration).
3. **Task 3 — Standalone Ground-Truth Benchmark Evaluator:**
   - Independent evaluation of fan_in and fan_out precision/recall against `labels`.

---

## Detection UX and Bounded Cycle Search — 2026-10-16

- Replaced cycle detection's 3–5 hop graph-wide path enumeration with one bounded transaction-edge read followed by timestamp-ordered, amount-pruned search in Python. Result, edge-scan, and search-work caps are reported explicitly; canonical transaction evidence remains attached to every cycle.
- Cycle candidates now carry a `suspicious` review flag only when the observed cycle is fast and retains the configured amount criteria. A graph-pattern match is not represented as confirmed fraud or a probability.
- Fan-in and fan-out results now carry their actual transaction records in addition to IDs. The Overview lists only the three connected detectors, and the results workspace displays returned accounts, directed transfers, measurements, and transaction evidence.
- Cycle API responses include measured elapsed time, edges scanned, path-search steps, and suspicious candidate count; the versioned cycle route is available as an additive alias.
- Verification in this workspace: all 47 backend tests passed against isolated graphs and read-only API checks; frontend production build passed. The build reports the existing large JavaScript chunk advisory (725.40 kB minified). Frontend lint previously exited successfully with five warnings in existing App/Navbar/NetworkPreview/TransactionExplorer code; the new workbench has no lint warning.
- Live `txn` check: 40,661 edges scanned in 2.76s; 5 cycle candidates returned, 2 marked for review, no truncation. Fan-in returned 50 hits (16 marked for review) in 3.34s; fan-out returned 50 hits (24 marked for review) in 4.89s. Both fan results correctly report result truncation at the configured limit. Browser interaction ran the cycle detector and showed real transaction evidence and a directed graph; the responsive layout was checked at a narrow viewport. All displayed evidence references transaction IDs returned by the graph.
- Remaining work: fan-in/out run times are several seconds and their 50-hit responses are partial by design; case aggregation/scoring is not implemented, so the dashboard labels the review queue count unavailable.
