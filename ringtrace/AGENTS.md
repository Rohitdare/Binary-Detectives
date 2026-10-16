# RingTrace: Agent Instructions for Member A

> **MANDATORY INSTRUCTION:**  
> Before performing any work, planning, or code modifications, the agent MUST read and strictly adhere to the complete instructions in [`AGENTS_MEMBER_A.md`](file:///d:/vortex/ringtrace/AGENTS_MEMBER_A.md).

---

## Member A Invariants & Behavioral Constraints

1. **Member A Scope ("Detect and Cases"):**
   - Owns detectors (9 patterns), fixtures, case builder, priority scorer, `/scan`, case endpoints, scenario injection, and honest evaluation.
   - Does NOT edit Member B's files (`investigation_routes.py`, MCP tools, memory agent, replay stream).
   - Single point of contact with Member B's UI is `case_id`.

2. **Database & Cypher Separation:**
   - Only `backend/app/db.py` talks to FalkorDB (singleton client with query logging).
   - All Cypher queries live in the queries layer (`queries_detect.py` / `queries.py`). Never inline Cypher in detectors or routes.
   - Use `<>` instead of `!=` (FalkorDB requirement).
   - Use parameterized queries, never string concatenation.

3. **Strict Zero Ground-Truth Leakage:**
   - Detectors operate solely on the `txn` graph (`Account` and `SENT` edges).
   - Detectors must NEVER open, query, or reference the `labels` graph or `alerts*.csv` files.
   - Only the independent evaluation module (`app/eval/` or `app/evaluator.py`) may read `labels` / ground truth.

4. **Production Graph Integrity:**
   - Never mutate production `Account` nodes in `txn` (no risk writeback).
   - Never reset or delete `txn` or `labels`.
   - All test fixtures run against isolated, throwaway test graphs (`test_<uuid>`).

5. **API Contract & Router Splitting:**
   - Base path `/api/v1` with routers split by owner (`app/api/detection_routes.py` for Member A).
   - Preserve legacy `/api/...` aliases during migration so current UI does not break.
   - Source of truth is Pydantic models.

6. **Workflow & Verification:**
   - Explain changes in simple language.
   - Work in small, atomic tasks.
   - Run tests and report real output. Never claim functionality works without verification.
   - Update `docs/STATUS.md` and `docs/AI_USAGE.md` at the end of each task.
