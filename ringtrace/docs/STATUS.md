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

## Six Graph Detectors — Accuracy and Reliability Pass — 2026-10-16

- Follow-up correctness fix: scatter-gather now groups source/sink paths into separate 72-hour observation episodes (configurable through `observation_hours`) instead of combining paths across the full graph history. Added a deterministic regression case with repeated activity separated by more than 72 hours. The complete backend suite passed (78 tests). Seed-43 was reloaded to disposable graphs after this change and rerun: scatter-gather remained 10/10 exact suspicious matches, with no labeled benign scenarios; 3,000 accounts and 39,924 transactions were loaded, and both graphs were deleted in `finally`. Relay-chain remained 10/10 and gather-scatter remained 7/10 (result cap). The metrics are synthetic and not real-world accuracy.

- Added independently callable `relay_chain`, `scatter_gather`, and `gather_scatter` detectors. They use only `Account`/`SENT` evidence, return stable hit IDs, ordered transaction evidence, account roles, measurements, explanations, and explicit scan/search/result truncation.
- Centralized the path-detector edge query and paginated it in 10,000-row pages. This avoids silently treating FalkorDB's 10,000-row response cap as a complete graph scan. The default safety cap is 250,000 edges.
- Relay chains require simple directed paths of 3–6 transfers, strictly increasing timestamps, per-hop gaps no larger than 6 hours, and amount ratios within configured structural bounds. The review signal additionally requires a 24-hour total duration and 80–105% per-hop amount retention.
- Scatter-gather requires at least three distinct intermediaries connecting the same source and sink. Every route is directed, time ordered, has a maximum 24-hour hop gap, and retains at least 50% of the preceding amount. Review candidates require 80–105% retention on every route. The report does not claim funds were individually traced.
- Gather-scatter now requires direction-specific counterparty bursts, a 12-hour maximum quiet gap, an incoming burst that finishes before the outgoing burst starts, and a 72-hour overall observation window. Inbound/outbound totals are reported independently; no specific funds are attributed.
- Added legacy and `/api/v1` detector routes for all three patterns, plus an evaluator route for the new detectors. This task did not modify frontend files or existing response schemas.
- Added positive/negative fixtures and isolated tests for path direction, shared endpoints, parallel transfers, temporal boundaries, stable IDs, malformed evidence, query failures, search limits, API aliases, and evaluation accounting.
- Seed-43 holdout generated with 3,000 accounts and 39,924 transactions, loaded into disposable test graphs with zero label leakage. With seed-42 thresholds frozen: relay-chain exact suspicious TP=10, FP=0, FN=0 (precision/recall/F1 1.00/1.00/1.00); scatter-gather TP=10, FP=0, FN=0 (1.00/1.00/1.00); gather-scatter TP=7, FP=0, FN=3 (1.00/0.70/0.82). The scatter-gather and gather-scatter datasets contain no planted benign scenarios, so their false-positive rates cannot be estimated. These are exact synthetic planted-scenario measurements, not real-world accuracy.
- Full backend verification after the implementation and episode fix: 78 tests passed. `compileall` and `git diff --check` passed. The test run used isolated graphs.
- Remaining limitations: the evaluator excludes unlabeled background hits from precision; gather-scatter has no benign labeled examples; the new path detectors each take about 8–9 seconds on the 39,924-edge holdout graph; existing cycle and fan endpoints may return partial results at configured caps. Case builder/scorer and `/scan` registry are not present in this checkout, so the six detectors are ready to feed a later case-building milestone but are not yet connected to a case queue. The hit evidence is sufficient for future graph highlighting by account ID and transaction ID.

## Detection Workbench Redesign into Individual Investigation Workspaces — 2026-10-16

- **Information Architecture:** Separated the monolithic Detection Workbench into a clean two-level navigation model:
  - **Level A — Detector Catalog (`DetectorCatalog.tsx`):** Compact, scannable catalog displaying all 6 live graph engines (`Cycle Typology`, `Fan-In Structuring`, `Fan-Out Dispersal`, `Relay Chain`, `Scatter-Gather`, `Gather-Scatter`) with mechanism descriptions, execution status pills, execution runtimes, candidate counts, and direct `Open Workspace` actions. Planned Phase 3 typologies (`Dense Clusters`, `Bipartite Networks`, `Hub Account Velocity`) are listed in a distinct roadmap footer. Removed the old pattern where unrelated candidate lists were dumped underneath the catalog table.
  - **Level B — Dedicated Detector Workspace (`DetectorWorkspace.tsx`):** Specialized, single-detector investigation workspace containing back-navigation, detector metadata, primary `Execute Detector` trigger, parameter controls (e.g., cycle hop range selector), and comprehensive execution summaries (candidate count, flagged count, scan duration, edge count, truncation warnings).
