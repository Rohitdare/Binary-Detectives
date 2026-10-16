# RingTrace Project Status & Roadmap

**Current Milestone:** Phase 3 — Directed Transaction Cycle Detector  
**Status:** Complete & Fully Validated (Backend, Cypher, UI, & Tests)  
**Last Updated:** 2026-10-15  

---

## 1. Completed Capabilities

- [x] **Member B Step 3: Agent Loop, Validator, and Deterministic Fallback (2026-10-16):**
  - Integrated `google-genai` SDK with centralized caller in `backend/app/agent/llm.py` (`is_llm_available()`, timeout protection, error abstraction).
  - Defined Gemini tool schemas in `backend/app/agent/tool_definitions.py`.
  - Built anti-hallucination evidence validator in `backend/app/agent/validator.py` asserting all `ACC_...`, `TX_...`, `demo_...`, and `CASE_...` IDs exist in authorized evidence.
  - Implemented deterministic safe fallback engine in `backend/app/agent/fallback.py` running fixed tool sequence (`get_case`, `expand_neighborhood`, `pagerank`, `community`, `find_similar_cases`), rule-based action proposal, and structured Markdown narrative template with zero API key requirement.
  - Multi-turn orchestrator in `backend/app/agent/loop.py` coordinating 8-turn tool budget, step events, validation retries, and seamless fallback.
  - Test suite in `backend/tests/test_agent.py`: 7/7 passed. Full test suite: 52/52 passed.
  - Next: Step 4, FastAPI Endpoints + SSE Streaming Feed (`/api/v1`).

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
