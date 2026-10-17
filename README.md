# SPYNEX (RingTrace)

> **Follow the money. Unravel the web.**  
> Explainable Graph-Based Financial Crime Detection & Autonomous AI Investigation Platform powered by **FalkorDB**.

---

## Architecture Overview

SPYNEX combines real-time graph pattern detection with an autonomous AI investigation agent:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SPYNEX Frontend (React 19)                      │
│   Cytoscape Graph · AI Investigation Cockpit · 9-Engine Catalog · Cases│
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ REST / SSE
┌────────────────────────────────────▼───────────────────────────────────┐
│                    FastAPI Backend Engine (Port 8000)                  │
│                                                                        │
│   Member A: Detection & Case Pipeline                                  │
│   ├── 9 Graph Detectors (Cycles, Fan-In/Out, Relay Chains, Clusters)   │
│   ├── Disjoint-Set Union (DSU) Case Builder & Heuristic Scorer (0-100) │
│   └── Background Fraud Detection Scheduler (Threadpool Mutex)          │
│                                                                        │
│   Member B: Autonomous AI Agent & Memory                               │
│   ├── 8-Turn Budget ReAct Agent Loop (Google Gemini 1.5 Flash)         │
│   ├── 8 Restricted MCP Graph Investigation Tools (Sandboxed Cypher)    │
│   ├── Anti-Hallucination Citation Validator & Rule Fallback Engine     │
│   └── Real-Time Server-Sent Events (SSE) Execution Stream Feed         │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ Cypher (Single Client / Parameterized)
┌────────────────────────────────────▼───────────────────────────────────┐
│                         FalkorDB In-Memory Graph                       │
│   ├── txn (3,000 Accounts, 40,661 UPI/NEFT/RTGS Transfers)            │
│   ├── memory (Historical Cases, Precedent Graphs, Analyst Decisions)   │
│   └── labels (Strictly Isolated Ground Truth for Honest Evaluation)    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Repository Structure

```
vortex/
├── .env.example                     # Environment template for Gemini API key & FalkorDB
├── .gitignore                       # Production gitignore protecting credentials & cache
├── AGENTS.md                        # Team architectural invariants & instructions
├── AGENTS_MEMBER_A.md               # Member A contract (Detectors, Cases, Scheduler, Eval)
├── README.md                        # Master repository guide & quick start
├── requirements.txt                 # Root Python requirements
├── run_tests.py                     # Unified 1-command test runner (executes all 214 tests)
│
└── ringtrace/
    ├── docs/                        # Core Documentation & System Specifications
    │   ├── README.md                # Documentation navigation hub
    │   ├── DETECTOR_GUIDE.md        # Comprehensive 9-detector algorithms & math rules
    │   ├── DETECTION_SCHEDULER.md   # Background fraud detection scheduler architecture
    │   ├── DEMO_AND_PITCH.md        # Pitch guide, jury script & demo walkthrough
    │   ├── STATUS.md                # Real-time project milestones & delivery status
    │   ├── AI_USAGE.md              # AI pair-programming audit log & verification traces
    │   ├── AGENTS_MEMBER_A.md       # Member A specification
    │   ├── AGENTS_MEMBER_B.md       # Member B specification
    │   └── generated_reports/       # Generated simulation analysis & audit reports
    │       ├── AGENT_DECISIONS.md   # Architectural Decision Records (ADRs)
    │       ├── BUILD_LOG.md         # Historical shell build execution logs
    │       ├── FUNCTION_MAP.md      # Codebase AST mapping of all functions & endpoints
    │       ├── QUERY_LOG.md         # FalkorDB Cypher execution performance traces
    │       ├── SIMULATOR_ANALYSIS.md# Deep-dive AMLSim generator mechanics
    │       ├── SIMULATOR_FIELD_MAPPING.md # CSV to graph schema mappings
    │       └── SIMULATOR_PATTERN_COVERAGE.md # 9-pattern simulation coverage
    │
    ├── backend/                     # Python 3.10+ FastAPI Backend
    │   ├── .env.example             # Backend environment template
    │   ├── requirements.txt         # Pinned backend dependencies
    │   ├── simulate.py              # AMLSim-inspired synthetic transaction generator
    │   ├── load_falkordb.py         # FalkorDB property graph ingestion loader
    │   ├── app/                     # Application source code
    │   │   ├── main.py              # FastAPI server entry point & lifespan manager
    │   │   ├── db.py                # FalkorDB client singleton with query audit logger
    │   │   ├── queries.py           # Member A Cypher query catalog (parameterized)
    │   │   ├── queries_detect.py    # Detection queries
    │   │   ├── queries_memory.py    # Memory graph Cypher queries
    │   │   ├── scan_service.py      # Scan execution coordinator & concurrency lock
    │   │   ├── case_builder.py      # DSU case clustering & graph evidence aggregation
    │   │   ├── case_scorer.py       # 5-factor heuristic priority triage scorer (0-100)
    │   │   ├── evaluator.py         # Ground-truth evaluation against labels graph
    │   │   ├── agent/               # Autonomous LLM agent loop & fallback engine
    │   │   ├── mcp_server/          # 8 restricted MCP graph investigation tools
    │   │   ├── memory/              # FalkorDB memory graph lifecycle & seed cases
    │   │   ├── scheduler/           # Automated background scan service & config
    │   │   └── stream/              # Transaction replay stream worker & demo reset
    │   │
    │   └── tests/                   # 23 Automated Test Suites (214+ tests)
    │       ├── README.md            # Detailed test suite inventory & categorization
    │       ├── fixtures/            # Positive, negative & payroll JSON fixtures
    │       └── test_*.py            # Detector, case, scheduler, agent, and E2E tests
    │
    └── frontend/                    # Vite + React 19 Frontend
        ├── src/                     # Source code
        │   ├── components/          # Network graph, case queue, detector catalog
        │   ├── features/            # Autonomous investigation cockpit & memory panel
        │   ├── services/api.ts      # Type-safe API client
        │   └── types/               # TypeScript data models
        ├── package.json             # Frontend dependencies
        └── README.md                # Frontend setup guide
```