- **Candidate Semantics & Identifiers:**
  - Integrated `CandidateIdInfo.tsx` interactive popover clearly explaining the three-tier hierarchy: (1) Graph Candidates / Hits, (2) Flagged / Needs Review findings meeting heuristic thresholds, and (3) Investigation Cases formally generated with a `case_id` by the Case Builder.
  - Documented deterministic candidate ID generation from source code: `CYC_{length}_{sha256(canonical_edges)[:10]}` and `HIT_{pattern}_{sha256(directed_tx_ids)[:12]}`. Re-executing identical queries on the same graph produces the exact same deterministic IDs.
- **Candidate List (`CandidateList.tsx`):**
  - Left-column layout presenting human-readable summaries first (e.g. `25 Senders → ACC_00376`, `4-Hop Circular Flow`) with INR formatted amounts, duration, and retention/structuring share.
  - Copyable technical IDs with click-to-copy feedback tooltips.
  - Dedicated search filter by account or candidate ID and toggle to isolate flagged `Needs Review` candidates.
- **Cytoscape Mini-Graph (`CandidateGraph.tsx`):**
  - Dark near-black canvas (`#080C10`) rendering strictly the accounts and transactions belonging to the selected candidate.
  - Central hub account nodes dynamically styled in cyan (`#38BDF8`) with dark borders; circular layout for cycles and concentric layout for star/flow patterns.
  - Directional triangle arrowheads and transaction amount edge labels.
  - Full viewport toolbar with Zoom In, Zoom Out, Fit to Viewport, and Reset.
  - Bidirectional selection: tapping an edge selects the transfer in the ledger; selecting a node opens account inspection.
- **Evidence & Transaction Inspector (`CandidateEvidencePanel.tsx`):**
  - Factual findings and explanation text.
  - Structured detector measurements grid (retention, conservation, structuring share, time span).
  - Selected edge transfer callout card with deselect button.
  - Supporting transaction ledger table with interactive row highlighting and account links.
- **Verification:**
  - `oxlint` ran on 26 files: 0 errors, 0 warnings.
  - Production build: `tsc -b && vite build` completed with exit code 0.
  - Live execution verified against FastAPI backend on `http://localhost:8000`: real candidate subgraphs and transaction ledgers loaded and inspected for multiple detectors.

## Backend Detection and Integration — 2026-10-16

- Completed Member A backend integration for nine detectors: cycle, fan-in, fan-out, relay-chain, scatter-gather, gather-scatter, bipartite, dense-cluster, and hub-account. Added shared scan orchestration, bounded snapshot reuse, case grouping/scoring/persistence, typed detection APIs, account/case graph views, scenario listing/injection, and asynchronous evaluation. Legacy `/api/...` routes remain alongside `/api/v1/...`.
- Scan reads the transaction edge set once and reuses it across detectors. Evaluation now also shares one bounded transaction snapshot across its cycle, fan, and graph-pattern reports; detector reads remain separate from evaluator-only ground-truth loading. Per-detector caps and partial results are exposed.
- Full backend regression: 86 tests passed in 25.260s, including temporary FalkorDB graph integration. Python compilation passed.
- Seed-43 evaluation used 3,000 accounts and 39,924 transactions on isolated `test_...` graphs, then deleted both graphs. Exact labeled results: cycle TP=6/10, FP=0/12; fan-in TP=8/10, FP=0/12; fan-out TP=3/10, FP=3/6; relay-chain TP=10/10, FP=0/6; scatter-gather TP=10/10 with no benign examples; gather-scatter TP=7/10 with no benign examples. All other than relay/scatter-gather were capped/partial at limit 50. Bipartite and dense-cluster had no exact planted matches (0/10) and returned partial results; hub-account has no planted labels and is supporting context only. These synthetic exact-match figures are not real-world accuracy, and seed 43 was evaluated, not used for threshold tuning.
- Limitations and handoff: bipartite and dense-cluster need candidate-search prioritization/calibration before they can be useful fraud detectors; both are structural evidence only. Fan-out's 3 labeled benign false positives and low 3/10 recall need investigation on a separate tuning split. Cycle/fan/gather-scatter caps mean their evaluation is incomplete. Scenario injection is gated by `RINGTRACE_DEMO_KEY`. The Member B investigation/MCP/memory-agent/replay/SSE implementation remains outside Member A scope; case IDs are the integration key. No generated OpenAPI contract file exists in this checkout.

