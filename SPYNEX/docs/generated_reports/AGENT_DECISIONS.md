# RingTrace Agent Decisions Log

This document records architectural and implementation decisions, rationale, trade-offs, and verification status.

---

### DEC-001: Preservation of Original Simulator Files
- **Date:** 2026-10-15
- **Decision:** Keep [`simulate.py`](file:///D:/vortex/SPYNEX/backend/simulate.py) and [`load_falkordb.py`](file:///D:/vortex/SPYNEX/backend/load_falkordb.py) in `backend/` without renaming or modifying original code.
- **Context:** The user requested full discovery and integration without replacing or mutating the simulator.
- **Rationale:** Preserving the original standalone CLI scripts allows direct execution according to existing documentation and avoids breaking any external references.
- **Verification:** Both scripts run unmodified in their native environment and pass verification.

---

### DEC-002: Modular Application Architecture
- **Date:** 2026-10-15
- **Decision:** Scaffold modular backend package under `backend/app/` containing:
  - `db.py`: Single point of communication with FalkorDB, including structured query auditing.
  - `queries.py`: Centralized Cypher query constants.
  - `simulator_adapter.py`: Schema validation, domain transformation, and error handling.
  - `data_loader.py`: Programmatic and CLI ingestion with count reconciliation.
- **Rationale:** Separates data generation, data ingestion, database interaction, and detection logic into clean, testable layers.
- **Verification:** Unit and integration tests verify all components work cohesively.

---

### DEC-003: Strict Dual-Graph Ground-Truth Isolation
- **Date:** 2026-10-15
- **Decision:** Enforce isolation between `txn` (operational transaction graph) and `labels` (evaluation ground truth).
- **Rule:** Detectors and AI agents must never query `labels` or receive ground-truth attributes (`is_fraud`, `alert_id`, `role`).
- **Safeguard:** Automated label leakage assertion (`MATCH (a:Account) WHERE a.is_fraud IS NOT NULL OR a.alert_id IS NOT NULL RETURN count(a) == 0`) executed automatically on every data load.
- **Verification:** Verified in `test_03_falkordb_isolated_import_and_reconciliation`.

---

### DEC-004: Live Replay Holdback Strategy
- **Date:** 2026-10-15
- **Decision:** Retain the simulator's chronological 10% holdback mechanism (`replay_fraction = 0.10`) written to `replay.csv`.
- **Rationale:** Allows realistic live stream demonstrations where detectors monitor real-time transaction ingestion.
- **Verification:** Integration tests confirm `replay.csv` is generated with valid chronological tail transactions.

---

### DEC-005: Classification of Hub Account Detection
- **Date:** 2026-10-15
- **Decision:** Treat `hub_account` as an emergent topological graph algorithm signal rather than planting a discrete synthetic alert.
- **Rationale:** Real-world hub accounts are defined by degree centrality, volume concentration, and PageRank (e.g. merchants and payroll hubs), which the simulator naturally creates via Pareto distributions.
- **Verification:** Verified via FalkorDB PageRank algorithm `algo.pageRank('Account', 'SENT')`.
