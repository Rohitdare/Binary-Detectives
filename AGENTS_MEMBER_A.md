# RingTrace: Instruction Prompt for Member A's Coding Agent (Detect & Cases)

**How to use this file.** Save it in the repo root as `AGENTS_MEMBER_A.md` (or paste it as the first message to your coding agent). Everything the agent needs is here: what the project is, how the two teammates split the work, exactly what Member A builds, and the full API contract. The agent should read the whole file before touching any code.

---

## 0. Your role in one paragraph

You are the coding agent for **Member A** on RingTrace, a two-person hackathon project (Graph Hacks, Track 01, deadline Sunday 18 Oct 11:59 PM IST, target submission Sunday 6 to 7 PM). Member A owns the **"Detect and Cases"** half of the system: everything from raw transactions in FalkorDB to a scored, explained case on screen, plus the honest accuracy evaluation. Member B owns the **"Investigate and Remember"** half: the AI agent, MCP tools, memory, human decisions, live replay. You only edit Member A's files. You never edit Member B's files, and you never change the API contract without the human telling you that both teammates agreed. The human you work with is a beginner, so explain every query and design choice in simple words; the hackathon rules require that the team can explain everything it submits.

## 1. What RingTrace is

RingTrace is an investigation agent for money-laundering rings. Accounts and transfers live in FalkorDB (graph database, queried with openCypher). Nine **detectors** (graph queries and graph algorithms) flag suspicious structures. Detector hits that share accounts are merged into **cases** with a 0 to 100 priority score. An AI agent (Member B's work) then investigates a case by calling restricted tools, shows every step on the graph, proposes an action and drafts a SAR-style narrative, and a human approves it. Decisions and findings are written back into a memory graph so the next investigation remembers them. Detection accuracy is measured against ground-truth labels and the honest numbers are published.

The one-line pitch: an agent that does not just flag laundering rings; it investigates them across the graph, shows the path behind every conclusion, and remembers what analysts decided.

**Your half is the foundation of that pitch.** If detection or cases are wrong, nothing Member B builds on top will look credible.

## 2. Current state of the repo (verify by reading the code first)

Before writing anything, inspect the repository and confirm these facts. If something differs, tell the human instead of guessing.

The data is already simulated with our own generator `backend/simulate.py` (AMLSim-inspired, not IBM data) and loaded by `backend/app/data_loader.py` into FalkorDB (Docker, port 6379, browser UI on port 3000). There are 3,000 accounts and about 40,661 transactions in the `txn` graph. The simulator keeps the last 10% of transactions back in `data/sim/replay.csv` for Member B's live replay, so do not load or delete that file. A second graph, `labels`, holds ground truth for evaluation only.

The `txn` graph schema is `(:Account {id, type, community, created})-[:SENT {tx_id, amount, ts, step, tx_type}]->(:Account)`. Account `type` is `personal`, `merchant` or `payroll`. There is one edge per transaction, never merged. Amounts are in rupees. `ts` is a Unix epoch integer in seconds. `tx_type` is one of UPI, NEFT, IMPS, RTGS.

Already built and working: `backend/app/db.py` (the only FalkorDB client, with query audit logging to `logs/queries.jsonl`), `backend/app/queries.py` (all Cypher), `backend/app/detectors/cycle.py` (directed 3 to 5 hop cycle detector, canonical rotation dedupe, `detect_cycles()`), `backend/app/evaluator.py`, a FastAPI `backend/app/main.py` with endpoints under `/api/...` (health, stats, transactions, graph, accounts, search, detectors/cycles), a React 19 + TypeScript + Vite frontend with Cytoscape.js graphs (`Sidebar`, `Navbar`, `SummaryCards`, `NetworkPreview`, `TransactionExplorer`, `CycleDetectionView` and others), and 20 passing backend tests.

Known problems you must fix early (details in section 6, Day 1):

1. The cycle evaluation reports "22/22 recovered", but those 22 include 12 benign look-alikes (6 slow family cycles, 6 unordered cycles). Recovering a ring's shape is not the same as flagging it as suspicious. The detector must mark a cycle `suspicious` only when it is time-ordered, fast and keeps most of its money, and the evaluation must report precision, not just structural recovery.
2. Endpoints live under `/api/...` but the contract uses `/api/v1/...`.
3. `main.py` and `queries.py` are single big files; they must be split so two people do not conflict (section 4).

## 3. Architecture rules (never break these)

Only `db.py` talks to FalkorDB. All Cypher lives in the queries layer, never inline in detectors or routes. Only `agent/llm.py` calls an LLM (that is Member B's area; you never call an LLM). The frontend talks only to the API, never to FalkorDB. **Detectors never read the `labels` graph and never touch `is_fraud`, `alert_id`, `role` or any other label property.** Only the evaluator reads `labels`, and detector code must never import the evaluator. A test (`tests/test_leakage.py`) asserts the `txn` graph has no label properties and no detector file mentions `labels`. Demo-injected accounts use a `demo_` id prefix. Pin dependency versions. Log every AI-generated file in `docs/AI_USAGE.md` (tool, what it generated, what was changed).

## 4. How the two members work together

### The idea: vertical feature slices

Both teammates have the same skills, so work is split by **feature**, not by "frontend vs backend". Each person owns a whole slice from the database query up to the screen. That means neither person waits on the other, and both learn the full stack.

**Member A (you): Detect and Cases.** Detectors, fixtures, case builder, scorer, `/scan`, cases and accounts endpoints, scenario injection, evaluation harness and page, case queue, case detail, dashboard, backend deployment.

**Member B: Investigate and Remember.** Memory graph (decisions, investigations, findings), the eight MCP tools, the agent loop with validator and deterministic fallback, investigation endpoints and SSE feed, decisions and approve/reject actions, find-similar-cases, replay stream, demo reset, investigation panel, memory panel, replay controls, frontend deployment.

Member B does not wait for your cases. On Day 1 they build the whole investigation flow on a few hand-made seed cases. When your real cases appear on Day 2, their code just points at them. For that to work, **your cases must match the contract shape exactly.**

### The three golden rules (prevent git merge conflicts)

**Rule 1: split API routes by file, never share one `main.py`.** Use FastAPI `APIRouter`.

- Member A works in `backend/app/api/detection_routes.py`.
- Member B works in `backend/app/api/investigation_routes.py`.

`main.py` is touched once during setup and then left alone:

```python
# backend/app/main.py  (untouched after initial setup)
from fastapi import FastAPI
from app.api.detection_routes import router as detection_router
from app.api.investigation_routes import router as investigation_router

app = FastAPI()
app.include_router(detection_router, prefix="/api/v1")
app.include_router(investigation_router, prefix="/api/v1")
```

Inside a router file, write paths **without** `/api/v1` (for example `@router.get("/cases")`), because the prefix is added in `main.py`. Keep the old `/api/...` routes as aliases for one day so the existing UI does not break, then remove them.

**Rule 2: split React components by folder, never work in the same `App.tsx` or `Dashboard.tsx`.** The repo uses TypeScript, so files are `.tsx` (ignore `.jsx` in any pasted examples).

- Member A works in `frontend/src/features/cases/` (`CaseList.tsx`, `CaseDetail.tsx`, `GraphCanvas.tsx`, `ScoreBreakdown.tsx`) and `frontend/src/features/dashboard/` and `frontend/src/features/evaluation/`.
- Member B works in `frontend/src/features/investigation/` (`AgentReport.tsx`, `DecisionBar.tsx`, `MemoryPanel.tsx`, `ReplayControls.tsx`).

The root layout simply places the two sides next to each other:

```tsx
function Dashboard() {
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  return (
    <div className="flex h-screen">
      {/* Member A's UI */}
      <div className="w-1/2 p-4">
        <CaseList onSelectCase={setSelectedCaseId} />
        <GraphCanvas caseId={selectedCaseId} />
      </div>

      {/* Member B's UI */}
      <div className="w-1/2 p-4">
        <AgentReport caseId={selectedCaseId} />
        <DecisionBar caseId={selectedCaseId} />
      </div>
    </div>
  );
}
```

Keep Cytoscape.js for graphs; do not rewrite the graph canvas in another library.

**Rule 3: the single point of contact is `case_id`.** The only variable the two UIs share is a simple string such as `"CASE_0001"`. Your case list sets `selectedCaseId`. Member B's panel listens to it and calls `GET /cases/{id}/investigations` (a read-only "latest investigations for this case" endpoint, added as an additive contract change) and `POST /cases/{id}/investigations` to start one. You never import Member B's components and they never import yours, except through this prop.

### Other shared-file rules

Split Cypher into `backend/app/queries_detect.py` (yours; move your existing cycle and sample queries there) and `backend/app/queries_memory.py` (Member B's). Both still count as "the queries layer"; `queries.py` may re-export both. Do not edit `db.py` without telling the human first, because both teammates depend on it; if you need a new helper there, ask the human to announce it to Member B.

Memory-graph ownership: you create and update `Case`, `Hit` and `AccountRef` nodes and the `INVOLVES` and `HAS_HIT` edges. Member B creates `Decision`, `Investigation` and `Finding` nodes and updates `Case.status` when a decision is recorded. Never write the other side's node types.

### Git and rhythm

Use short branches named `a/<feature>` (for example `a/fan-in-detector`). The other member reviews and merges within the hour. Commit small and often with clear messages. Daily: a 15-minute morning sync, a 30-minute integration check around 6 PM, and a 10-minute explain-back where each person walks the other through code they did not write. At the end of each day, tests pass, your branch is merged and `AI_USAGE.md` is updated.

### The contract rule

The API contract lives in `/contract` (`openapi.json`, `examples/*.json`, `sse/*.ndjson`) and is frozen as v1.0 on Day 1 (tag `contract-v1.0`). After that, changes are **additive only** (new optional fields or new endpoints). A breaking change needs both teammates to agree and the example files updated in the same pull request. The source of truth is the Pydantic models: declare `response_model` on every route, export FastAPI's generated `openapi.json` into `/contract`, and make a test that validates every example JSON file against the models.

## 5. Member A's complete scope

### 5.1 Detectors (9 patterns, tiered)

Every hit must return the real transaction IDs behind it. Each detector lives in `backend/app/detectors/<pattern>.py`, exposes a function returning a list of Hit objects (shape in section 7), and is registered in one list that `/scan` iterates over.

| Pattern | What it means | How to find it | Tier |
|---|---|---|---|
| `cycle` | Money returns to its origin through 3 to 5 hops, in time order | Existing code. Add `suspicious` flag: time-ordered, short duration (about under 24 h), conservation ratio about 0.8 to 1.0 | 1 |
| `fan_in` | Many senders converge on one account within a window | Distinct senders per receiver in a sliding window (start with 48 h); report share of amounts just under the 50,000 reporting threshold | 1 |
| `fan_out` | One account disperses to many recipients within a window | Mirror of fan_in | 1 |
| `relay_chain` | Layered pass-through, each hop forwards most of the money quickly | Path of 3+ hops, forwarded-amount ratio, hop-gap limit | 1 |
| `scatter_gather` | Origin splits across k intermediaries that converge on one sink | Shared source and sink across 3+ two-hop paths | 2 |
| `gather_scatter` | Many to a hub, hub to many | fan_in and fan_out on the same account in one window | 2 |
| `bipartite` | Group S sends densely to group T | Accounts in S sharing 2+ targets, minimum 3x3 | 2 |
| `dense_cluster` | Tight clump with heavy internal flow | FalkorDB community detection or connected components on a windowed subgraph, then internal-density filter | 3 |
| `hub_account` | Outlier centrality with balanced in/out flow | PageRank or degree z-score; a supporting signal that raises a case score, not a case on its own | 3 |

Threshold rules that protect honesty: choose thresholds from the dataset's own distribution (for example above the 99th percentile of background activity), tune only on the seed-42 dataset, and report final numbers only on a separate seed-43 dataset generated with `python simulate.py --seed 43 --out data/sim2`. Do not hard-code values by reading the simulator's internals and calling them "learned". Do not delete merchant-type or payroll-type hits: tag them with the account type and let the scorer rank them low, because Member B's memory demo needs a payroll-style `fan_out` case that an analyst can dismiss and the system later recognises.

### 5.2 Detector recipe (follow for every pattern)

1. Write the fixtures first: a tiny JSON transaction list that must trigger, and one that must not, saved under `backend/tests/fixtures/<pattern>_positive.json` and `<pattern>_negative.json`.
2. Write the Cypher in `queries_detect.py` with a `LIMIT` and a bounded path length. Use `<>` not `!=` (FalkorDB does not support `!=`). Verify the query in the FalkorDB browser first; generated Cypher is often from other graph databases and must be checked against the installed version.
3. Write the Python function that runs the query through `db.py`, groups parallel transactions between the same accounts, and returns Hit objects with `tx_ids`, `account_ids`, measurements and a plain-English `explanation`.
4. Tune thresholds on seed 42 only.
5. Register the detector, run the full test suite, and log AI use in `docs/AI_USAGE.md`.

Tests load fixtures into a throwaway graph (such as `test_<name>`), run the detector, assert, and delete the graph. Never run tests against `txn`.

### 5.3 Case builder and scorer

`backend/app/cases/builder.py`: take all hits, merge hits that share any account (union-find or NetworkX connected components), cap a case at about 60 accounts so one busy account cannot swallow everything, keep every hit ID and transaction ID, and write the case into the `memory` graph with `MERGE` so rerunning `/scan` never creates duplicates. Case IDs are stable and readable (`CASE_0001`); derive a deterministic key from the sorted account set so the same ring always maps to the same case.

`backend/app/cases/scorer.py`: a 0 to 100 heuristic priority score with this breakdown: pattern severity (max 35), amount (20), velocity (15), account count (10), corroboration from additional distinct patterns (20). Severity is `low` under 40, `medium` 40 to 69, `high` 70 and above. The score is a triage priority, never a probability, and the breakdown (including `total`) must be returned in the API. `hub_account` signals add to corroboration. Payroll-type or merchant-type origins reduce pattern severity.

### 5.4 Endpoints you own (all inside `detection_routes.py`)

`GET /health` (exists), `GET /graph/summary`, `POST /scan` (202), `GET /cases`, `GET /cases/{id}`, `GET /cases/{id}/graph`, `GET /accounts/{id}`, `GET /accounts/{id}/neighborhood`, `GET /scenarios`, `POST /scenarios/inject`, `GET /evaluation`, `POST /evaluation/run`. Full shapes are in section 7. Validate query parameters, cap result sizes (default limit 50, max 200) and return the standard error shape.

### 5.5 Frontend you own

A case queue (`CaseList`) with filters for status, pattern and severity, and score and severity badges. A case detail view with score breakdown bars, a transaction table whose selection is synced to the graph, and pattern filters. The graph canvas (Cytoscape) shows directed edges, one edge per transaction, evidence highlighting and node roles taken from the hit, with hover details and click-to-expand neighborhood in an account drawer. Dashboard tiles (cases by pattern and severity, graph counts). The evaluation page with the honest table and a limitations box. Handle loading, empty and error states. Types come from `openapi-typescript` generated from `contract/openapi.json`; until your endpoints exist, develop against the example JSON files.

### 5.6 Scenario injection (Day 3)

A catalog of demo scenarios (cycle ring, structuring fan_in, payroll-style fan_out, relay chain, and so on). `POST /scenarios/inject` writes `demo_`-prefixed accounts and edges into `txn`, triggers a targeted rescan, and the resulting `case_created` event is emitted through Member B's stream. Coordinate with the human on the one function Member B calls to publish that event. Injected data must be removable by `/demo/reset` (Member B's endpoint), so use only the `demo_` prefix.

### 5.7 Evaluation (Day 3)

`backend/app/eval/benchmark.py` and `eval/metrics.py`, run against the seed-43 dataset. Compare detector output with the `labels` graph (only this module may open it) and compute per pattern: planted fraud, planted benign, true positives, false positives, false negatives, precision, recall, F1, plus overall false-positive rate and detection latency. Report recall only for typologies actually present in the generated data, and only claim detectors that pass their fixtures. The report includes a `limitations` list stating that results are on synthetic data and are not real-world accuracy. Add `tests/test_leakage.py`.

### 5.8 Backend deployment

You deploy the backend (Member B deploys the frontend). Provide a `docker-compose.yml` that starts FalkorDB and the API, keep secrets in environment variables, protect write endpoints on the public deployment with the `X-Demo-Key` header, and set CORS from an environment variable. Check the event's Resources page for hosting options before choosing.

## 6. Member A day-by-day plan

**Thursday 15 Oct (remaining time).** With Member B, in the first 90 minutes: do the file split from section 4, move paths to `/api/v1` with aliases, write the Pydantic models and export `contract/openapi.json` plus `contract/examples/`, review line by line, tag `contract-v1.0`. Then alone: add the `suspicious` flag to the cycle detector and re-measure precision honestly; write `fan_in` and `fan_out` detectors; write positive and negative fixtures for `cycle`, `fan_in`, `fan_out`. Checkpoint tonight: three detectors returning hits with transaction IDs and passing fixtures.

**Friday 16 Oct.** Morning: `relay_chain`, `scatter_gather`, `gather_scatter`, `bipartite` passing fixtures; then case builder and scorer. Afternoon: all endpoints in 5.4 except scenarios and evaluation; build the case queue, case detail, graph canvas and account drawer, and switch the frontend from mock to the real API. Evening: deploy a backend skeleton with a reachable `/health`. Checkpoint: UI shows real cases from at least seven patterns. From now on contract changes are additive only.

**Saturday 17 Oct (feature freeze at 10 PM).** Morning: `dense_cluster` and `hub_account`, both also callable through `run_algorithm` (agree the function signature with Member B). Afternoon: evaluation harness, leakage test, `/evaluation` endpoints and page. Evening: scenario catalog and injection, full-stack deploy, smoke-test the hero flow on the public URL together with Member B. After 10 PM: bug fixes only.

**Sunday 18 Oct.** No new features. Finalise evaluation numbers and the query catalog for the README, cap result sizes, take part in the clean-clone test (`docker compose up` to a working app in about 15 minutes), and the 4 to 6 PM submission dry run.

**If behind, cut in this order:** `bipartite` and `dense_cluster`, then `hub_account`, then scenario injection. Never cut cycle, fan_in, fan_out, relay_chain, cases with scores, and the honest evaluation page.

## 7. API contract (v1.0)

### Conventions

Base path `/api/v1`. JSON with snake_case fields. Timestamps are ISO-8601 UTC strings. Amounts are numbers in rupees. IDs are opaque strings. List endpoints accept `limit` (default 50, max 200) and `cursor` and return `{ "items": [...], "next_cursor": null }`. Errors always use this shape with HTTP 400, 404, 409, 422 or 500:

```json
{ "error": { "code": "not_found", "message": "Case not found", "details": {} } }
```

Write endpoints on the public deployment require an `X-Demo-Key` header. CORS allows the frontend origin from an environment variable.

### Endpoints

| Method | Path | Purpose | Owner | Day |
|---|---|---|---|---|
| GET | `/health` | API and FalkorDB connectivity | A | 1 |
| GET | `/graph/summary` | Node, edge and case counts, time range, cases by pattern | A | 2 |
| POST | `/scan` | Run all detectors and build cases; returns 202 | A | 2 |
| GET | `/cases` | List; filters `status`, `pattern`, `severity`, `sort` | A | 2 |
| GET | `/cases/{id}` | Case detail: hits, score breakdown, transactions | A | 2 |
| GET | `/cases/{id}/graph` | Evidence subgraph for the canvas | A | 2 |
| GET | `/accounts/{id}` | Account profile and linked cases | A | 2 |
| GET | `/accounts/{id}/neighborhood` | N-hop subgraph (`hops`, `limit`) | A | 2 |
| GET | `/scenarios` | Catalog of injectable scenarios | A | 3 |
| POST | `/scenarios/inject` | Inject a scenario; new cases arrive via SSE | A | 3 |
| GET | `/evaluation` | Latest evaluation report | A | 3 |
| POST | `/evaluation/run` | Recompute evaluation; returns 202 | A | 3 |
| POST | `/cases/{id}/decisions` | Record escalate, monitor or dismiss | B | 2 |
| GET | `/cases/{id}/decisions` | Decision history | B | 2 |
| GET | `/cases/{id}/similar` | Similar past cases and outcomes | B | 3 |
| POST | `/cases/{id}/investigations` | Start an agent investigation; returns `investigation_id` | B | 3 |
| GET | `/cases/{id}/investigations` | Investigations for this case (additive endpoint) | B | 3 |
| GET | `/investigations/{id}` | Current or final result | B | 3 |
| GET | `/investigations/{id}/events` | SSE: `step`, `done`, `error` | B | 3 |
| POST | `/actions/{action_id}/approve` | Approve a proposed action (creates a Decision) | B | 3 |
| POST | `/actions/{action_id}/reject` | Reject a proposed action | B | 3 |
| POST | `/stream/start`, `/pause`, `/resume`, `/stop` | Replay control | B | 3 |
| GET | `/stream/status` | Replay state | B | 3 |
| GET | `/stream/events` | SSE: `stream_status`, `tx_batch`, `case_created`, `case_updated`, `heartbeat` | B | 3 |
| POST | `/demo/reset` | Clear cases, memory and injected data | B | 3 |

### Shapes you produce

**Transaction**

```json
{ "tx_id": "TX_0001234", "src": "ACC_00012", "dst": "ACC_00045",
  "amount": 48500.0, "ts": "2026-02-11T09:14:00Z", "tx_type": "UPI" }
```

**Hit**

```json
{ "hit_id": "HIT_cycle_6d93455ad5", "pattern": "cycle",
  "account_ids": ["ACC_00012", "ACC_00045", "ACC_00201"],
  "tx_ids": ["TX_0001234", "TX_0001260", "TX_0001302"],
  "measurements": { "length": 3, "duration_seconds": 14400,
                    "amount_conservation_ratio": 0.91, "is_time_ordered": true,
                    "suspicious": true },
  "explanation": "Funds returned to the origin in 4h, keeping 91% of the amount." }
```

**Case summary** (items in `GET /cases`). `status` is `open`, `escalated`, `monitoring`, `dismissed` or `sar_drafted`. `severity` is `low`, `medium` or `high`.

```json
{ "case_id": "CASE_0001", "status": "open", "severity": "high", "score": 82,
  "patterns": ["cycle", "relay_chain"], "account_count": 5, "tx_count": 9,
  "total_amount": 214300.0, "first_ts": "2026-02-11T09:14:00Z",
  "last_ts": "2026-02-11T13:40:00Z", "similar_case_count": 0,
  "updated_at": "2026-02-11T14:00:00Z" }
```

**Case detail** (`GET /cases/{id}`) is the summary plus `hits` (list of Hit), `transactions` (list of Transaction), `decisions` (list of Decision, written by Member B) and:

```json
"score_breakdown": { "severity": 30, "amount": 14, "velocity": 12,
                     "account_count": 6, "corroboration": 20, "total": 82 }
```

**Graph** (`/cases/{id}/graph` and `/accounts/{id}/neighborhood`). One edge per transaction, never merged. `roles` come from the detector (origin, sink, hub, intermediary), never from `labels`.

```json
{ "nodes": [ { "id": "ACC_00012", "type": "personal", "roles": ["origin"], "in_case": true } ],
  "edges": [ { "tx_id": "TX_0001234", "source": "ACC_00012", "target": "ACC_00045",
               "amount": 48500.0, "ts": "2026-02-11T09:14:00Z" } ] }
```

**Scan response** (`POST /scan`, 202): `{ "scan_id": "SCAN_0001", "status": "running" }`.

**Scenario** (`GET /scenarios` items) and inject (`POST /scenarios/inject` body `{ "scenario_id": "payroll_fan_out" }`, response `{ "injected_accounts": 18, "injected_tx": 18, "rescan": "queued" }`).

**Evaluation report** (the numbers below are placeholders for shape only; real numbers come from the evaluator):

```json
{ "run_at": "2026-10-18T08:00:00Z",
  "dataset": { "seed": 43, "accounts": 3000, "transactions": 40000 },
  "per_pattern": [ { "pattern": "cycle", "planted_fraud": 10, "planted_benign": 12,
                     "tp": 9, "fp": 2, "fn": 1, "precision": 0.82, "recall": 0.9, "f1": 0.86 } ],
  "overall": { "precision": 0.0, "recall": 0.0, "f1": 0.0, "false_positive_rate": 0.0 },
  "detection_latency_ms": 0,
  "limitations": [ "Synthetic data; not real-world accuracy." ] }
```

### Shapes Member B produces (you only display them)

**Decision**

```json
{ "decision_id": "DEC_0001", "case_id": "CASE_0001", "decision": "dismiss",
  "note": "Monthly payroll run", "actor": "analyst_1", "ts": "2026-02-12T10:00:00Z" }
```

**Investigation SSE events**

```
event: step
data: {"index":2,"tool":"trace_funds","args":{"account_id":"ACC_00012","direction":"forward","max_hops":3},
       "summary":"Followed money 3 hops; 4 accounts reached.",
       "evidence":{"account_ids":["ACC_00045"],"tx_ids":["TX_0001260"]}}

event: done
data: {"investigation_id":"INV_0001","mode":"llm",
       "assessment":{"risk_level":"high","summary":"...","narrative":"...",
         "findings":[{"text":"...","evidence_ids":["TX_0001234"]}],
         "similar_cases":[{"case_id":"CASE_0007","outcome":"dismissed"}]},
       "proposed_action":{"action_id":"ACT_0001","type":"escalate","reason":"...","status":"pending"}}

event: error
data: {"code":"llm_timeout","message":"Switched to fallback"}
```

**Stream events** (`/stream/events`): `stream_status` `{state, sent, total}`, `tx_batch` `{count, tx_ids}`, `case_created` `{case_id, score, patterns}`, `case_updated` `{case_id, score}`, `heartbeat` `{ts}`.

### Memory-graph schema (shared, owners marked)

`(:Case {id, patterns, score, status, signature, updated_at})-[:INVOLVES]->(:AccountRef {id})` and `(:Case)-[:HAS_HIT]->(:Hit {hit_id, pattern, tx_ids, measurements})` are **yours**. `(:Case)-[:DECIDED]->(:Decision {decision_id, decision, note, actor, ts})`, `(:Investigation {id, ts, assessment})-[:ABOUT]->(:Case)` and `(:Investigation)-[:FOUND]->(:Finding {id, text, evidence_ids})` are **Member B's**. Compute `Case.signature` as the sorted pattern list plus the account-type mix plus a size bucket, because Member B's similar-case search matches on it.

## 8. FalkorDB gotchas

Use `<>` instead of `!=`. Verify index syntax on the installed version (the existing loader already uses `CREATE INDEX FOR (a:Account) ON (a.id)` and `CREATE INDEX FOR ()-[t:SENT]-() ON (t.tx_id)`). Always bound variable-length paths and add `LIMIT`; test pruning early because time-ordered paths can explode. Check algorithm procedure names with `CALL dbms.procedures()` before using them (for example `algo.pageRank('Account','SENT')` and `algo.WCC(...)` have been used in the docs). Test queries in the FalkorDB browser on port 3000 before putting them in code. Use parameterised queries, never string-built Cypher.

## 9. Definition of done and hard "don'ts"

A detector is done only when its positive and negative fixtures pass, its hits carry real transaction IDs, it touches no label property, it is registered in `/scan`, and its Cypher and thresholds can be explained in plain words. A case feature is done when the API response validates against the contract example and the UI renders it with loading, empty and error states.

Never: read or reference the `labels` graph outside `eval/`; call an LLM; edit Member B's files, the memory nodes they own, or `main.py` after setup; change the contract without the human confirming both teammates agreed; tune on seed 43; claim accuracy for patterns not in the data or for detectors without passing fixtures; present the 0 to 100 score as a probability; commit secrets; run tests against the live `txn` graph.

## 10. How to work with the human

Start every session by reading this file, `docs/STATUS.md` and the latest `git log`, then say in two or three sentences what you will do next. Work in small steps. After each step, run the tests and show the result. Explain new queries and design choices in simple language (what it does, why this approach) so the human can defend it to the judges. Ask before making large refactors or touching shared files (`db.py`, the contract). Update `docs/STATUS.md` and `docs/AI_USAGE.md` at the end of each task, and finish each day with a short hand-off note listing what is merged, what is in progress, and anything Member B must know.