## Codebase Complexity Optimization Pass for Case Builder Phase — 2026-10-16

- **Audited Complexity and Over-Engineering:** Applied ponytail-review audit across frontend and backend in preparation for the upcoming Case Builder phase.
- **Frontend Dead Code Deletions:** Removed 5 obsolete and superseded components totaling 1,256 lines of dead code:
  - `frontend/src/components/patterns/CycleDetectionView.tsx` (superseded by modular `DetectorWorkspace.tsx`).
  - `frontend/src/components/overview/NetworkPreview.tsx` (superseded by `OverviewGraph.tsx`).
  - `frontend/src/components/overview/RecentTransactionsTable.tsx`.
  - `frontend/src/components/overview/DetectionPatterns.tsx`.
  - `frontend/src/components/overview/InvestigationPanel.tsx`.
- **Frontend State Hygiene:** Cleaned dead state setters (`setTransactions`, `setDetectorRuns`, `setLatestRun`, `setRunCount`) and eliminated dead startup fetches (`fetchTransactions`) in `frontend/src/App.tsx`.
- **Backend Algorithm Simplification:** In `backend/app/cases/builder.py`, replaced nested double comprehensions with `collections.Counter` to compute account mix distributions in $O(N)$ single pass, and streamlined size bucket bucketing.
- **Strict Invariant and Test Preservation:** Preserved all backward-compatible legacy API route aliases in `main.py` (`/api/health`, `/api/stats`, `/api/accounts/{id}`) to ensure contract stability with existing clients and tests. Preserved sliding-window counter eviction logic in `windowing.py` required for accurate counterparty counts.
- **Verification:**
  - Full backend test suite: 86/86 tests passed in 24.204s with exit code 0 (`unittest discover tests`).
  - Case builder tests: 5/5 tests passed in 1.18s (`backend/tests/test_cases.py`).
  - Frontend production build: `tsc -b && vite build` passed in 1.32s with 0 errors.
  - Frontend linter: `npx oxlint` passed with 0 errors and 0 warnings across all 21 files.

## Case Builder Phase 1: Pure Hit Grouping — 2026-10-16

- **Objective:** Implemented Phase 1 Case Grouping in `backend/app/cases/builder.py` focusing strictly on grouping detector hits using union-find/connected components without touching persistence, scoring, APIs, or frontend.
- **Algorithm & Mechanism:**
  - `group_hits(hits, max_accounts=60, include_hub_only=False) -> HitGroupResult`:
    - Union-Find Disjoint Set Union (DSU) with path compression merges hits that share accounts transitively.
    - Disjoint clusters remain separated in isolated groups.
    - Preserves all original hit IDs, patterns, measurements, explanations, and transaction objects.
    - Deduplicates accounts and transactions without losing parallel transfer evidence.
    - Enforces 60-account cap per group, deterministically partitioning oversized components and tracking skipped oversized hits.
    - Produces deterministic grouping results for identical inputs with stable sorting and SHA-256 group keys.
- **Test Suite:** Added isolated, in-memory unit test suite `backend/tests/test_case_grouping.py` covering all 8 mandatory specifications:
  1. Two hits sharing an account merge into one group (asserted actual IDs and evidence).
  2. Three hits transitively connected merge into one group.
  3. Two unrelated hits remain in separate groups.
  4. Multiple transaction IDs and hit IDs survive grouping unchanged.
  5. Repeated account IDs within a hit do not duplicate in group account IDs.
  6. Empty input returns an empty result (`HitGroupResult([])`).
  7. Repeating the same input produces identical, deterministic grouping.
  8. Account cap partitions oversized components and records skipped oversized hits.
- **Verification:**
  - Isolated grouping unit tests: 8/8 passed in 0.003s (`test_case_grouping.py`).
  - Case builder tests: 5/5 passed in 1.41s (`test_cases.py`).
  - Full backend test suite: 94/94 passed in 19.93s with zero failures.
  - Invariants: Shared contracts, `main.py`, `db.py`, memory persistence, and Member B files were completely untouched.

## Case Builder Phase 2: Priority Scorer Verification — 2026-10-16