---

## Quick Start

### 1. Prerequisites
- **Python 3.10+**
- **Node.js 18+** & npm
- **Docker** (for running FalkorDB)

### 2. Launch FalkorDB Graph Database
```powershell
docker run -p 6379:6379 -d falkordb/falkordb:latest
```

### 3. Environment Configuration (`.env`)
Copy the environment template and insert your Google Gemini API key:
```powershell
cp .env.example .env
```
Edit `.env` (or `ringtrace/backend/.env`):
```env
# Required for Autonomous AI Agent Investigation
GEMINI_API_KEY=your_actual_gemini_api_key_here

# FalkorDB Connection
FALKORDB_HOST=localhost
FALKORDB_PORT=6379
FALKORDB_GRAPH=txn
FALKORDB_MEMORY_GRAPH=memory
```
*(Note: If `GEMINI_API_KEY` is not provided, the agent loop automatically and gracefully falls back to the deterministic rule-based investigation engine).*

### 4. Install Dependencies
```powershell
# Backend
cd ringtrace/backend
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

### 5. Ingest Graph Data
```powershell
cd ringtrace/backend
# Generate ~3,000 accounts and ~40,000 transactions
python simulate.py --seed 42 --out data/sim

# Load into FalkorDB txn graph (and baseline memory cases)
python load_falkordb.py --data data/sim --reset
```

### 6. Start Development Servers
In Terminal 1 (Backend):
```powershell
cd ringtrace/backend
uvicorn app.main:app --reload --port 8000
```

In Terminal 2 (Frontend):
```powershell
cd ringtrace/frontend
npm run dev
```
Open **`http://localhost:5173`** in your browser.

---

## Running the Automated Test Suite

SPYNEX includes a unified single-command test runner at the root of the repository:

```powershell
# From the repository root:
python run_tests.py

# Verbose mode:
python run_tests.py -v
```

All **23 test suites (214 tests)** run against isolated, throwaway test graphs (`test_<uuid>`) and execute in ~20 seconds with **100% pass rate**.

---

## Key Features

1. **9 Production Graph Detection Engines:**
   - Multi-hop directed cycles (3 to 6 hops, time-ordered, amount-conserving)
   - Fan-in bursts & structuring (<48h, >8 senders, merchant exclusions)
   - Fan-out dispersal & recurring payroll look-alikes (<48h, >8 recipients)
   - Multi-hop relay chains (flow velocity and ratio tracking)
   - Scatter-gather & gather-scatter pass-through accounts
   - Bipartite layering, dense transaction clusters, and hub account concentration

2. **Automated Fraud Detection Scheduler:**
   - Threadpool-managed background scan service with non-blocking concurrency locks.
   - Idempotent FalkorDB `MERGE` case persistence and 5-factor heuristic priority scoring (`0-100`).

3. **Autonomous AI Investigation Cockpit:**
   - ReAct agent loop powered by Google Gemini with strict 8-turn tool budget.
   - 8 restricted graph query MCP tools with sandboxed Cypher execution.
   - Anti-hallucination citation validator verifying account IDs and transaction references against the graph.
   - Real-time Server-Sent Events (SSE) streaming of tool executions and structured findings.

4. **FalkorDB Memory Graph Precedent Recall:**
   - Idempotent memory graph indexing historical investigations, decisions, and outcomes.
   - Real-time similar case matching by topology signature and shared account entities.

---

## Documentation Links

- **[Detector Specification Guide](ringtrace/docs/DETECTOR_GUIDE.md)**
- **[Detection Scheduler Architecture](ringtrace/docs/DETECTION_SCHEDULER.md)**
- **[Hackathon Pitch & Demo Walkthrough](ringtrace/docs/DEMO_AND_PITCH.md)**
- **[Project Milestones & Delivery Status](ringtrace/docs/STATUS.md)**
- **[AI Usage Transparency Log](ringtrace/docs/AI_USAGE.md)**
- **[Documentation Index Hub](ringtrace/docs/README.md)**
- **[Test Suites Catalog](ringtrace/backend/tests/README.md)**
