# RingTrace Automated Test Suites

This directory contains the automated test suite for the RingTrace / SPYNEX backend, encompassing unit tests, graph algorithm verifications, API contract validations, and full lifecycle end-to-end integration tests.

All tests execute against isolated, throwaway test graphs (`test_<uuid>`) and never mutate the production `txn` or `labels` graphs.

---

## Running Tests

From the repository root:
```powershell
python run_tests.py        # Run all 23 suites (214+ tests)
python run_tests.py -v     # Verbose output
```

From `ringtrace/backend`:
```powershell
python -m unittest discover tests
python -m unittest tests.test_scheduler   # Run an individual suite
```

---

## Test Inventory & Functional Map

### 1. Graph Pattern Detectors (9 Typologies)
- [`test_cycle_detector.py`](file:///d:/vortex/ringtrace/backend/tests/test_cycle_detector.py): Multi-hop directed transaction cycle detection, parameter variations, and zero-sum verification.
- [`test_cycle_algorithm_unit.py`](file:///d:/vortex/ringtrace/backend/tests/test_cycle_algorithm_unit.py): Algorithmic unit tests and fixture boundary validations for cycle detection.
- [`test_fan_detectors.py`](file:///d:/vortex/ringtrace/backend/tests/test_fan_detectors.py): Rolling 48h fan-in bursts, structuring, and fan-out payroll recurrence detection.
- [`test_graph_pattern_detectors.py`](file:///d:/vortex/ringtrace/backend/tests/test_graph_pattern_detectors.py): Scatter-gather, gather-scatter, and relay chain algorithm verifications.
- [`test_supplementary_detectors.py`](file:///d:/vortex/ringtrace/backend/tests/test_supplementary_detectors.py): Bipartite structure, dense cluster community detection, and hub account engines.

### 2. Case Generation, Scorer & Persistence
- [`test_cases.py`](file:///d:/vortex/ringtrace/backend/tests/test_cases.py): Basic case generation, account grouping, and edge evidence attribution.
- [`test_case_grouping.py`](file:///d:/vortex/ringtrace/backend/tests/test_case_grouping.py): Disjoint-set union (DSU) candidate clustering and multi-hit aggregation.
- [`test_case_scorer.py`](file:///d:/vortex/ringtrace/backend/tests/test_case_scorer.py): 5-factor heuristic priority scoring (`0-100`) and payroll origin discounting.
- [`test_case_persistence.py`](file:///d:/vortex/ringtrace/backend/tests/test_case_persistence.py): FalkorDB idempotent `MERGE` case persistence, updates, and deduplication.

### 3. Automated Detection Scheduler
- [`test_scheduler.py`](file:///d:/vortex/ringtrace/backend/tests/test_scheduler.py): Periodic scanning service, threadpool concurrency lock, overlap prevention (`status: 'skipped'`), supervisory timeouts, and graceful cooperative shutdown.

### 4. Autonomous Investigation Agent (Member B)
- [`test_agent.py`](file:///d:/vortex/ringtrace/backend/tests/test_agent.py): 8-turn tool budget agent loop, anti-hallucination citation validator, and deterministic rule-based fallback engine.
- [`test_mcp_tools.py`](file:///d:/vortex/ringtrace/backend/tests/test_mcp_tools.py): The 8 restricted MCP graph tools (`get_account_details`, `get_transaction_history`, `trace_funds_flow`, `detect_cycles_subgraph`, `get_account_neighbors`, `find_similar_cases`, `record_finding`, `propose_action`).
- [`test_investigation_routes.py`](file:///d:/vortex/ringtrace/backend/tests/test_investigation_routes.py): Investigation initiation, real-time Server-Sent Events (SSE) feed, human decision recording, and similar cases retrieval.

### 5. Memory Graph & Precedents
- [`test_memory_seed.py`](file:///d:/vortex/ringtrace/backend/tests/test_memory_seed.py): FalkorDB memory graph lifecycle, indexes, and baseline case seeding (`CASE_0001`, `CASE_0002`, `CASE_0003`).
- [`test_memory_story.py`](file:///d:/vortex/ringtrace/backend/tests/test_memory_story.py): Pitch demo workflow: payroll fan-out dismissal, memory recall, precedent citations, and anti-hallucination validation.

### 6. Transaction Stream Replay & Demo Reset
- [`test_stream_and_reset.py`](file:///d:/vortex/ringtrace/backend/tests/test_stream_and_reset.py): Transaction stream replay worker (start, pause, resume, stop) and one-click demo reset (`POST /api/v1/demo/reset`).

### 7. End-to-End Workflows & Integration
- [`test_api.py`](file:///d:/vortex/ringtrace/backend/tests/test_api.py): FastAPI baseline endpoint routing and error handling.
- [`test_api_integration.py`](file:///d:/vortex/ringtrace/backend/tests/test_api_integration.py): Full detection API pipeline from `/api/v1/scan` through case retrieval.
- [`test_e2e_workflow.py`](file:///d:/vortex/ringtrace/backend/tests/test_e2e_workflow.py): End-to-end integration lifecycle from raw transactions to case triage and graph inspection.
- [`test_payroll_scenario_e2e.py`](file:///d:/vortex/ringtrace/backend/tests/test_payroll_scenario_e2e.py): End-to-end scenario injection, recurring payroll validation, and repeat scan idempotency.

### 8. Ground-Truth Isolation & Metrics
- [`test_ground_truth_leakage.py`](file:///d:/vortex/ringtrace/backend/tests/test_ground_truth_leakage.py): AST and runtime audit verifying zero detector leakage into ground-truth `labels` or `alerts.csv`.
- [`test_evaluator_metrics.py`](file:///d:/vortex/ringtrace/backend/tests/test_evaluator_metrics.py): Precision, recall, and F1 calculations, handling missing labels and empty predictions without division errors.
- [`test_simulator_integration.py`](file:///d:/vortex/ringtrace/backend/tests/test_simulator_integration.py): Synthetic transaction generator schema validation and loader integrity.

---

## Fixtures

Located in [`fixtures/`](file:///d:/vortex/ringtrace/backend/tests/fixtures/):
- `cycle_positive.json` / `cycle_negative.json`: Directed money cycles with conserved flows.
- `fan_in_positive.json` / `fan_in_negative.json`: Structuring and non-merchant burst patterns.
- `fan_out_positive.json` / `fan_out_negative.json`: Rapid dispersal bursts and payroll look-alikes.