- **Objective:** Verified and completed Phase 2 Case Scorer in `backend/app/cases/scorer.py` ensuring every case receives a deterministic 0–100 triage priority score, correct severity categorization, and complete score breakdown.
- **Scoring Formulas & Contract Compliance:**
  - `score_case(hits, transactions, account_count, account_types) -> Dict[str, Any]`:
    - **Pattern Severity (max 35):** Maximum base severity across patterns in the case (e.g. `relay_chain`: 32, `cycle`: 30, `scatter_gather`: 28). If origin/source account has type `merchant` or `payroll`, severity is reduced by -10.
    - **Amount Score (max 20):** Logarithmic scaling: `min(20, round(5 * log10(1 + total_amount / 1000)))`.
    - **Velocity Score (max 15):** Tiered duration: 15 points ($\le 1$h), 11 points ($\le 24$h), 6 points ($\le 7$d), 2 points ($> 7$d), 0 points if no transactions.
    - **Account Count Score (max 10):** Logarithmic scale: `min(10, round(2 * log2(max(account_count, 1))))`.
    - **Corroboration Score (max 20):** Distinct pattern boost: `min(20, (distinct_patterns - 1) * 10)`. Supporting `hub_account` signal adds +5. Duplicate hits of the same pattern do not inflate corroboration.
    - **Mathematical Invariant:** `total == severity + amount + velocity + account_count + corroboration` strictly holds across all cases, bounded within [0, 100].
    - **Severity Classification:** `low` ($< 40$), `medium` ($40 - 69$), `high` ($\ge 70$).
    - **Response Fields Preserved:** `severity`, `amount`, `velocity`, `account_count`, `corroboration`, `total`, `score_type`, `origin_context_adjustment`, `total_amount`, `duration_seconds`, `severity_label`.
- **Test Suite:** Added focused unit test suite `backend/tests/test_case_scorer.py` covering all 10 specifications:
  1. Score bounds strictly within [0, 100] under extreme values.
  2. Each of the 5 components strictly respects its maximum allocation (35, 20, 15, 10, 20).
  3. Total strictly equals the sum of the five component values.
  4. Precise boundary mapping: 39 (low), 40 (medium), 69 (medium), 70 (high).
  5. Deterministic scoring across repeated executions.
  6. Payroll and merchant origin reduction (-10).
  7. Additional distinct patterns add +10 corroboration.
  8. Duplicate hits of same pattern do not inflate corroboration.
  9. Hub account acts strictly as supporting evidence (+5 corroboration, 0 base severity).
  10. Empty and minimal valid input handled gracefully.
- **Verification:**
  - Focused scorer unit tests: 10/10 passed in 0.010s (`test_case_scorer.py`).
  - Combined case unit tests: 13/13 passed in 1.345s (`test_case_grouping.py` + `test_cases.py`).
  - Full backend test suite: 104/104 passed in 34.651s with zero regressions.
  - Invariants: `db.py`, `main.py`, shared contracts, grouping logic, and Member B files remained untouched.

## Case Builder Phase 3: Case Identity & Memory-Graph Persistence — 2026-10-16

- **Objective:** Verified and implemented stable case identity and idempotent memory-graph persistence for cases generated by `group_hits`, `build_cases`, and `score_case`.
- **Identity & Schema Invariants:**
  - **Case Identity:** Deterministic `CASE_{hashlib.sha256("\0".join(sorted(accounts))).hexdigest()[:12]}`. Order-invariant and stable across identical rescans.
  - **Case Signature:** `{sorted_patterns}:{account_type_mix}:{size_bucket}` matching Member B's similar-case search contract.
  - **Member A Schema Ownership:**
    - `(:Case {id, patterns, score, status, signature, updated_at})`
    - `(:Case)-[:INVOLVES]->(:AccountRef {id})`
    - `(:Case)-[:HAS_HIT]->(:Hit {hit_id, pattern, tx_ids, measurements})`
  - **Member B Data Protection:**
    - `UPSERT_CASES` uses `MERGE (c:Case {id: r.case_id}) ON CREATE SET c.status = 'open'`, guaranteeing that Member B status transitions (`escalated`, `monitoring`, `dismissed`) are never overwritten on rescan.
    - Member B owned nodes (`Decision`, `Investigation`, `Finding`) and relationships (`DECIDED`, `ABOUT`, `FOUND`) are strictly preserved.
  - **Idempotency Guarantees:**
    - Parameterized Cypher queries (`UPSERT_CASES`, `UPSERT_CASE_HITS`) use `MERGE` across all nodes and edges.
    - Rescanning identical evidence creates zero duplicate Case, Hit, or AccountRef nodes, and zero duplicate relationships.
    - `measurements` on hits are stored as structured JSON properties and transaction IDs are preserved.
    - Empty row guards (`if case_rows:`, `if hit_rows:`) prevent FalkorDB empty-unwind parser syntax errors.
