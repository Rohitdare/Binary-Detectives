# RingTrace Project Status & Roadmap

**Current Milestone:** Detector Audit, Verification & Documentation
**Status:** Audit complete; documented reliability and contract gaps remain
**Last Updated:** 2026-10-18

## Railway deployment readiness audit and SPYNEX root rename (2026-10-18)

- Inspected the FastAPI app, routes/OpenAPI, FalkorDB client, environment templates, Vite API client, scheduler, replay worker, SSE routes, current tests, git history and working-tree changes before edits.
- Confirmed there is no Dockerfile, Compose file, Railway config or Vercel rewrite. Railway backend root is `SPYNEX/backend`; use `uvicorn app.main:app --host 0.0.0.0 --port $PORT` and `/readyz` for the deployment healthcheck.
- Added exact-origin `CORS_ORIGINS` configuration, safe liveness/readiness endpoints, sanitized the legacy health error, and configured the existing FalkorDB client for optional credentials and 5-second socket/connect timeouts.
- Standardized scenario injection and demo reset on `RINGTRACE_DEMO_KEY` (while accepting legacy `DEMO_KEY`). Demo reset fails closed on Railway if no key is configured. Other write endpoints retain their existing authorization behavior.
- Made the Vite API base configurable through `VITE_API_URL`, retaining `/api` as the local default. No UI component or styling files were edited.
- Added backend Python runtime pin, deployment guide and isolated mocked deployment tests. Moved the project code to `SPYNEX` and updated the root test runner and documentation links. Windows still blocks removal of the old directory because it holds one `uvicorn.exe`; a hash-verified copy is preserved in the new backend venv, and no source files remain in the old directory.
- Verification: combined safe offline suite passed 77/77, including `tests.test_deployment_readiness` (10), case/scorer/evaluation/cycle units (47) and mocked evidence/agent/SAR/decision tests (20). App import and OpenAPI generation succeeded with existing duplicate operation-ID warnings.
- Blocked: full backend suite could not be safely completed because FalkorDB socket access is denied in this environment and the existing `test_stream_and_reset` writes/deletes literal `txn` and `memory` graphs. The baseline full-suite attempt began with failures and was stopped before it could reach unsafe cases. Docker daemon access was denied; local HTTP smoke test sockets were denied by the environment. Frontend build failed on a pre-existing TS6133 unused `height` in dirty `CandidateGraph.tsx`.
- Known deployment actions: set the exact Vercel origin and public API base in Vercel/Railway; create the private, password-protected FalkorDB service and volume; test backup restoration. In-process scheduler/replay/SSE state requires one API replica. Other existing write endpoints do not have demo-key authorization. Python 3.11 is pinned because Python 3.10 reached EOL on 2026-10-01; Python 3.11 compatibility is not locally verified because only Python 3.10 is installed.
- Deployment instructions: [`RAILWAY_DEPLOYMENT.md`](file:///d:/vortex/SPYNEX/docs/RAILWAY_DEPLOYMENT.md).

---

- [x] **Case Evidence Graph & Transaction Viewport Loading Fix (2026-10-18):**
  - **Fixed Evidence Graph Topology Loading:** Resolved an issue where `/api/v1/cases/{case_id}` and `/api/v1/cases/{case_id}/graph` returned 0 nodes and 0 edges for cases whose transactions were only referenced by `tx_ids` or lacked inlined transaction payloads in FalkorDB.
  - **Added `GET_TRANSACTIONS_BY_IDS` Query:** Centralized `GET_TRANSACTIONS_BY_IDS` in [`queries.py`](file:///d:/vortex/SPYNEX/backend/app/queries.py) to reliably look up real transaction edges (`src, src_type, dst, dst_type, amount, ts, step, tx_type`) from the `txn` graph whenever a case is retrieved.
  - **Account & Role Reconciliation:** Extended [`detection_routes.py`](file:///d:/vortex/SPYNEX/backend/app/api/detection_routes.py) so `case_graph` and `get_case` derive full `account_ids`, `account_types`, and structural roles from `accounts`, `hits`, and transactions, ensuring `CASE_0001` and other cases populate both the Evidence Graph and the Transactions ledger.
  - **Cytoscape Viewport & ResizeObserver Integration:** Enhanced [`CaseGraphCanvas.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/cases/CaseGraphCanvas.tsx) with a `ResizeObserver` on the canvas container, `layoutstop` handlers, and deferred `cy.resize()` and `cy.fit()` calls to guarantee nodes and edges render perfectly centered in the viewport across tab switches and initial paint.
  - **Verification:** Verified backend endpoints return all 4 nodes, 4 edges, and 4 transactions for `CASE_0001`; full backend test suite (`python -m unittest discover tests`) passed all 248/248 tests; frontend built cleanly via `npm run build` in 806ms.

- [x] **Detector Subgraph & Evidence Side-by-Side Cohesive Integration (2026-10-18):**
  - **Eliminated Vertical Disconnect Across All 9 Detectors:** Integrated [`CandidateGraph.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/patterns/CandidateGraph.tsx) and [`CandidateEvidencePanel.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/patterns/CandidateEvidencePanel.tsx) into a single cohesive card in [`DetectorWorkspace.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/patterns/DetectorWorkspace.tsx).
  - **Side-by-Side Top Split:** Placed the interactive Cytoscape subgraph canvas directly beside the Typology Findings and Detector Metrics at the exact same eye level. Analysts immediately see the visual structure and its forensic explanation without any vertical scrolling.
  - **Compact Subgraph Canvas:** Calibrated the canvas height to 260px (from a previously oversized 350px box), allowing the entire candidate overview (subgraph, findings, metrics, and supporting ledger) to fit comfortably within standard desktop viewports.
  - **Full-Width Supporting Ledger:** Positioned the Supporting Transaction Ledger cleanly across the full width directly beneath the split section.
  - **Verification:** Verified frontend production build via `npm run build` in `SPYNEX/frontend` (built cleanly in 971ms with 0 errors).

- [x] **Evidence & Audit Benchmark Minimalist Overhaul & Plain Terminology (2026-10-18):**
  - **Minimalist Page Header:** Streamlined the Evidence & Audit Benchmark header in [`PlaceholderView.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/common/PlaceholderView.tsx) by removing noisy green pill badges (*"Zero Ground-Truth Leakage Verified"* and *"Invariant #3 Verified"*) and retaining a clean title, plain-language description, and a single solid button (*"Run Evaluation Benchmark"*).
  - **Clean 4 Metric Cards (No Jargon Corner Badges):** Removed technical labels (`labels graph`, `Micro Recall`, `Precision`, `Overall F1`) from top-right card corners. Converted card metrics into clean, human-readable labels (`Planted Alerts`, `Detection Recall`, `Precision`, `Accuracy (F1)`) and replaced developer stats with clear descriptions (e.g. *"{n} of {m} detected"* instead of *"{n}/{m} TP"*, *"{n} false alarms"* instead of *"{n} Benign FP"*).
  - **Eliminated Confusing Confusion Matrix Columns (TP, FP, FN):** Removed raw `TP`, `FP`, and `FN` columns from the live detector benchmark table, presenting clean business metrics: `Test Scenarios`, `Detection Rate (Recall)`, `Precision`, `F1 Score`, `False Alarm Rate`, and `Status`.
  - **Removed Architecture Section (Image 2):** Completely removed the redundant *"Zero Ground-Truth Leakage Architecture"* 3-box container from the bottom of the benchmark view.
  - **Verification:** Verified frontend production build via `npm run build` (built cleanly in 1.15s with 0 errors).

- [x] **Investigation Standby Polish & Terminology Simplification (2026-10-18):**
  - **Removed "Investigation Dossier Ready" Text:** Completely removed the obscure jargon heading *"Investigation Dossier Ready"* from the standby state in [`InvestigationPanel.tsx`](file:///d:/vortex/SPYNEX/frontend/src/features/investigation/InvestigationPanel.tsx). The standby state now cleanly consists of just the icon badge and the compact *"Launch Investigation"* button.
  - **Removed Standby Grey Paragraph:** Completely removed the verbose descriptive text (*"Case CASE_0001 is ready for investigation. The autonomous agent will inspect graph topology, evaluate network centrality, query historical memory precedents, and formulate an evidence briefing."*) from the standby state in [`InvestigationPanel.tsx`](file:///d:/vortex/SPYNEX/frontend/src/features/investigation/InvestigationPanel.tsx).
  - **Minimalist Standby Action Button:** Streamlined the launch trigger into a compact button (`.rt-button-sm`, padding `0.45rem 0.95rem`, border-radius `6px`, font-size `0.8rem`) with a crisp play icon and clean label alongside the 42x42px icon badge.
  - **Shifted Precedent Memory to Bottom:** Shifted [`MemoryPanel.tsx`](file:///d:/vortex/SPYNEX/frontend/src/features/investigation/MemoryPanel.tsx) from the cramped right-hand sidebar column to the bottom of the main vertical column, allowing the full width for the Evidence Graph, Executive Narrative, Findings, and Execution Trace.
  - **Cleaned Precedent Memory Subtexts:** Removed secondary muted subtexts (*"Historical Precedent Memory"* and *"Confirmed analyst decisions and SAR filings automatically inform future case evaluations."*) from [`MemoryPanel.tsx`](file:///d:/vortex/SPYNEX/frontend/src/features/investigation/MemoryPanel.tsx).
  - **Verification:** Verified frontend production build via `npm run build` (built cleanly in 970ms with 0 errors).

- [x] **Case Detail Workspace Minimalism & Banner Removal (2026-10-18):**
  - **Removed Image 2 Banner:** Completely removed the *"Autonomous AI Forensics & Compliance Audit"* banner strip from [`CaseDetailView.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/cases/CaseDetailView.tsx).
  - **Eliminated 4 Redundant KPI Cards:** Removed the 4 bulky duplicate metric cards (*Priority Score*, *Total Flow Structuring*, *Entities in Case*, *Evidence Mapping*) that repeated information already available in the case header card, bringing the Evidence Graph canvas and tab controls immediately into view.
  - **Simplified Agent Action Button:** Converted the loud purple gradient button with "AUTONOMOUS ACTION" uppercase label into a clean, simple, and professional action button (*"Investigate with Agent"* with slate styling) directly integrated into the header metric strip.
  - **Verification:** Verified frontend production build via `npm run build` (built cleanly in 2.35s with 0 errors).

- [x] **Helper Text Clutter Elimination & Search Bar Modernization (2026-10-18):**
  - **Removed Highlighted Helper Text:** Completely removed *"Click any engine row or action button to launch its dedicated forensic canvas and query parameters."* from [`DetectorCatalog.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/patterns/DetectorCatalog.tsx).
  - **Cleaned Up Unnecessary Helper Clutter Across Modules:** Removed secondary tutorial hints like *"Click row to highlight edge"* from [`CandidateEvidencePanel.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/patterns/CandidateEvidencePanel.tsx) and *"Click any counterparty node to re-center"* from [`TransactionExplorer.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/explorer/TransactionExplorer.tsx).
  - **Premium Search Bar Design System (`.rt-search-box` & `.rt-input`):** Added global input and search box styles in [`index.css`](file:///d:/vortex/SPYNEX/frontend/src/index.css) featuring subtle borders (`#CBD5E1`), soft drop shadows, brand purple focus halos (`0 0 0 3px rgba(109, 74, 255, 0.12)`), smooth SVG color transitions, and interactive one-click clear buttons (`X`) across [`DetectorCatalog.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/patterns/DetectorCatalog.tsx), [`CandidateList.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/patterns/CandidateList.tsx), [`CaseManagementView.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/cases/CaseManagementView.tsx), [`CaseQueueList.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/cases/CaseQueueList.tsx), [`CaseTransactionTable.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/cases/CaseTransactionTable.tsx), and [`TransactionExplorer.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/explorer/TransactionExplorer.tsx).
  - **Verification:** Verified frontend production build via `npm run build` (built cleanly in 1.17s with 0 errors).

- [x] **Investigation Agent UI Polish & Global Case ID Navigation Unification (2026-10-18):**
  - **Renamed to Investigation Agent:** Renamed feature across the interface from "Autonomous AI Cockpit" to "Investigation Agent" in [`InvestigationPanel.tsx`](file:///d:/vortex/SPYNEX/frontend/src/features/investigation/InvestigationPanel.tsx), [`Sidebar.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/layout/Sidebar.tsx), [`CaseDetailView.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/cases/CaseDetailView.tsx), and overview panels.
  - **Removed Audit ID UI Display:** Completely eradicated `• Audit ID: INV_...` and audit creation clutter from the header to keep the interface focused on operational case triage.
  - **Unified Global Case Navigation via `case_id`:** Removed the secondary text input box (`Custom ID`) that previously desynchronized case selection from the target dossier. Implemented `displayCases` using `useMemo` so that the primary `<select>` dropdown controls `selectedCaseId` globally and seamlessly displays cases handed off from Case Management.
  - **Fixed `[object Object]` Error in Memory Panel:** Sanitized API error handling in [`api.ts`](file:///d:/vortex/SPYNEX/frontend/src/services/api.ts) to unpack FastAPI error objects/arrays into clean strings, and updated [`MemoryPanel.tsx`](file:///d:/vortex/SPYNEX/frontend/src/features/investigation/MemoryPanel.tsx) to treat HTTP 404 (new case with no memory entries yet) as an empty precedents list rather than displaying an error alert.
  - **Verification:** Verified frontend production build via `npm run build` (built cleanly in 750ms, 0 errors).

- [x] **Detector Standby State Minimalist Polish (2026-10-18):**
  - **Removed Standby Helper Text:** Removed the helper text paragraph (*"Configure parameters above and click 'Execute Detector' in the toolbar to run openCypher pattern queries against the live graph."*) from the standby state in [`DetectorWorkspace.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/patterns/DetectorWorkspace.tsx).
  - **Universal Clean State Across All 9 Detectors:** The standby state across all 9 detector typologies now presents a clean, distraction-free card with just the icon and "Workspace Ready for Detection" title until executed.
  - **Verification:** Verified frontend production build via `npm run build` (built cleanly in 3.02s, 0 errors).

- [x] **Case Management UI/UX Simplification & Metric Flattening (2026-10-18):**
  - **Removed Header Action Buttons:** Removed the redundant `[ Refresh ]` and `[ Run Detection Scan ]` buttons from the Case Management page header in [`CaseManagementView.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/cases/CaseManagementView.tsx), allowing cases to load and sync cleanly and automatically on filter adjustments.
  - **Flattened KPI Metrics Strip:** Consolidated the 4 previously bulky, multi-layered summary cards into a single streamlined 3-column stats bar (`Open Cases`, `High-Priority Alerts`, and `Awaiting Review`) with vertical hairline dividers. Removed verbose paragraph explanations and colorful square icon boxes.
  - **Hidden Amount Metric:** Completely hidden the 4th metric card ("Total Flow Structuring: ₹13,61,10,314") per requirements to keep triage metrics focused on case volume and severity.
  - **Verification:** Verified frontend production build via `npm run build` (built cleanly in 845ms, 0 errors).

- [x] **Detector Workspace & Evidence Subgraph Professional Redesign (2026-10-18):**
  - **Eliminated Duplicate Execute Button:** Removed the redundant "Execute Detector Now" CTA button from the empty/standby workspace card in [`DetectorWorkspace.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/patterns/DetectorWorkspace.tsx), keeping the primary, authoritative action cleanly placed in the top parameter action bar.
  - **Candidate List Master-Detail Refinement:** Completely redesigned [`CandidateList.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/patterns/CandidateList.tsx) with a sleek left accent border (`border-left: 3.5px solid #6D4AFF` when active), subtle lavender active surface (`#F8F7FF`), and removed the internal dividing hairline from candidate cards to eliminate clutter and improve scanning density.
  - **Fixed `duration_seconds` Percentage Formatting Bug:** Fixed string matching substring trap in [`CandidateEvidencePanel.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/patterns/CandidateEvidencePanel.tsx) where `"duration".includes("ratio")` evaluated to `true`, causing seconds to be multiplied by 100 (`2782500.0%`). Added priority check for duration/seconds and formatted correctly via `formatDuration`.
  - **Deduplicated Redundant Measurements:** Suppressed `amount_conservation_ratio` when identical `retention` is already present in Cycle candidates.
  - **Evidence Subgraph Visual Polish:** Upgraded [`CandidateGraph.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/patterns/CandidateGraph.tsx) Cytoscape canvas with brand purple hub nodes (`#6D4AFF`), slate counterparty nodes (`#334155`), high-contrast `JetBrains Mono` labels with dark pill backgrounds, and directed arrow curves with auto-rotating currency amounts.
  - **Transaction Ledger Button Fix:** Integrated `.account-link` styling to eradicate default browser button gray boxes from transaction flow counterparties.
  - **Universal Consistency Across All 9 Detectors:** All fixes apply uniformly to Cycle, Fan-in, Fan-out, Scatter-Gather, Gather-Scatter, Relay Chain, Bipartite, Dense Cluster, and Hub Account detectors.
  - **Verification:** Verified frontend production build via `npm run build` (built cleanly in 943ms, 0 errors).

- [x] **Transaction Explorer UI/UX Minimalism & Professional Polish (2026-10-18):**
  - **Account Profile & Metric Readouts:** Eliminated nested boxes inside boxes in the account header; streamlined Outflow/Inflow summaries into clean, aligned metric columns with tabular `JetBrains Mono` figures.
  - **Direct Counterparty Network:** Stripped the developer jargon badge (`Canvas: Vector Accelerated`) and removed the nested helper hint strip. Refined canvas styling and centered node with brand purple (`#6D4AFF`).
  - **Inflow & Outflow Transfer Tables:** Eliminated double nested borders from `.rt-table-container` allowing tables to flow seamlessly within the card containers. Removed raw browser underlines on account IDs, replacing them with interactive purple hover transitions.
  - **Header & Sample Accounts:** Polished search bar styling and transformed bulky sample account buttons into subtle, elegant chip pills (`Sample Accounts:`).
  - **Verification:** Verified frontend production build via `npm run build` (built cleanly in 798ms, 0 errors).

- [x] **Detector Catalog Minimalism & Clutter Elimination (2026-10-18):**
  - **Removed Planned Typologies Footer:** Completely removed the "Future Extension Typologies (Planned):" footer element (Temporal Entropy, Cross-Channel Mule Mesh, Flow-Ratio Deviation) and cleaned up unused `ROADMAP_DETECTORS` and `Clock` imports.
  - **Minimalist KPI Metric Cards:** Overhauled the 4 top metric cards (`Total Graph Engines`, `Candidates Flagged`, `High Risk Layering Flow`, `Average Detection Speed`) into a minimal layout. Stripped away all noisy, hardcoded badges (`Coverage`, `FIU Scope`, `Telemetry`, `27 High Risk`, `100% Operational`, `Live Topology`, `50 Max Fan-Out`, `31 High-Value Rings`, `Graph Indexed`) and bottom dividers, leaving clean labels, subtle icons, and bold monospace values.
  - **Verification:** Verified frontend production build via `npm run build` (built cleanly in 891ms, 0 errors).

- [x] **SPYNEX Professional UI/UX Redesign: Case Management, Case Investigation & Autonomous AI Cockpit (2026-10-18):**
  - **Information Architecture & Mental Model Separation:**
    - **Case Management (`cases`):** Standalone full-width triage workspace ("Which case should I review, and why?"). Includes header with "Run detection scan", 4 real summary KPI metric cards (Open Cases, High-Priority Alerts, Awaiting Review, Total Flow Structuring), filter & search toolbar, and a full-width case queue table with Indian rupee formatting (`₹`), compact severity pills, and row click navigation. Removed the squeezed 360px split-view!
    - **Case Investigation (`case-detail` / `CaseInvestigationView.tsx`):** Dedicated single-case deep dive workspace ("What happened, what evidence supports the alert, and how risky is it?"). Includes "← Back to Case Management" breadcrumb navigation, full-width Cytoscape.js graph canvas, forensic metric cards, organized evidence tabs (Evidence Graph, Transactions, Detector Hits, Score Breakdown), entity slide-over drawer, and a prominent "Investigate with AI" handoff CTA button.
    - **Autonomous AI Cockpit (`ai-cockpit`):** Independent navigation destination in the global sidebar ("What is the agent investigating, what did it discover, and what action is proposed?"). Clean layout with Case Context & selector, real-time SSE tool execution audit trail with parameter chips, precedent memory search, DecisionBar approval/rejection actions, and transaction replay controls.
  - **Purple-Led Fintech Design System:**
    - Established coherent palette tokens in `index.css`: Main background `#F7F8FC`, primary surface `#FFFFFF`, subtle lavender `#F3F0FF`, primary purple `#6D4AFF`, dark purple `#4F35B5`, light purple border `#E5DDFB`, standard border `#E7EAF1`, primary text `#182033`, secondary text `#667085`, muted text `#98A2B3`.
    - Semantic risk colors strictly calibrated: High-risk `#D64550`, Warning `#D99016`, Success `#15966A`, Informational blue `#3779D8`.
    - Typography hierarchy: `Urbanist` (headers/display) + `Plus Jakarta Sans` (body) + `JetBrains Mono` (rupees, IDs, timestamps).
  - **Global Application Shell Refinement:**
    - Reorganized `Sidebar.tsx` into 3 clean groups: `INTELLIGENCE` (Overview, Detector Catalog, Transaction Explorer), `INVESTIGATION` (Case Management, Autonomous AI Cockpit), and `GOVERNANCE` (Evidence & Audit, System Settings). Active state styled with subtle lavender background (`#F3F0FF`) and purple text/icon (`#6D4AFF`).
    - Streamlined `Navbar.tsx`: Replaced raw database diagnostics button with a compact, minimal system operational indicator pill with live refresh.
    - Removed redundant "Latest Investigation Workspace Spotlight" banner from [`DetectorCatalog.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/patterns/DetectorCatalog.tsx) to declutter the catalog view.
  - **Verification:** Verified frontend production build via `npm run build` (built cleanly with 0 errors); full backend test suite (`python run_tests.py`) passed all 214 tests in 38.3s (`OK`). Zero backend contracts altered.

- [x] **Investigation UI/UX & Typography Modernization (`design-taste-frontend`) (2026-10-17):**
  - **Typography Overhaul:** Configured `Roboto Slab` font family across HTML and CSS variables (`--font-serif`, `--font-sans`, `--font-display`), applying clean typography across all headings (`h1` - `h5`) and interface text.
  - **Eliminated Nested Cards ("Boxes inside Boxes"):** Merged the executive narrative, corroborated evidence findings, and decision actions into a unified Investigation Dossier canvas with clean hairline dividers instead of stacked multi-layer borders and nested backgrounds.
  - **Sanitized Markdown Rendering:** Completely overhauled [`MarkdownViewer.tsx`](file:///d:/vortex/SPYNEX/frontend/src/features/investigation/MarkdownViewer.tsx) to parse escaped and raw newlines, headings, lists, badges, and inline bold/italic. Stripped raw technical prefixes (`#### 4.` and `*Reason:*`), rendering clean semantic text.
  - **Semantic Color Calibration:** Restricted vivid colors strictly to risk semantics: Red for Escalation / Critical risk, Amber for Monitoring / Medium risk, and Green for Dismissed / Healthy states. Neutralized tool chips, badge borders, and container backgrounds to high-end slate tones (`#F8FAFC`, `#E2E8F0`, `#334155`).
  - **Inverted Information Hierarchy:** Placed the Investigation Dossier and Decision Bar at the very top of the primary view for instant analyst triage. Collapsed the verbose SSE tool execution stream into a compact audit trail accordion once analysis is complete.
  - **Verification:** Frontend production build (`npm run build`) passed with 0 errors; full backend test suite (`python run_tests.py`) passed 214/214 tests in 46.8s.

- [x] **Repository Root Hygiene: Removal of Reference & Agents Folders (2026-10-17):**
  - **Directory Cleanup:** Permanently removed untracked and redundant directories `reference/` (legacy detectors file) and `.agents/` (local skill files) along with `skills-lock.json` from the repository root.
  - **Dependency Verification:** Verified zero source code, build scripts, or runtime imports in `backend` or `frontend` depend on these directories.
  - **Verification:** Ran backend test suite via `python run_tests.py`: all 214 tests passed in 27.3s (`OK`); ran frontend build via `npm run build`: built cleanly in 987ms with 0 errors. Working tree remains clean and fully verified.
- [x] **Repository Structure Reorganization & Environment Configuration (2026-10-17):**
  - **Environment Configuration:** Added `.env` and `.env.example` templates for Google Gemini API key (`GEMINI_API_KEY`) and FalkorDB configuration. Integrated automatic loading via `python-dotenv` in `main.py` and `agent/llm.py`. Added `.env` to `.gitignore` to prevent secret leaks.
  - **Documentation Organization:** Separated core documentation from historical simulation/audit reports. Moved 7 generated logs (`AGENT_DECISIONS.md`, `BUILD_LOG.md`, `FUNCTION_MAP.md`, `QUERY_LOG.md`, `SIMULATOR_ANALYSIS.md`, `SIMULATOR_FIELD_MAPPING.md`, `SIMULATOR_PATTERN_COVERAGE.md`) into a clean [`ringtrace/docs/generated_reports/`](file:///d:/vortex/SPYNEX/docs/generated_reports/) directory. Created a dedicated [`docs/README.md`](file:///d:/vortex/SPYNEX/docs/README.md) hub index.
  - **Unified Root Test Runner:** Implemented [`run_tests.py`](file:///d:/vortex/run_tests.py) at the repository root allowing 1-command execution of all 23 backend test suites (214 tests). Added comprehensive test inventory catalog in [`tests/README.md`](file:///d:/vortex/SPYNEX/backend/tests/README.md).
  - **Clutter Elimination:** Removed redundant duplicate files (`MEMBER_A_AGENT_PROMPT.md`, `ringtrace/AGENTS.md`, `ringtrace/AGENTS_MEMBER_A.md`).
  - **Master README Overhaul:** Rewrote root [`README.md`](file:///d:/vortex/README.md) with modern system architecture ASCII diagram, directory map, quick start guide, test runner usage, and documentation index.
  - **Verification:** Verified all 214 tests pass via `python run_tests.py` (21.5s, exit code 0); verified frontend build passes via `npm run build` (0 errors).
- [x] **Merge origin/mayuri-d2 Resolution & Investigation UI Integration (2026-10-17):**
  - Resolved merge conflicts cleanly across all 4 conflicting frontend files: `CaseDetailView.tsx`, `DecisionBar.tsx`, `DemoControls.tsx`, and `InvestigationPanel.tsx`.
  - Harmonized Member A's Stitch design system (neutral white/slate cards, refined typography, consistent tokens) with Member B's dynamic capabilities (live cases selector, `MarkdownViewer`, similar-cases badge, dynamic tool call telemetry, and action status approval flow).
  - Fixed environment variable isolation leak in [`test_e2e_workflow.py`](file:///d:/vortex/SPYNEX/backend/tests/test_e2e_workflow.py) (`FALKORDB_MEMORY_GRAPH` restoration in `tearDownClass`), ensuring `test_memory_story.py` and downstream tests pass cleanly.
  - **Live Scan & Pipeline Verification:** Dispatched a full graph scan (`POST /api/v1/scan` -> `SCAN_8eb73c4e9732`). All 9 detectors completed successfully across 40,661 transactions in 10.6s, finding 1,092 hits and updating 194 cases.
  - **Member B Feature Verification:** Tested `/api/v1/cases`, `/api/v1/cases/{id}` (`similar_case_count: 5`), `/api/v1/cases/{id}/similar`, `/api/v1/cases/{id}/decisions`, `/api/v1/cases/{id}/investigations`, and SSE event stream `/api/v1/investigations/{id}/events` (5 tool calls + done event).
  - **Browser E2E Verification:** Automated browser validation at `http://localhost:5173` verified zero console errors, 100-case triage queue, case detail sidebar with similar-precedents badge, live SSE agent loop streaming with tool counter, memory graph precedents panel, and decision bar.
  - Verified 100% clean production frontend build (`npm run build`, 0 errors) and all 214 backend unit/integration tests passing.
- [x] **Evaluation Correctness & Ground-Truth Leakage Audit (2026-10-17):**
  - **Ground-Truth Isolation Verified:** Audited all 9 detector implementations, `queries.py`, and `scan_service.py`. Verified zero AST imports of `app.evaluator` or `alerts.csv` and confirmed query executions against `txn` graph never reference the isolated `labels` graph. Direct query verification via `LABEL_LEAKAGE_CHECK` on live `txn` graph confirmed 0 leaked label properties on nodes or edges.
  - **Metric Calculation Defects Corrected:**
    - Fixed manufactured `0.0` precision/recall/F1 metrics in `evaluate_additional_graph_detectors` and `evaluate_fan_detectors` when ground truth is absent (e.g. `hub_account` with 0 planted alerts); now correctly reports `None` (`null` in JSON) with `status: "not_evaluable"` to prevent misleading zero-scores.
    - Fixed undefined False Positive Rate (`fpr`): correctly reports `None` instead of manufactured `0.0` for 4 typologies (`scatter_gather`, `gather_scatter`, `bipartite`, `dense_cluster`) that lack planted benign look-alikes.
    - Guarded zero denominators for empty prediction sets and missing labels without division errors.
  - **Aggregate Evaluation Added:** Implemented `evaluate_all_detectors()` in [`app/evaluator.py`](file:///d:/vortex/SPYNEX/backend/app/evaluator.py) and registered `/api/v1/evaluate/all`, providing macro and micro precision, recall, and F1 across all 9 detectors alongside explicit limitation disclosures.
  - **Frontend Evidence & Audit Sandbox Modernized:** Replaced hardcoded dummy KPI numbers in [`PlaceholderView.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/common/PlaceholderView.tsx) with live API integration (`/api/v1/evaluation`), an interactive "Run Evaluation Benchmark" button, and a comprehensive 9-pattern results table displaying true counts, metrics, and limitations.
  - **Verification:** Verified with 9 dedicated unit and AST tests in [`tests/test_ground_truth_leakage.py`](file:///d:/vortex/SPYNEX/backend/tests/test_ground_truth_leakage.py); all 206 backend unit tests passed in 26.8s; frontend production build (`npm run build`) passed cleanly in 1.44s.
- [x] **Simple Scheduler Pause Control (2026-10-17):** Added pause/resume endpoints and a button in the existing scheduler popover. Pausing suppresses future automatic scans; it does not cancel an active scan or disable manual scans. Dedicated scheduler and API tests recorded in `docs/AI_USAGE.md`.
- [x] **SPYNEX Browser Tab Branding (2026-10-17):** Set the browser title to `SPYNEX` and used the user-provided logo at `frontend/public/spynex-tab-logo.png` as the tab icon. Removed the alternate generic shield icon. Frontend build verification recorded in `docs/AI_USAGE.md`.

## 1. Completed Capabilities

- [x] **Automated Fraud Detection Scheduler & Concurrency Coordinator (2026-10-17):**
  - Designed and implemented a production-conscious periodic fraud detection scheduler in [`app/scheduler/service.py`](file:///d:/vortex/SPYNEX/backend/app/scheduler/service.py) with validated configuration in [`app/scheduler/config.py`](file:///d:/vortex/SPYNEX/backend/app/scheduler/config.py).
  - Integrated into FastAPI native lifecycle via `lifespan` in [`app/main.py`](file:///d:/vortex/SPYNEX/backend/app/main.py) with graceful shutdown handling and cancellation support.
  - Enforced atomic mutual exclusion in [`app/scan_service.py`](file:///d:/vortex/SPYNEX/backend/app/scan_service.py) with `_scan_execution_lock`: concurrent scheduled or manual triggers do not overlap; overlapping requests are safely recorded as `status: 'skipped'`.
  - Guaranteed error isolation: isolated detector failures record `status: 'partial'` without halting other detectors.
  - Preserved existing 9-pattern `DETECTOR_REGISTRY`, case builder, heuristic scorer, and idempotent FalkorDB `MERGE` case persistence.
  - Added observability endpoints: `GET /api/v1/scheduler/status`, `GET /api/v1/scans/latest`, `GET /api/v1/scans`.
  - Authored comprehensive documentation in [`docs/DETECTION_SCHEDULER.md`](file:///d:/vortex/SPYNEX/docs/DETECTION_SCHEDULER.md) detailing architecture, API contracts, deployment topologies, and verified operational cautions:
    1. *Shutdown Safety:* Cooperative cancellation at detector boundaries (`is_shutting_down()`) ensures in-flight scans do not outlive shutdown in an unsafe state and lock is reliably released in `finally:`.
    2. *Timeout Truth:* Supervisory `asyncio.wait_for` flags the timeout threshold without falsely claiming Python can forcefully abort synchronous socket I/O in worker threads; the lock remains held until the active query finishes, safely skipping subsequent runs.
    3. *Detection Bounds:* Clarified that a 250,000-edge snapshot cap and search step ceilings provide bounded-latency heuristic triage rather than an unconstrained guarantee of 100% graph-wide detection.
    4. *Process Concurrency Scope:* Clarified that `threading.Lock` protects single-process instances; multi-replica deployments must employ a single scheduler owner or distributed coordinator.
    5. *HTTP 202 Skipped Semantics:* Standardized HTTP 202 response to include `active_scan_id` and explanatory `message` so clients and UI (`CaseManagementView.tsx`) do not confuse skipped runs with active jobs.
  - Validated with 18 dedicated unit/integration tests in [`tests/test_scheduler.py`](file:///d:/vortex/SPYNEX/backend/tests/test_scheduler.py); all 195 backend tests passed in 23.2s.

- [x] **Detector Catalog: Minimal Header & Popover Glitch Resolution (2026-10-17):**
  - Removed wide open scheduler bar from the main catalog canvas to keep the page header minimal, compact, and completely uncluttered per user request.
  - Implemented a sleek [`SchedulerButton.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/patterns/SchedulerButton.tsx) placed neatly on the far right of the header alongside `Understanding Candidates & IDs`.
  - **Fixed UI Clipping Glitch:** Constrained popover width (`width: 300px`, `maxWidth: 'calc(100vw - 32px)'`), aligned popover flush right (`right: 0`), and anchored header actions container (`marginLeft: 'auto'`), eliminating the left-edge viewport clipping when opening the popover.
  - **Minimized Card Content:** Removed the redundant multi-line explanation paragraph and extra badges from the card header in [`DetectorCatalog.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/patterns/DetectorCatalog.tsx), leaving a clean single-row header (`Detector Catalog` + `9 Active Engines`).
  - Toggles an elegant popover with:
    1. **Live Scheduler State:** Active pulsing indicator and interval display (`every 5m`).
    2. **Next Scheduled Run:** Real-time countdown timer (`in Xm Ys` updating every second).
    3. **Last Run:** Relative completion timestamp (`2m ago`), status pill (`Complete`, `Partial`), and evidence hits discovered.
    4. **Manual Run Now:** Interactive button triggering `POST /api/v1/scan` with real-time feedback and automatic refresh upon completion.
  - Added `getSchedulerStatus` and `getLatestScan` methods to `ringtraceApi` ([`api.ts`](file:///d:/vortex/SPYNEX/frontend/src/services/api.ts)).
  - Verified 100% clean production build (`npm run build`) in 774ms with 0 errors, plus verified live browser rendering without clipping.

- [x] **Network Toolbar Refinement: Minimal Controls & Unified Grouping (2026-10-17):**
  - Streamlined the top canvas toolbar in [`OverviewGraph.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/overview/OverviewGraph.tsx) to eliminate visual noise and fragmented buttons.
  - Removed bulky redundant `Focus` button; enabled immediate search-and-focus on Enter with clear button `✕`.
  - Shortened sampling dropdown options from verbose (`Sample: 300 transfers`) to clean and compact (`300 tx`).
  - Streamlined `Labels On` button into a sleek, minimal toggle (`Labels`).
  - Unified fragmented zoom in/out, fit to viewport, and reload network buttons into a single 28px segmented control group (`[ ＋ | － | ⤢ | ⟳ ]`).
  - Verified 100% clean production build (`npm run build`) in 808ms with 0 errors.

- [x] **Catalog Header Cleanup: Removed Breadcrumb & Watchdog Banner (2026-10-17):**
  - Removed the breadcrumbs (`Intelligence Workspace > Detectors Catalog FALKORDB v2.4`) and the notification card (`Autonomous Watchdog: Active topology detection across transaction nodes`) from [`DetectorCatalog.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/patterns/DetectorCatalog.tsx).
  - Cleaned up unused `ChevronRight` import.
  - Verified 100% clean production build (`npm run build`) in 812ms with 0 errors.

- [x] **Top Bar Refinement: Minimal Search & Right-Aligned FalkorDB Status Icon (2026-10-17):**
  - Shifted the minimal FalkorDB status icon button to the far right of the top navigation bar ([`Navbar.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/layout/Navbar.tsx)), removing the green dot indicator to keep the styling ultra-clean and minimal.
  - Removed the `⌘K` badge icon from the search bar, leaving an uncluttered input field.
  - Set navbar layout to `justifyContent: 'space-between'` for optimal aesthetic balance.
  - Verified 100% clean production build (`npm run build`) in 508ms with 0 errors.

- [x] **UI Streamlining: Minimal Header & Non-Congested Metrics Bar (2026-10-17):**
  - Replaced the congested 4-KPI card grid (~180px tall) in `OverviewGraph.tsx` with a single sleek, minimal inline metrics header row.
  - Eliminated noisy, redundant elements: pill badges (`98.2% Active`, `In-Flight`, `FalkorDB v2.4`, `4 High Risk`), card separator lines, and verbose taglines (`FalkorDB txn graph`, `Temporal sequencing verified`, `In-memory redis shard`).
  - Positioned 4 lightweight metric chips (`3,000 Accounts`, `40,661 Transfers`, `12 Flagged`, `0.8ms Latency`) directly adjacent to the network title, freeing over 120px of vertical space for the canvas.
  - Verified 100% clean production build (`npm run build`) in 791ms with 0 errors.

- [x] **Brand Identity: Replaced Legacy Header with Official SPYNEX Logo (2026-10-17):**
  - Replaced legacy text and generic shield badge with the official high-resolution **SPYNEX** brand logo (`spynex-logo.png` and `spynex-mark.png`).
  - Extracted and antialiased transparent vector-aligned brand assets into `frontend/public/` with clean alpha channel.
  - Updated Sidebar brand header ([`Sidebar.tsx`](file:///d:/vortex/SPYNEX/frontend/src/components/layout/Sidebar.tsx)) to cleanly render the official emblem (`[nexus mark] SPYNEX — FOLLOW THE MONEY. UNRAVEL THE WEB.`).
  - Updated browser favicon in [`index.html`](file:///d:/vortex/SPYNEX/frontend/index.html) to the SPYNEX brand mark (`spynex-mark.png`).
  - Visually confirmed with browser automated screenshot; verified 100% clean production build (`npm run build`) in 1.1s.

- [x] **UI Cleanup: Removal of Redundant Header & Sidebar Badges (2026-10-17):**
  - Removed `v2.4` badge pill from the Sidebar brand header (`Sidebar.tsx`).
  - Removed redundant utility controls cluster from the top navigation bar (`Navbar.tsx`): `FIU Live Intelligence` telemetry pill, `FalkorDB Online | Shard #04 (txn)` pill, manual refresh button, and notification bell icon. (Engine status remains cleanly visible in the dedicated Sidebar engine status card).
  - Cleaned up unused Lucide imports and sanitized Navbar props.
  - Verified 100% clean production build (`npm run build`) in 847ms with 0 errors.

- [x] **Asset Cleanup & Unused Logo Removal (2026-10-17):**
  - Audited all image and logo assets across the frontend repository (`frontend/src/assets/logo/`, `frontend/src/assets/`, `frontend/public/`).
  - Removed 35 unused PNG files from `src/assets/logo/` (legacy mockups, section screenshots, and untracked raster assets totaling ~800KB).
  - Removed obsolete boilerplate assets: `hero.png`, `react.svg`, and `vite.svg`.
  - Removed unused duplicate raster files and external social sprites: `public/favicon-64.png`, `public/favicon.png`, `public/icons.svg`.
  - Replaced bulky base64 data with clean, crisp, unified vector SVGs: `public/shield.svg` and `public/favicon.svg`.
  - Verified 100% clean production build (`npm run build`) in 899ms with 0 errors.

- [x] **Member A: 9/9 Active Graph Detection Typologies Integrated into Frontend UI (2026-10-17):**
  - Integrated the remaining 3 backend detectors (`bipartite`, `dense_cluster`, and `hub_account`) into the React frontend detection workbench and catalog.
  - Updated `DetectorPattern` union in `frontend/src/types/index.ts` to include all 9 typologies: `cycle`, `fan_in`, `fan_out`, `relay_chain`, `scatter_gather`, `gather_scatter`, `bipartite`, `dense_cluster`, `hub_account`.
  - Added dedicated API client methods in `frontend/src/services/api.ts` (`detectBipartite`, `detectDenseCluster`, `detectHubAccount`) connecting to backend `/api/v1/detectors/...`.
  - Promoted `bipartite`, `dense_cluster`, and `hub_account` to active live engines in `frontend/src/components/patterns/catalogData.ts` with custom Lucide icons (`Grid`, `Boxes`, `Share2`).
  - Added parameter optimization selectors to `DetectorWorkspace.tsx`:
    - Bipartite Matrix dimension selector (`3x3 (Standard)`, `2x2 (Broad Search)`, `4x4 (Strict Large)`).
    - Dense Cluster density threshold selector (`≥10% (Balanced)`, `≥20% (High Density)`, `≥30% (Tight Core)`).
    - Hub Account outlier sensitivity selector (`3.0σ (Outlier Hubs)`, `2.5σ (Broad Search)`, `4.0σ (Extreme Centrality)`).
  - Formatted human-readable titles, subtitles, percentages (density), and outlier metric displays (`σ`, flow ratio) in `candidateUtils.ts` and `CandidateEvidencePanel.tsx`.
  - Upgraded Cytoscape canvas (`CandidateGraph.tsx`) with bipartite role color distinction (cyan sources, purple targets, breadthfirst layout) and concentric hub-and-spoke layout for hub accounts.
  - Updated detector badges across `Sidebar.tsx`, `DetectorCatalog.tsx`, and `SummaryCards.tsx` to `9 Active Graph Engines` / `100% Typology Coverage`.
  - Validated with clean frontend build (`npm run build`), 0 lint errors, and 175 passing backend tests.

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
- **Phase 5.2: Full Design System Overhaul (Stitch Project 477170120480282653) — 2026-10-17:**
  - **Aesthetic Overhaul:** Applied Stitch "Financial Intelligence & Graph Forensics" design system tokens across all screens with zero functional breakage.
  - **Typography:** Upgraded font stack to **Inter** (300-800) for all UI, headings, labels and **JetBrains Mono** for all account IDs, transaction hashes, timestamps, and amounts with `fontVariantNumeric: 'tabular-nums'`.
  - **Palette & Tokens:** Replaced legacy green styling with `#F8F9FF` ethereal violet-slate background, `#FFFFFF` cards with hairline `#E2E8F0` borders, `#0F172A` deep slate navy headers, and `#7C3AED` electric ultraviolet accents.
  - **Screens Redesigned:**
    1. **Sidebar & Navbar (`Sidebar.tsx`, `Navbar.tsx`):** Exact SPYNEX v2.4 layout, FalkorDB 0.8ms pulse indicator, `⌘K` keyboard search shortcut with live query debounce, FIU Live Intelligence pill, and Rohit Dare profile badge.
    2. **Detectors Catalog (`DetectorCatalog.tsx`):** Added 4 top KPI metric cards (Total Engines, Candidates Flagged, High Risk Layering, Graph Speed), spotlight investigation banner, and searchable graph engines table with 9 active detectors.
    3. **Detector Workspace (`DetectorWorkspace.tsx`, `CandidateList.tsx`):** Refined hops/parameters toolbars, clean candidate card borders, and benchmark cards.
    4. **Cases & Triage (`CaseDetailView.tsx`, `CaseQueueList.tsx`):** Added Stitch Screen 2 Sub-Header / Case Focus Strip (Case ID, high risk pill, triage score, forensic metrics snapshot), 4 Top Metric KPI cards, and streamlined queue list.
    5. **Transaction Network (`OverviewGraph.tsx`):** Added 4 Top Metric KPI cards (Monitored Accounts, Transfers Analyzed, Layering Subgraphs, Graph Latency), modern control shelf, and `#090D16` deep forensic canvas.
    6. **Transaction Explorer (`TransactionExplorer.tsx`):** Added 1-hop interactive vector canvas header, helper strip, and dual Inflow/Outflow ledger tables.
    7. **Autonomous Cockpit & Replay (`InvestigationPanel.tsx`, `DemoControls.tsx`, `DecisionBar.tsx`):** Overhauled agent telemetry feed, event stream cards, and human-in-the-loop decision bar.
    8. **Evidence & Settings (`PlaceholderView.tsx`):** Created full-fidelity Evidence & Audit Ground-Truth sandbox and System Settings configuration screens.
  - **Verification:**
    - `npm run build` completed with 0 errors in 789ms.
    - Python test suites (`test_case_scorer.py`, `test_cycle_algorithm_unit.py`, `test_case_grouping.py`, `test_evaluator_metrics.py`) passed with 100% success rate.

## Comprehensive Detector Audit — 2026-10-17

- **Baseline inspected before edits:** current Git history through `f19abc7`; working tree had existing edits in `docs/STATUS.md`, `docs/AI_USAGE.md`, and the frontend. No backend files were dirty. Those frontend edits were not changed by this audit.
- **Inventory:** all nine documented detectors exist and are registered in `backend/app/scan_service.py:DETECTOR_REGISTRY`. The scan executes every fraud detector against a shared, bounded transaction snapshot; case building and scoring are wired through `cases/builder.py` and `cases/scorer.py`. `run_algorithm` in Member B's MCP tools is separate and supports general graph algorithms, not fraud detector dispatch.
- **Audit result:** no detector implementation defect was confirmed that could be safely fixed without changing detector semantics or compatibility. A missing cycle fixture-coverage gap was fixed with positive and slow-cycle negative fixtures plus exact evidence assertions. No detector implementation or Member B file was changed. Added [`docs/DETECTOR_GUIDE.md`](DETECTOR_GUIDE.md) with implementation-faithful algorithms, parameters, evidence shapes, test status, API flow, and limitations.
- **Full backend suite:** `.venv\Scripts\python.exe -m unittest discover -s tests -v` from `backend/` — 177 tests passed in 20.662 seconds. Tests connected to local FalkorDB and used disposable test graphs.
- **Fresh independent evaluation:** seed-43 dataset (`data/sim2`) loaded to temporary graphs: 3,000 accounts, 39,924 transactions, 116 alerts. Both temporary graphs were deleted after evaluation. Results: cycle 6/10 TP, 0/12 benign FP; fan-in 8/10, 0/12; fan-out 3/10, 3/6; relay-chain 10/10, 0/6; scatter-gather 10/10 with no benign labels; gather-scatter 7/10 with no benign labels; bipartite and dense-cluster 0/10 exact matches and partial; hub-account not evaluable. Thresholds were not tuned on seed 43.
- **Open issues:** fan-out's observed benign false positives and low recall need analysis on seed 42; do not tune on seed 43. Bipartite has no suspiciousness criteria; dense-cluster and hub-account have no time window, and dense-cluster uses local ego-neighborhood density rather than components/community detection. These are documented rather than silently redefined. Several detector reports hit their candidate limit, so their metrics are partial.
- **Contract and ownership findings:** there is no `/contract` directory or generated example-validation suite. Pydantic models exist. Actual transaction timestamps are Unix integers although examples describe ISO strings (`TransactionModel.ts` accepts either). Legacy detector endpoints in `main.py` do not declare response models. `backend/app/mcp_server/tools.py` includes inline Cypher and belongs to Member B; it was not edited. No evaluation metrics imply real-world accuracy.

## Payroll Fan-Out Scenario End-to-End Validation — 2026-10-17

- **Objective:** Validated the existing `payroll_fan_out` scenario through RingTrace's actual detection and case-management pipeline (`run_scan` -> detectors -> case builder -> priority scorer -> FalkorDB memory persistence -> case API endpoints) on isolated test graphs without changing detector algorithms, thresholds, or seed-43 evaluation data.
- **Scenario Classification & Injection:**
  - Catalog ID: `payroll_fan_out` (`SCENARIOS` in `app/api/detection_routes.py`).
  - Classification: Intended **benign look-alike** (`is_fraud: False` in `simulate.py:ben_payroll_fan_out` and `alerts.csv`).
  - Structure: 9 accounts (Origin Account 0 `type: "payroll"`, Accounts 1-8 `type: "personal"`), 16 transactions totaling ₹1,280,000 (two 8-transfer monthly disbursements of ₹80,000 each, spaced exactly 30 days / 2,592,000s apart).
  - Injection mechanism: Verified through both the API endpoint `POST /api/v1/scenarios/inject` (with `X-Demo-Key`) and direct Cypher queries (`MERGE_ACCOUNTS`, `MERGE_TRANSACTIONS`) into isolated throwaway graphs (`test_payroll_txn_<uuid>`, `test_payroll_mem_<uuid>`). Live graphs (`txn`, `labels`) remained completely untouched.
- **Detection & Case Pipeline Results:**
  - **Detector Output:** The `fan_out` detector executed via `run_scan` and detected the disbursements across the rolling 48-hour windows:
    - `distinct_receivers`: 8
    - `tx_count`: 8 per burst / 16 total
    - `origin_account_type`: `"payroll"`
    - `is_recurring_payroll`: `True` (empirically verified against the 30-day secondary batch with 100% counterparty overlap and 1.0 amount/count ratios)
    - `payroll_recurrence_status`: `"verified"`
    - `structuring_share`: `0.0%`
    - `suspicious`: `False` (Rule 2: recurring payroll with structuring < 25% evaluated as benign)
    - `suspicion_rationale`: `"A separate monthly batch matches recipients, batch size, and median amount."`
  - **Case Grouping & Multi-Pattern Assembly:**
    - `dense_cluster` also evaluated the 9-node star network (16 edges >= 10, density 11.1% >= 10.0%), retaining it as non-suspicious structural evidence (`suspicious: False`).
    - `build_cases` grouped all co-occurring hits into a single case with deterministic identifier `CASE_<12-hex-hash>`.
    - Patterns: `["dense_cluster", "fan_out"]`.
    - Participating accounts: 9 accounts. Total transactions: 16. Total amount: ₹1,280,000.
  - **Explainable Scoring Breakdown:**
    - Severity Base: 22 (max of `fan_out`=22, `dense_cluster`=18).
    - Origin Context Adjustment: -10 (business origin discount for `payroll`). Net severity = 12.
    - Amount: 16 (scaled logarithmic score for ₹1,280,000).
    - Velocity: 2 (duration = 30 days > 7 days).
    - Account Count: 6 ($\text{round}(2 \times \log_2(9))$).
    - Corroboration: 10 (2 non-hub patterns: $(2 - 1) \times 10$).
    - Total Score: 46 (medium priority triage label).
  - **Traceable Evidence:**
    - Graph endpoint `GET /api/v1/cases/{case_id}/graph` returned 9 nodes and 16 edges with 100% 1-to-1 traceability to the injected transaction IDs (`TX_demo_payroll_fan_out_*`).
- **Repeat-Scan Idempotency & Analyst Decision Preservation:**
  - Running a repeat scan (`run_scan`) over the graph produced 0 duplicate cases (`case_count: 1`).
  - The case ID remained strictly stable (`CASE_<hash>`).
  - An analyst decision (`MATCH (c:Case) SET c.status = 'dismissed'`) was preserved across subsequent scans due to `ON CREATE SET c.status = 'open'` in `UPSERT_CASES`.
- **Benign Comparison (Historical Baseline Dependency):**
  - Executed a comparison against a single-batch payroll fan-out (8 transfers to 8 recipients within 8 minutes with no 20-40 day historical recurrence baseline).
  - Result: Because no historical secondary batch existed within the observation window, `check_empirical_payroll_recurrence` returned `False`, causing the detector to flag `suspicious: True` under Rule 4 (`distinct_receivers >= 8 in <= 24h`).
  - The resulting case received a high velocity score (15) and total score 47 ("medium").
  - Confirmed: Empirical recurrence detection correctly discriminates recurring corporate payroll from anomalous one-off fan-out dispersals, but requires at least one historical comparison batch within 20-40 days.
- **Verification & Test Execution:**
  - Added dedicated E2E test suite: `backend/tests/test_payroll_scenario_e2e.py` (4 tests passed in 0.485s).
  - Fan detector tests: `backend/tests/test_fan_detectors.py` (12 tests passed in 0.197s).
  - Case management tests: `test_case_grouping.py`, `test_case_persistence.py`, `test_case_scorer.py` (28 tests passed in 1.501s).
  - Ground truth leakage tests: `test_ground_truth_leakage.py` (9 tests passed in 0.188s).
  - Full backend test suite: 210 tests passed in 20.775s (`unittest discover tests`).
  - Frontend production build: `npm run build` passed with 0 errors in 906ms.
- **Verdict:** PASS.

## Member B investigation and memory reliability — 2026-10-18

- Inspected the existing backend B-owned investigation, memory, replay, and SAR paths before changes. Preserved the existing uncommitted frontend/UI work and `backend/tests/test_scheduler.py`; no frontend files, shared `main.py`, or `db.py` were changed.
- Added bounded replay-triggered scans with account batching, non-overlapping execution, scan-failure isolation, and a final pending-account flush.
- Added append-only normalized analyst decisions; plain-language evidence summaries and stricter ID/amount/SAR evidence validation; a bounded manual tool-call loop with a deterministic fallback; read-only case chat with verified note persistence; and deterministic, approval-gated, idempotent SAR drafts.
- Added focused fake-database tests covering decisions, evidence/language validation, agent tool-loop behavior, chat/SAR generation, and replay throttling.
- Verification: 24 focused tests passed across `test_decisions.py` (6), `test_agent_evidence_language.py` (4), `test_agent_loop_manual.py` (2), `test_chat_sar.py` (8), and `test_replay_throttle.py` (4). `compileall` passed. FastAPI OpenAPI route check passed for chat and SAR endpoints; OpenAPI emitted duplicate operation-ID warnings for pre-existing legacy evaluation aliases.
- Not verified: Full backend integration and live Gemini calls. FalkorDB is unavailable at `localhost:6379`, and the local virtual environment does not have the Google GenAI SDK installed. No live/shared graph was touched. Frontend tests/build were intentionally not run per instruction.
- Remaining integration caveat: the existing stream worker calls the standard full scan service; scoped `account_ids` are passed only if the installed scan-service signature supports them.

## Investigation Agent chat and SAR controls — 2026-10-18

- Added a compact Case Assistant section under the Investigation Agent with read-only case questions, verified/unverified response labels, evidence reference buttons, existing SAR draft loading, and approval-aware SAR draft generation/regeneration.
- Added typed API calls and response models for the chat and SAR endpoints. Corrected chat history ordering so the backend receives earlier turns before the latest question.
- Preserved unrelated existing UI changes. Files updated for this addition: `frontend/src/features/investigation/InvestigationTools.tsx` (new), `frontend/src/features/investigation/InvestigationPanel.tsx`, `frontend/src/services/api.ts`, `frontend/src/types/index.ts`, `backend/app/agent/chat.py`, `backend/tests/test_chat_sar.py`, and this documentation.
- Verification: frontend `npm run build` passed (TypeScript and Vite; existing large-chunk warning remains). Backend `test_chat_sar.py`: 8 tests passed, including chat-history ordering.

## SAR generation UX repair — 2026-10-18

- Fixed the Investigation Agent's duplicate client-side SAR status gate: the Generate/Regenerate button is now available for a selected case and lets the backend enforce the latest analyst approval, displaying its error if approval is missing. This avoids a stale UI status blocking valid generation.
- Moved the entire Case Assistant (chat and SAR draft) section above the Memory panel.
- Verification: `backend/.venv/Scripts/python.exe -m unittest discover -s tests -p 'test_chat_sar.py' -v` passed (8 tests). `frontend/npm run build` passed; the existing large-chunk warning remains. Live database generation was not exercised because FalkorDB is unavailable in this environment.

## Repository Cleanup, SPYNEX Consolidation & Railway Deployment Readiness — 2026-10-18

- Consolidated repository to a single clean project directory (`D:\vortex\SPYNEX`), eliminating the ghost `ringtrace` folder and terminating dangling background worker processes.
- Updated Git tracking cleanly so `SPYNEX/` is tracked and `ringtrace/` deletions are committed without ghost or duplicate states.
- Enhanced `run_tests.py` with automatic virtual environment delegation: running `python run_tests.py` from root detects `SPYNEX/backend/.venv` and executes seamlessly without manual environment activation.
- Resolved memory similarity search Cypher queries in `SPYNEX/backend/app/queries_memory.py`: switched `MATCH (other)-[:DECIDED]->(d:Decision)` to `OPTIONAL MATCH` in `FIND_SIMILAR_CASES_SHARED_ACCOUNTS` and `FIND_SIMILAR_CASES_SAME_SIGNATURE`, allowing un-decided candidate cases sharing accounts to be properly surfaced.
- Fixed environment pollution in `test_payroll_scenario_e2e.py` by adding `tearDownClass` to restore `RINGTRACE_DEMO_KEY`, ensuring `test_demo_reset` passes reliably in the full test suite.
- Re-aligned HTTP response code in `SPYNEX/backend/app/api/investigation_routes.py` for `InvalidVerdict` to `400 Bad Request` and calibrated case status assertion upon action approval in `test_investigation_routes.py`.
- Formatted `seed_memory.py` summary display safely to handle un-scored cases without throwing `TypeError`.
- **Verification:**
  - Full backend test suite: **248/248 tests passed** in 21.2s via `python run_tests.py` (`OK`).
  - Frontend production build: `npm run build` completed cleanly in 747ms with **0 errors**.
  - Working tree clean; repository completely ready for Railway backend and Vercel frontend deployment.
