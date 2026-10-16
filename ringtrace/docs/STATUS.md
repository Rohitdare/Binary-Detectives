# RingTrace Project Status & Roadmap

**Current Milestone:** Phase 3 — Directed Transaction Cycle Detector  
**Status:** Complete & Fully Validated (Backend, Cypher, UI, & Tests)  
**Last Updated:** 2026-10-15  

---

## 1. Completed Capabilities

- [x] **Member B Step 6: Stream Replay and Demo Reset (2026-10-16):**
  - Built `backend/app/stream/worker.py` managing playback of 4,067 withheld transactions into FalkorDB `txn` graph in small configurable bursts (25, 50, 100 tx/s).
  - Exposes `GET /api/v1/stream/events` emitting real-time SSE stream events (`stream_status`, `tx_batch`, `case_created`, `case_updated`, `heartbeat`).
  - Added stream control routes `POST /api/v1/stream/start`, `/pause`, `/resume`, `/stop`, `GET /api/v1/stream/status`.
  - Implemented one-click `POST /api/v1/demo/reset`: wipes `memory` graph, clears any `demo_`-prefixed accounts/edges from `txn`, resets replay position, clears active investigations, and re-seeds clean demo snapshot (`CASE_0001`, `CASE_0002`, `CASE_0003`).
  - Frontend `frontend/src/features/investigation/DemoControls.tsx`: Live playback progress bar, burst speed selector, start/pause/resume/stop buttons, and prominent One-Click Demo Reset button.
  - Automated test suite `backend/tests/test_stream_and_reset.py`: 4/4 passed. Full backend suite: 67/67 passed.

- [x] **Member B Step 5: React Frontend Panels (2026-10-16):**
  - Created dedicated frontend features in `frontend/src/features/investigation/`:
    - `InvestigationPanel.tsx` / `.jsx`: Connects to live SSE stream via native `new EventSource(...)`, streams progressive tool calls with parameter/output inspectors, renders clickable evidence chips (`ACC_...`, `TX_...`), `MODE: LLM` / `MODE: FALLBACK` badge, and executive narrative with risk level.
    - `MemoryPanel.tsx` / `.jsx`: Displays historical precedents ("seen before") from FalkorDB with outcome badges, match signatures, and shared accounts.
    - `DecisionBar.tsx` / `.jsx`: Human-in-the-Loop compliance authority with Escalate, Monitor, Dismiss, and Approve/Reject SAR recommendation buttons plus audit rationale note input.
    - `DemoControls.tsx`: Stream replay playback and demo reset toolbar.
  - Updated `frontend/src/components/layout/Sidebar.tsx` activating **Investigations** tab (`badge: 'Live'`).
  - Mounted `AutonomousInvestigationView` in `frontend/src/App.tsx`.
  - Verified with `npm run build` (0 TypeScript/Vite errors) and browser automation testing.

- [x] **Member B Step 4: FastAPI Endpoints and Real-Time SSE Streams (2026-10-16):**
  - Created `backend/app/api/investigation_routes.py` and mounted under prefix `/api/v1` in `main.py`:
    - `POST /api/v1/cases/{id}/investigations`: Triggers autonomous agent loop (202 Accepted).
    - `GET /api/v1/investigations/{id}/events`: Real-time SSE streaming (`step`, `done`, `error`, `heartbeat`).
    - `GET /api/v1/investigations/{id}`: Returns investigation state and findings.
    - `POST /api/v1/cases/{id}/decisions`: Records human analyst sign-off into FalkorDB memory graph (`(:Case)-[:DECIDED]->(:Decision)`) and updates `Case.status`.
    - `GET /api/v1/cases/{id}/decisions`: Returns decision audit history.
    - `GET /api/v1/cases/{id}/similar`: Matches past similar cases by shared accounts or structural signatures.
    - `POST /api/v1/actions/{action_id}/approve` & `reject`: Approves or rejects proposed actions with Decision logging.
  - Test suite in `backend/tests/test_investigation_routes.py`: 11/11 passed. Full test suite: 63/63 passed.

- [x] **Member B Step 2: The 8 MCP Graph Tools (2026-10-16):**
  - Implemented in `backend/app/mcp_server/tools.py`: `get_case`, `expand_neighborhood`, `trace_funds`, `shortest_path`, `run_algorithm`, `find_similar_cases`, `record_finding`, `propose_action`.
  - Zero raw Cypher exposed to caller; strict input boundaries, bounded traversal limits, and standardized evidence payloads (`account_ids`, `tx_ids`).
  - Added queries in `backend/app/queries_memory.py`.
  - Comprehensive unit and integration test suite in `backend/tests/test_mcp_tools.py`: 16/16 passed in 0.23s.
  - Full test suite: 45/45 tests passing.
  - Next: Step 3, Agent Loop, Anti-Hallucination Validator & Safe Fallback.

- [x] **Member B Step 1: Memory graph and seed cases (2026-10-16):**
  - Configured FalkorDB graph `memory` (env `FALKORDB_MEMORY_GRAPH`).
  - Cypher in `backend/app/queries_memory.py`; lifecycle in `backend/app/memory/graph.py`; seeds in `backend/app/memory/seed.py`.
  - `python scripts/seed_memory.py [--reset]` seeds CASE_0001 (4-hop cycle), CASE_0002 and CASE_0003 (payroll ACC_02975 fan-outs to the same 15 people, one month apart).
  - Live counts: 3 Case, 3 Hit, 20 AccountRef. Re-running gives identical counts.
  - Tests: `tests/test_memory_seed.py` 9/9 passed.

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

## 3. Next Recommended Development Tasks

1. **Task 1 — Core Detector Suite Implementation (`backend/app/detectors/`):**
   Implement Cypher-based detection queries:
   - `cycle_detector.py` (time-respecting forward path check and 80-100% amount conservation)
   - `fan_in_detector.py` (structuring detection < ₹50k with merchant exclusions)
   - `fan_out_detector.py` (dispersal detection with payroll exclusions)
   - `relay_chain_detector.py` (multi-hop layering with hop decay)
2. **Task 2 — Autonomous Investigation Agent:**
   Implement case reasoning agent to build explainable SAR narratives from detected graph subgraphs.
3. **Task 3 — Benchmark Evaluator:**
   Evaluate detector Precision, Recall, and F1 against the isolated `labels` graph.