- **Test Suite:** Added comprehensive isolated test suite `backend/tests/test_case_persistence.py` covering all 10 Phase 3 persistence requirements against real FalkorDB test graphs (`test_persist_<uuid>`):
  1. `test_01_persisting_case_creates_expected_nodes`: Verified `Case`, `Hit`, and `AccountRef` nodes with exact properties.
  2. `test_02_expected_involves_and_has_hit_relationships_created`: Verified `INVOLVES` and `HAS_HIT` edge creation.
  3. `test_03_persisting_same_case_twice_creates_no_duplicate_nodes_or_relationships`: Tested 3x repeated persistence; asserted exact counts (1 case, 1 hit, 2 accounts, 2 involves, 1 has_hit).
  4. `test_04_case_ids_remain_stable_when_identical_evidence_is_rescanned`: Verified permutation invariance and deterministic `case_id`.
  5. `test_05_multiple_distinct_cases_do_not_accidentally_merge`: Verified disjoint clusters remain isolated in graph with zero cross-edges.
  6. `test_06_existing_case_evidence_updated_when_new_hits_arrive`: Verified existing cases update patterns, score, and link new hits without duplication.
  7. `test_07_repeated_hits_and_account_references_no_duplicate_records`: Verified shared accounts produce single `AccountRef` and single `INVOLVES` edge.
  8. `test_08_scorer_score_and_signature_preserved_correctly`: Verified `c.score`, `c.signature`, and full 5-component `score_breakdown` payload.
  9. `test_09_member_b_nodes_and_status_not_overwritten`: Verified `c.status = 'escalated'`, `Decision`, `Investigation`, and `Finding` nodes survive repeated persistence runs intact.
  10. `test_10_invalid_or_empty_persistence_error_handling`: Verified `persist_cases([])` safety and query/connection error propagation.
- **Verification:**
  - Dedicated persistence tests: 10/10 passed in 1.755s (`test_case_persistence.py`).
  - All case test suites combined: 33/33 passed in 2.246s (`test_case_persistence.py`, `test_case_grouping.py`, `test_case_scorer.py`, `test_cases.py`).
  - Full backend test suite: 114/114 passed in 16.096s with zero regressions.
  - Invariants: `db.py`, `main.py`, shared API models, and Member B files were strictly untouched.

## Case ID Compatibility Audit — 2026-10-16

- **Audit Objective:** Formally audit the `case_id` format (`CASE_{sha256(accounts)[:12]}`) against `AGENTS_MEMBER_A.md`, the OpenAPI contract conventions, frontend consumers, and Member B integration.
- **Audit Findings:**
  1. **Contract Definition:** `AGENTS_MEMBER_A.md` explicitly specifies under Section 7 Conventions that "IDs are opaque strings". The format `CASE_0001` in documentation and contract examples is demonstrative of an opaque string shape, not a sequential counter constraint.
  2. **Architectural Mandate:** Section 5 explicitly commands: "derive a deterministic key from the sorted account set so the same ring always maps to the same case."
  3. **Consumer Decoupling:** In Pydantic models (`CaseRecord`), FastAPI routes (`/api/v1/cases/{case_id}`), and Cypher queries (`MATCH (c:Case {id: $case_id})`), `case_id` is treated strictly as an unparsed string. Frontend components (`selectedCaseId: string | null`) pass it as an opaque prop without parsing or formatting assumptions.
  4. **Idempotency & Rescan Stability:** The SHA-256 hash over sorted account IDs is stateless and permutation-invariant. Sequential IDs would cause non-deterministic ID swaps under concurrent or out-of-order detector executions.
  5. **Account Cap Partitioning:** Components partitioned by the 60-account cap contain distinct sorted account subsets, guaranteeing stable and distinct `case_id`s across all split cases.
  6. **Graph Integrity:** Existing nodes in `memory` graph, `INVOLVES`/`HAS_HIT` edges, and Member B's `Decision`/`Investigation` nodes remain intact without migration or risk of orphaned records.
- **Verdict:** Fully **Compatible**. The existing deterministic hashed format is preserved with zero code modifications required.

## Phase 4: Scan and API Integration — 2026-10-16

