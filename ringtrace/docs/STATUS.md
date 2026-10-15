# RingTrace Project Status & Roadmap

**Current Milestone:** Phase 2 — FastAPI Backend & React Investigation Dashboard  
**Status:** Complete & Fully Validated in Browser  
**Last Updated:** 2026-10-15  

---

## 1. Completed Capabilities

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
