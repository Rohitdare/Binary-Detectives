# RingTrace (Vortex)

Explainable Graph-Based Financial Crime Investigation Platform powered by FalkorDB.

---

## Overview

**RingTrace** detects complex money laundering typologies across transaction graphs using FalkorDB. The repository contains the synthetic banking simulator, FalkorDB ingestion pipeline, strict ground-truth isolation architecture, and comprehensive documentation.

---

## Repository Structure

```
vortex/
├── ringtrace/
│   ├── backend/
│   │   ├── app/
│   │   │   ├── db.py                 # FalkorDB client with structured audit logging
│   │   │   ├── queries.py            # Centralized Cypher queries
│   │   │   ├── simulator_adapter.py  # Schema validation and domain transformation
│   │   │   └── data_loader.py        # Ingestion with count reconciliation and leakage guards
│   │   ├── tests/
│   │   │   └── test_simulator_integration.py  # Automated integration test suite
│   │   ├── simulate.py               # AMLSim-inspired synthetic transaction generator
│   │   └── load_falkordb.py          # Standalone FalkorDB loader script
│   └── docs/                         # Architecture, analysis, audit, and design docs
│       ├── AGENT_DECISIONS.md        # Architectural decision records (ADRs)
│       ├── AI_USAGE.md               # AI assistance & verification audit log
│       ├── BUILD_LOG.md              # Build, execution, and test history
│       ├── DEMO_AND_PITCH.md         # Pitch guide and hackathon demo script
│       ├── FUNCTION_MAP.md           # Codebase function and module registry
│       ├── QUERY_LOG.md              # FalkorDB executed query audit log
│       ├── SIMULATOR_ANALYSIS.md     # In-depth simulator analysis & mechanics
│       ├── SIMULATOR_FIELD_MAPPING.md# CSV to FalkorDB graph schema mapping
│       ├── SIMULATOR_PATTERN_COVERAGE.md # 9-pattern coverage matrix
│       └── STATUS.md                 # Current project milestone status
└── .gitignore                        # Git ignore rules protecting docs and excluding generated data
```

---

## Quick Start

### 1. Requirements & Prerequisites
- Python 3.10+
- FalkorDB running locally via Docker:
  ```bash
  docker run -p 6379:6379 -d falkordb/falkordb:latest
  ```

### 2. Install Dependencies
```powershell
pip install falkordb
```

### 3. Generate Synthetic Transaction Data
```powershell
cd ringtrace/backend
python simulate.py --seed 42 --out data/sim
```
*Generates ~3,000 accounts, ~40,000 transactions, 8 planted fraud typologies, and 6 benign look-alikes with ground truth in `alerts.csv`.*

### 4. Load into FalkorDB
```powershell
python load_falkordb.py --data data/sim --reset
```
*Loads transaction graph into `txn` and evaluation ground-truth into `labels` with zero label leakage.*

### 5. Run Integration Tests
```powershell
python -m unittest discover -s tests
```

---

## Documentation
Full architectural and technical documentation is maintained under [`ringtrace/docs/`](ringtrace/docs/):
- [Simulator Analysis](ringtrace/docs/SIMULATOR_ANALYSIS.md)
- [Field Mapping Table](ringtrace/docs/SIMULATOR_FIELD_MAPPING.md)
- [Pattern Coverage Matrix](ringtrace/docs/SIMULATOR_PATTERN_COVERAGE.md)
- [Demo & Pitch Guide](ringtrace/docs/DEMO_AND_PITCH.md)
- [Agent Decision Records](ringtrace/docs/AGENT_DECISIONS.md)
- [Query Log](ringtrace/docs/QUERY_LOG.md)