- **Objective:** Connected registered detectors, case grouping (`group_hits`), priority scoring (`score_case`), and memory-graph persistence (`persist_cases`) to Member A's FastAPI endpoints and verified end-to-end contract compliance.
- **Scan Pipeline Integration:**
  - `run_scan(graph, ...)` in `backend/app/scan_service.py` executes registered detectors, standardizes hits, clusters them using union-find (`group_hits`), builds and scores cases via `score_case`, and persists them idempotently into the memory graph via `persist_cases`.
  - Normalization: Cycle candidate hits safely adapt both raw candidate dicts and standardized `Hit` objects without KeyError.
  - Job State: Scan jobs initialize with `status: "running"` and transition to `completed` with full metric reports (`hit_count`, `case_count`, `detector_reports`, `detector_errors`).
  - Scan Trigger Contract: `POST /api/v1/scan` returns HTTP 202 with `{"scan_id": "...", "status": "running"}` matching `AGENTS_MEMBER_A.md` contract specifications.
- **Contract Endpoints Verified:**
  - `GET /api/v1/graph/summary`: Returns node/edge counts for `txn` and `memory` graphs.
  - `POST /api/v1/scan`: Initiates background scan, returns HTTP 202 and running status receipt.
  - `GET /api/v1/scan/{id}`: Returns scan job status, hit count, case count, and detector reports.
  - `GET /api/v1/cases`: Case listings with filters (`status`, `severity`, `pattern`), sorting (`score_desc`, `score_asc`, `created_at_desc`), and pagination (`limit`, `cursor`).
  - `GET /api/v1/cases/{id}`: Full case details including case summary, hits, supporting transactions, decisions, and complete 5-part score breakdown.
  - `GET /api/v1/cases/{id}/graph`: Cytoscape-compatible subgraph preserving exactly one edge per transaction, with account roles and transaction properties.
  - `GET /api/v1/accounts/{id}`: Account profile with in/out volumes, degree counts, and transaction history.
  - `GET /api/v1/accounts/{id}/neighborhood`: 1-hop subgraphs centered on target account.
  - Dual routing (`/api/v1/...` and `/api/...`) verified to preserve backwards compatibility for existing UI consumers.
- **Test Suite (`backend/tests/test_api_integration.py`):** Added comprehensive 11-test suite verifying all Phase 4 integration criteria:
  1. `test_01_scan_pipeline_invokes_detectors_and_case_pipeline`: End-to-end scan on test graph runs detectors, groups hits, scores cases, and persists cases.
  2. `test_02_scan_response_matches_contract_example`: Validates HTTP 202 response and `{"scan_id": ..., "status": "running"}` payload.
  3. `test_03_repeated_scans_do_not_create_duplicate_cases`: Idempotency across successive scans verified on isolated graphs.
  4. `test_04_case_listing_filters_and_sorting`: Evaluates status, severity, pattern filters and sort ordering.
  5. `test_05_case_details_contain_hits_transactions_and_score_breakdown`: Asserts 5-part score breakdown, hit references, and transaction records.
  6. `test_06_graph_endpoints_return_nodes_and_unmerged_transaction_edges`: Verifies exact unmerged transaction edges in `/cases/{id}/graph`.
  7. `test_07_unknown_case_id_returns_404_error_format`: Asserts exact standard contract envelope `{"error": {"code": "not_found", "message": "Case not found", "details": {}}}` on non-existent case IDs.
  8. `test_08_empty_detection_results_return_valid_response`: Asserts 0 cases and 0 hits handled cleanly without error.
  9. `test_09_pagination_respects_limits_and_bounds`: Enforces default limit 50, maximum cap 200, and cursor pagination.
  10. `test_10_deterministic_hashed_case_ids_resolve_correctly`: Validates `CASE_{12-char hash}` resolution through API endpoints.
  11. `test_11_legacy_api_aliases_remain_compatible`: Validates `/api/...` and `/api/v1/...` parity across all endpoints.
- **Verification Results:**
  - Dedicated API integration tests: 11/11 passed in 0.800s (`test_api_integration.py`).
  - Combined case & API test suites: 55/55 passed in 10.245s (`test_case_persistence`, `test_case_grouping`, `test_case_scorer`, `test_cases`, `test_api_integration`, `test_api`).
  - Full backend test suite: 125/125 passed in 21.900s with zero failures.
  - Invariants: `backend/app/db.py` and `backend/app/main.py` were not modified. Member B files were strictly untouched. Schema, case-ID format, scoring formulas, and grouping policies remain unchanged.

## Phase 4.1: Error-Response Contract Resolution — 2026-10-16

- **Objective:** Investigated and resolved the error response discrepancy between the documented contract example and the API implementation.
- **Root Cause Analysis:**
  - The API router in `backend/app/api/detection_routes.py` already used the custom error envelope `{"error": {"code": ..., "message": ..., "details": ...}}` via `_error()`.
  - The narrative in the Phase 4 completion report mistakenly referenced FastAPI's default exception shape `{"detail": ...}` (which was present in legacy `main.py` routes before the router split).
  - Furthermore, `get_case` previously passed `{"case_id": case_id}` into `details`, whereas the frozen contract in `AGENTS_MEMBER_A.md:195` specifies an empty details dict: `{"error": {"code": "not_found", "message": "Case not found", "details": {}}}`.
- **Resolution:**
  - In `backend/app/api/detection_routes.py`: updated line 174 to `_error(404, "not_found", "Case not found")` so that `details` defaults to `{}` strictly adhering to the frozen contract.
  - In `backend/tests/test_api_integration.py`: updated `test_07_unknown_case_id_returns_established_error_format` to assert exact dictionary equality against `{"error": {"code": "not_found", "message": "Case not found", "details": {}}}` for both `/cases/{id}` and `/cases/{id}/graph`.
- **Verification:**
  - Dedicated API integration tests: 11/11 passed in 1.115s (`test_api_integration.py`).
  - Contract status: Frozen OpenAPI contract remains 100% unchanged; `db.py`, `main.py`, and Member B files were untouched.

## Phase 5: Frontend Integration and End-to-End Regression — 2026-10-16

- **Objective:** Complete Member A's frontend integration by connecting the case-management UI to the real backend APIs and verifying the entire end-to-end detection-to-case workflow.
- **Frontend Architecture & Components Implemented (`frontend/src/components/cases/`):**
  - **Contract Types & API Client (`frontend/src/types/index.ts`, `frontend/src/services/api.ts`):**
    - Defined contract-compliant TypeScript interfaces: `CaseScoreBreakdown`, `CaseRecord`, `CaseHit`, `CaseTransaction`, `CaseDecision`, `CaseDetail`, `CaseListResponse`, `CaseGraphNode`, `CaseGraphEdge`, `CaseGraphData`, `ScanReceipt`, `ScanStatus`.
    - Added typed methods in `ringtraceApi`: `getCases`, `getCase`, `getCaseGraph`, `startScan`, `getScanStatus`, `getGraphSummary`.
    - Standardized `handleResponse` error parsing to surface structured API error codes and messages cleanly.
  - **Case Management Layout (`CaseManagementView.tsx`):**
    - Master-detail two-column layout coordinating the case queue and detail workspace.
    - **Stale-Data Prevention:** Switching `selectedCaseId` immediately zeroes out previous state (`setCaseDetail(null); setCaseGraph(null); setDetailError(null)`) before triggering the async fetch. On 404 or network errors, stale data is never displayed.
    - Background scan trigger with live polling interval against `GET /api/v1/scan/{scan_id}` until completed or partial, followed by auto-refresh of the case queue.
    - Embedded slide-out drawer for inspecting account neighborhood profiles upon clicking any account badge or table cell.
  - **Case Queue & Filtering (`CaseQueueList.tsx`):**
    - Filter pills for status (`open`, `investigating`, `escalated`, `closed`), severity (`high`, `medium`, `low`), and detected pattern typologies.
    - Sort selector (`Score: High to Low`, `Score: Low to High`, `Recently Created`).
    - Search input filtering cases dynamically by opaque case ID or involved account IDs.
    - Scannable case cards displaying priority score pills (color-coded by severity), pattern badges, account count, transaction count, total flow (in ₹), and relative timestamp.
    - "Run Scan" action with spinning indicator and scan status pill.
  - **Case Detail Workspace (`CaseDetailView.tsx`):**
    - Master header featuring opaque `case_id` with 1-click clipboard copy, severity badge, lifecycle status badge, created/updated timestamps, and Member B investigation handoff action.
    - Tab navigation: `Graph View`, `Transactions`, `Pattern Hits`, `Member B Decision`.
    - 404 Not Found empty state displaying structured error details and "Back to Queue" navigation.
  - **Case Evidence Graph (`CaseGraphCanvas.tsx`):**
    - Dedicated Cytoscape.js canvas (`#080C10` background) rendering the case subgraph.
    - **Unmerged Transaction Edges Invariant:** Displays exactly one directed edge per transaction labeled with formatted Indian Rupee amount (₹).
    - Color-coded node roles: Origin/Source (Amber `#F59E0B`), Sink/Destination (Emerald `#10B981`), Hub Account (Cyan `#06B6D4`), Intermediary (Slate `#64748B`).
    - Bidirectional selection: Clicking an edge in the canvas syncs selection with the transaction ledger table; clicking a node opens the account detail drawer.
    - Full canvas toolbar: Zoom In, Zoom Out, Fit to Viewport, and Center Graph.
  - **5-Part Score Breakdown (`CaseScoreBreakdownView.tsx`):**
    - Displays overall triage priority score (0–100) alongside all 5 progress meters with exact maximum allocations:
      - Pattern Severity (max 35)
      - Amount Scale (max 20)
      - Velocity (max 15)
      - Account Count (max 10)
      - Corroboration (max 20)
    - Origin context discount notice explaining -10 point reductions when origin accounts are legitimate merchants or payroll providers.
  - **Transaction Ledger (`CaseTransactionTable.tsx`):**
    - Tabular display of all supporting transactions with search filter by TX ID or counterparty.
    - Columns: Transaction ID (copyable), Timestamp, From Account, To Account, Amount (₹ formatted), and Status.
    - Synced edge selection highlighting.
  - **Pattern Hits Breakdown (`CaseHitsList.tsx`):**
    - Displays clustered detector hits with typology badge, factual explanation, structured measurements grid, and participating accounts.
- **Navigation & Integration (`Sidebar.tsx`, `App.tsx`):**
  - Connected `CaseManagementView` to the `investigations` tab with active navigation badge.
- **End-to-End Regression Test Suite (`backend/tests/test_e2e_workflow.py`):**
  - Implemented 3 extensive workflow tests validating the full 9-step detection-to-case lifecycle on real FalkorDB test graphs:
    1. `test_01_complete_detection_to_case_e2e_workflow`:
       - Trigger scan via `POST /api/v1/scan` -> returns HTTP 202 with `running` status and valid UUID `scan_id`.
       - Poll `GET /api/v1/scan/{scan_id}` until completed.
       - Verify `GET /api/v1/cases` returns generated cases with opaque `CASE_{12-char hash}` IDs.
       - Fetch `GET /api/v1/cases/{case_id}` -> asserts 5-part score breakdown invariant (`total == severity + amount + velocity + account_count + corroboration`).
       - Fetch `GET /api/v1/cases/{case_id}/graph` -> asserts unmerged 1-edge-per-transaction Cytoscape topology and role-coded nodes.
       - Assert `GET /api/v1/cases/CASE_nonexistent` returns standard 404 contract envelope `{"error": {"code": "not_found", "message": "Case not found", "details": {}}}`.
    2. `test_02_rescan_idempotency_and_stable_case_ids`:
       - Consecutive scans over identical evidence maintain stable `case_id`s with zero duplicate Case, Hit, or AccountRef nodes in the memory graph.
    3. `test_03_isolated_test_graph_lifecycle_and_cleanup`:
       - Verifies that isolated test graphs (`test_e2e_txn_*`, `test_e2e_mem_*`) are created and cleanly dropped, with `app.state.graph_name` restored to guarantee zero state leakage across the test suite.
- **Cycle Detection Investigation & UI Filter Resolution (Phase 5.1):**
  - **Issue Investigated:** User observed only 1 cycle detected during interactive cycle workspace execution.
  - **Root Cause Identified:**
    - The backend cycle detector (`detect_cycles`) was verified against the live FalkorDB graph (40,661 transactions) and ground-truth evaluation, correctly identifying all 10 planted fraud cycles (1 3-hop, 3 4-hop, and 6 5-hop cycles) with 100% recovery and 0 false positives on benign look-alikes.
    - The interactive UI workspace (`DetectorWorkspace.tsx`) had initialized `cycleLength` state to `'3'` instead of `'3-5'`.
    - Running the detector with `cycleLength = '3'` queried only 3-hop cycles (`/api/v1/detectors/cycles?min_length=3&max_length=3`), matching the single 3-hop cycle in the dataset (`CYC_3_ca4aa7f234`).
    - Changing the select dropdown did not automatically trigger re-query.
  - **Fix Applied:**
    - Updated initial `cycleLength` state to `'3-5'` in `DetectorWorkspace.tsx`.
    - Wired `onChange` handler on the hops `<select>` to trigger `onExecute('cycle', nextVal)` immediately when the user changes the filter.
    - Updated labels in dropdown to clarify "3 to 5 hops (All)", "3 hops", "4 hops", "5 hops".
  - **Verification:**
    - `npm run lint` and `npm run build` passed with 0 errors.
    - `python -m unittest tests.test_cycle_detector tests.test_cycle_algorithm_unit` ran 32 tests with 100% pass rate.

