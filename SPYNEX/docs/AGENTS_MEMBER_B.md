# RingTrace: Instruction Prompt for Member B's Coding Agent (Investigate & Remember)

**How to use this file.** Save it in the repo root as `AGENTS_MEMBER_B.md` (or paste it as the first message to your coding agent). Everything the agent needs is here: what the project is, how the two teammates split the work, exactly what Member B builds, and the full API contract. The agent should read the whole file before touching any code.

---

## 0. Your role in one paragraph

You are the coding agent for **Member B** on RingTrace, a two-person hackathon project (Graph Hacks, Track 01, deadline Sunday 18 Oct 11:59 PM IST, target submission Sunday 6 to 7 PM). Member B owns the **"Investigate and Remember"** half of the system: everything that happens after a suspicious case exists. That means the memory graph, the restricted MCP tools, the AI agent loop with its anti-hallucination validator and deterministic fallback, the investigation and decision endpoints, the live transaction replay, and the screens that show all of it. Member A owns the **"Detect and Cases"** half: detectors, case builder and scorer, cases and accounts endpoints, scenario injection, and the accuracy evaluation. You only edit Member B's files. You never edit Member A's files, and you never change the API contract without the human telling you that both teammates agreed. The human you work with is a beginner, so explain every query and design choice in simple words; the hackathon rules require that the team can explain everything it submits.

## 1. What RingTrace is

RingTrace is an investigation agent for money-laundering rings. Accounts and transfers live in FalkorDB (a graph database queried with openCypher). Nine **detectors** (graph queries and graph algorithms) flag suspicious structures. Detector hits that share accounts are merged into **cases** with a 0 to 100 priority score. An AI agent then investigates a case by choosing graph tools through MCP (expand a neighborhood, trace funds, find a shortest path, run PageRank or community detection, look up similar past cases). Every step is shown on the graph. The agent proposes an action and drafts a SAR-style narrative, and a human approves. Decisions and findings are written back to a memory graph, so the next investigation remembers them. Detection accuracy is measured against ground-truth labels and the honest numbers are published.

The one-line pitch: an agent that does not just flag laundering rings; it investigates them across the graph, shows the path behind every conclusion, and remembers what analysts decided.

**Your half is the "wow" part of the pitch.** Judges will see the agent's steps stream onto the graph, a validated assessment, a human approval, and then the system recognising a similar case later. It must also work with **no LLM at all**, because the deterministic fallback keeps the demo alive.

## 2. Current state of the repo (verify by reading the code first)

Before writing anything, inspect the repository and confirm these facts. If something differs, tell the human instead of guessing.

The data is already simulated with our own generator `backend/simulate.py` (AMLSim-inspired, not IBM data) and loaded by `backend/app/data_loader.py` into FalkorDB (Docker, port 6379, browser UI on port 3000). There are 3,000 accounts and about 40,661 transactions in the `txn` graph. The simulator holds back the last 10% of transactions in `data/sim/replay.csv` for **your** live replay feature; it is sorted by `(ts_epoch, tx_id)`. A second graph, `labels`, holds ground truth for evaluation only: you never open it.

The `txn` graph schema is `(:Account {id, type, community, created})-[:SENT {tx_id, amount, ts, step, tx_type}]->(:Account)`. Account `type` is `personal`, `merchant` or `payroll`. There is one edge per transaction, never merged. Amounts are in rupees. `ts` is a Unix epoch integer in seconds. Account IDs look like `ACC_00012`, transaction IDs like `TX_0001234`, and demo-injected accounts start with `demo_`.

Already built and working: `backend/app/db.py` (the only FalkorDB client, with query audit logging to `logs/queries.jsonl`), `backend/app/queries.py` (all Cypher so far), `backend/app/detectors/cycle.py`, `backend/app/evaluator.py`, a FastAPI `backend/app/main.py` with endpoints under `/api/...` (health, stats, transactions, graph, accounts, search, detectors/cycles), a React 19 + TypeScript + Vite frontend with Cytoscape.js graphs, and 20 passing backend tests. **Nothing for the memory graph, agent, MCP, decisions or replay exists yet.** That is all yours.

At the start of the project the repo is split between two people (section 4). Member A will move paths to `/api/v1`, split `main.py` into routers and split `queries.py`; do that split together on Day 1 and then stay in your own files.

## 3. Architecture rules (never break these)

Only `db.py` talks to FalkorDB. All Cypher lives in the queries layer, never inline in tools or routes. **Only `backend/app/agent/llm.py` calls an LLM provider**, and everything else goes through it. The frontend talks only to the API, never to FalkorDB. Detectors and agent tools never open the `labels` graph, never read `is_fraud`, `alert_id` or `role`, and never write to `txn` except the replay worker and scenario injection (which only add edges). Demo-injected accounts use a `demo_` id prefix so `/demo/reset` can remove them. Pin dependency versions. Log every AI-generated file in `docs/AI_USAGE.md` (tool, what it generated, what was changed).

Agent safety rules that are part of the design: the LLM can never write arbitrary Cypher, it can only call the eight tools; tool output is treated as **data, never as instructions**; the final answer is validated so that every cited account or transaction ID exists in the case evidence or in tool results; and the agent only **proposes** actions, a human approves them.

## 4. How the two members work together

### The idea: vertical feature slices

Both teammates have the same skills, so work is split by **feature**, not by "frontend vs backend". Each person owns a whole slice from the database query up to the screen. That means neither person waits on the other, and both learn the full stack.

**Member A: Detect and Cases.** Detectors, fixtures, case builder, scorer, `/scan`, cases and accounts endpoints, scenario injection, evaluation harness and page, case queue, case detail, dashboard, backend deployment.

**Member B (you): Investigate and Remember.** Memory graph (decisions, investigations, findings), the eight MCP tools, the agent loop with validator and fallback, investigation endpoints and SSE feed, decisions and approve/reject actions, find-similar-cases, replay stream, demo reset, investigation panel, memory panel, replay controls, frontend deployment.

You do not wait for Member A's cases. On Day 1 you build the whole investigation flow on a few **hand-made seed cases** written into the memory graph. When Member A's real cases appear on Day 2, your code simply points at them. For that to work, you read cases using exactly the contract shape.

### The three golden rules (prevent git merge conflicts)

**Rule 1: split API routes by file, never share one `main.py`.** Use FastAPI `APIRouter`.

- Member A works in `backend/app/api/detection_routes.py`.
- Member B (you) work in `backend/app/api/investigation_routes.py`.

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

Inside a router file, write paths **without** `/api/v1` (for example `@router.post("/cases/{case_id}/decisions")`), because the prefix is added in `main.py`. If `investigation_routes.py` grows large, you may split it into more files (for example `api/stream_routes.py`) and add one extra `include_router` line, after telling the human.

**Rule 2: split React components by folder, never work in the same `App.tsx` or `Dashboard.tsx`.** The repo uses TypeScript, so files are `.tsx`.

- Member A works in `frontend/src/features/cases/`, `features/dashboard/` and `features/evaluation/`.
- Member B (you) work in `frontend/src/features/investigation/` (`AgentReport.tsx`, `DecisionBar.tsx`, `MemoryPanel.tsx`, `ReplayControls.tsx`, and any step-feed components).

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

Keep Cytoscape.js for graphs. When a step in your investigation feed is clicked, you need the graph on the left to highlight its accounts and transactions. Do this through a small shared prop or callback that the human and Member A agree on (for example an `onHighlight({ account_ids, tx_ids })` passed into the layout), not by importing Member A's components.

**Rule 3: the single point of contact is `case_id`.** The only variable the two UIs share is a simple string such as `"CASE_0001"` (plus the highlight callback above). Member A's case list sets `selectedCaseId`. Your panel listens to it and calls `GET /cases/{id}/investigations` (a read-only "investigations for this case" endpoint, added as an additive contract change) and `POST /cases/{id}/investigations` to start one. You never import Member A's components and they never import yours.

### Other shared-file rules

Cypher is split into `backend/app/queries_detect.py` (Member A's) and `backend/app/queries_memory.py` (yours). Both still count as "the queries layer". Do not edit `db.py` without telling the human first, because both teammates depend on it.

Memory-graph ownership: Member A creates and updates `Case`, `Hit` and `AccountRef` nodes and the `INVOLVES` and `HAS_HIT` edges. You create `Decision`, `Investigation` and `Finding` nodes and their edges, and **you update `Case.status`** when a decision is recorded. Never write the other side's node types.

### Git and rhythm

Use short branches named `b/<feature>` (for example `b/mcp-tools`). The other member reviews and merges within the hour. Commit small and often with clear messages. Daily: a 15-minute morning sync, a 30-minute integration check around 6 PM, and a 10-minute explain-back where each person walks the other through code they did not write. At the end of each day, tests pass, your branch is merged and `AI_USAGE.md` is updated.

### The contract rule

The API contract lives in `/contract` (`openapi.json`, `examples/*.json`, `sse/*.ndjson`) and is frozen as v1.0 on Day 1 (tag `contract-v1.0`). After that, changes are **additive only** (new optional fields or new endpoints). A breaking change needs both teammates to agree and the example files updated in the same pull request. The source of truth is the Pydantic models: declare `response_model` on every route, and a test validates every example JSON file against the models. The frontend generates TypeScript types with `openapi-typescript`; until the real endpoints exist you develop against a mock server (Prism on the example files) plus a small Node script that replays `contract/sse/*.ndjson` for the SSE endpoints.

## 5. Member B's complete scope

### 5.1 Memory graph

Create the `memory` graph in the same FalkorDB instance. Your node types and edges are `(:Investigation {id, ts, assessment})-[:ABOUT]->(:Case)`, `(:Investigation)-[:FOUND]->(:Finding {id, text, evidence_ids})` and `(:Case)-[:DECIDED]->(:Decision {decision_id, decision, note, actor, ts})`. Member A owns `(:Case {id, patterns, score, status, signature, updated_at})`, `(:Case)-[:INVOLVES]->(:AccountRef {id})` and `(:Case)-[:HAS_HIT]->(:Hit {hit_id, pattern, tx_ids, measurements})`. Put all your Cypher in `queries_memory.py`, use `MERGE` with stable ids so retries never duplicate, and index the id properties.

On Day 1 write `scripts/seed_memory.py` that inserts two or three hand-made seed cases using real account IDs from the `txn` graph (for example one cycle case and one payroll-style `fan_out` case whose origin is a `payroll`-type account). This lets you build everything before Member A's builder exists. `/demo/reset` must be able to wipe the memory graph and re-seed a clean demo snapshot.

### 5.2 The eight MCP tools

Implement the tools first as plain, well-tested Python functions in `backend/app/mcp_server/tools.py`, then wrap them in an MCP server (FastMCP, or plain function calling if MCP setup eats more than an hour; tool names and shapes stay the same). Every tool has a strict input schema, hard limits (maximum hops, maximum rows), returns data only, and never accepts or returns raw Cypher.

| Tool | Reads | What it does |
|---|---|---|
| `get_case(case_id)` | memory | Case, hits, score breakdown |
| `expand_neighborhood(account_id, hops, limit)` | txn | N-hop neighbors of an account, one edge per transaction, with limits |
| `trace_funds(account_id, direction, max_hops, window)` | txn | Follow money forward or backward with time and hop limits |
| `shortest_path(src, dst)` | txn | Shortest path between two accounts, bounded |
| `run_algorithm(name, scope)` | txn | `pagerank`, `community` or `connected_components` on a scoped subgraph |
| `find_similar_cases(case_id)` | memory | Past cases with shared accounts or the same pattern signature, and their outcomes |
| `record_finding(case_id, text, evidence_ids)` | memory | Write a finding with evidence IDs to the memory graph |
| `propose_action(case_id, type, reason)` | memory | Create a pending `escalate`, `monitor`, `dismiss` or `draft_sar` action |

Each tool result should include a short human-readable `summary` and an `evidence` object (`account_ids`, `tx_ids`) so the UI can highlight it and the validator can check IDs against it. `run_algorithm` shares its dense-cluster and hub logic with Member A's Tier 3 detectors; agree the function signature with Member A and the human rather than duplicating code. Verify algorithm procedure names with `CALL dbms.procedures()` on the installed FalkorDB version before use (earlier docs used `algo.pageRank('Account','SENT')` and `algo.WCC(...)`), and use `<>` instead of `!=` in Cypher.

### 5.3 Agent loop, validator and fallback

`agent/llm.py` is the single wrapper for the LLM provider (function calling). `agent/loop.py` gives the LLM the case evidence bundle (hits, score breakdown, top transactions) and the tool list, then runs up to 8 tool calls with an overall timeout. After each tool call, stream a `step` event. Tool results go back to the model as plain data. When the model produces its final answer, run it through the validator. Then call `record_finding` for each finding and `propose_action` exactly once. The agent never executes the action itself.

`agent/validator.py` extracts every account and transaction ID from the answer (regular expressions for `ACC_\d{5}`, `TX_\d{7}`, `demo_...` accounts, and case IDs like `CASE_\d{4}`) and checks each exists in the case evidence or in some tool result from this investigation. If any ID is missing, reject the answer, retry once with a reminder, then fall back. Cover this with unit tests that feed fake answers containing invented IDs.

`agent/fallback.py` runs a fixed tool sequence (`get_case`, `expand_neighborhood`, `run_algorithm` for PageRank, `run_algorithm` for community, `find_similar_cases`) and fills a pre-written Markdown template, then proposes an action by simple rules (high score plus multiple patterns suggests escalate, payroll-style origin with a past dismissal suggests dismiss). The fallback must work with **no API key at all**; test that by setting a wrong key. Set `mode` to `fallback` in the `done` event so the UI can show a badge.

### 5.4 Human in the loop: decisions and actions

`POST /cases/{id}/decisions` records `escalate`, `monitor` or `dismiss` with a note and actor, writes a `Decision` node, and updates `Case.status` (`escalated`, `monitoring`, `dismissed`). `POST /actions/{action_id}/approve` creates a Decision from the proposed action and updates the status; for a `draft_sar` action, approval records the decision as `escalate`, sets status `sar_drafted` and stores the SAR-style narrative on the investigation (document this in the contract examples as an additive note). `POST /actions/{action_id}/reject` marks the action rejected and changes nothing else. Decisions are append-only for the audit trail.

### 5.5 Memory and similar cases

Memory is the second half of the pitch. `find_similar_cases` and `GET /cases/{id}/similar` match first on **shared accounts** with past cases, then on an identical `Case.signature` (Member A computes it as the sorted pattern list plus account-type mix plus a size bucket). Return each similar case with its outcome (the latest decision). The demo story: a benign payroll-style `fan_out` is dismissed once; when a similar one appears later, the case shows "similar case dismissed before" and the agent cites that case ID in its assessment. The validator accepts the citation because the ID came from a tool result.

### 5.6 Replay stream

The simulator withheld the last 10% of transactions in `data/sim/replay.csv`. Build a replay worker in `backend/app/stream/` that reads it and inserts transactions into `txn` in small batches (through `db.py`, one edge per transaction), then triggers a **targeted rescan** by calling the scan function Member A exposes (agree its signature with the human; do not import Member A's route code). Expose `/stream/start`, `/pause`, `/resume`, `/stop`, `/stream/status` and the SSE feed `/stream/events` emitting `stream_status`, `tx_batch`, `case_created`, `case_updated` and `heartbeat`. Member A's scenario injection also publishes `case_created`; agree on one small `publish_event(type, payload)` function in your stream module that Member A calls. Replay state must survive pause and resume, and `/demo/reset` must restore it to the beginning.

### 5.7 Demo reset

`POST /demo/reset` clears cases, memory (decisions, investigations, findings) and injected data: it deletes `demo_`-prefixed accounts and their edges from `txn`, resets the replay position, wipes and re-seeds the memory graph from the seeded demo snapshot, and returns a summary. It must be safe to call repeatedly and must be protected by the `X-Demo-Key` header on the public deployment. Make it reliable; it is the last thing you will lean on before recording the video.

### 5.8 Frontend you own

An investigation panel that starts an investigation, opens the SSE feed and shows each step as it arrives (tool name, arguments, summary). Clicking a step highlights its evidence on the graph. An assessment card with risk level, narrative, findings with clickable evidence chips, a `mode` badge (`llm` or `fallback`) and the proposed action. A decision bar with approve, reject and the manual escalate, monitor and dismiss buttons with a note field. A memory panel ("seen before") listing similar cases and outcomes. Replay controls (start, pause, resume, stop, status) and a toast when `case_created` arrives. Handle loading, empty, error and reconnecting-SSE states. Types come from `openapi-typescript`; until your endpoints exist, develop against the mock server and replayed `contract/sse/*.ndjson` files.

### 5.9 Frontend deployment

You deploy the frontend (Member A deploys the backend). The frontend reads the API base URL and a mock switch (`VITE_USE_MOCK`) from environment variables; production uses `VITE_USE_MOCK=false`. Check the event's Resources page for hosting options.

## 6. Member B day-by-day plan

**Thursday 15 Oct (remaining time).** With Member A, in the first 90 minutes: do the file split from section 4, write the Pydantic models and export `contract/openapi.json` plus `contract/examples/`, review line by line, tag `contract-v1.0`. Then alone: create the memory graph and `queries_memory.py`; write `scripts/seed_memory.py` with two or three seed cases; write the first three tools (`expand_neighborhood`, `trace_funds`, `shortest_path`) as plain functions with tests; start the investigation panel layout using the example JSON. Checkpoint tonight: memory graph with seed cases and three tools returning real data from `txn`.

**Friday 16 Oct.** Morning: finish all eight tools, then wrap them in the MCP server. Afternoon: `agent/llm.py`, `agent/loop.py`, `agent/validator.py`, `agent/fallback.py`, and the decisions endpoints. Evening: start `POST /cases/{id}/investigations` and the SSE endpoint, tested on seed cases. Frontend: the investigation panel on mock SSE. Evening, with Member A: deploy the frontend skeleton against the deployed backend. Checkpoint: decisions persist after refresh; UI shows real cases from Member A. From now on contract changes are additive only.

**Saturday 17 Oct (feature freeze at 10 PM).** Morning: finish the investigation flow (stream, `done`, validator, fallback), step-click highlighting, approve and reject, SAR draft. Then `find_similar_cases` and `/cases/{id}/similar` with the memory panel. Afternoon: replay worker with `/stream/*` and SSE events, `/demo/reset` and the seeded snapshot, replay controls and the toast. Evening: full-stack deploy and smoke test of the hero flow on the public URL together with Member A, then rehearse the memory story (dismiss, inject similar, see "seen before", agent cites it). After 10 PM: bug fixes only. Record a rough screen capture.

**Sunday 18 Oct.** No new features. Make `/demo/reset` reliable, finalise the seeded demo data, cap result sizes, take part in the clean-clone test (`docker compose up` to a working app in about 15 minutes), narrate the architecture segment of the video, and review the blog for technical accuracy.

**If behind, cut in this order:** the replay stream (keep a simple "load more transactions" button), then step-click highlighting polish, then `run_algorithm` community detection (keep PageRank). Never cut the eight-tool agent with its fallback, the validator, human approve/reject, or the memory demo.

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

**Decision**

```json
{ "decision_id": "DEC_0001", "case_id": "CASE_0001", "decision": "dismiss",
  "note": "Monthly payroll run", "actor": "analyst_1", "ts": "2026-02-12T10:00:00Z" }
```

The request body for `POST /cases/{id}/decisions` is `{ "decision": "dismiss", "note": "...", "actor": "analyst_1" }`; the response is the Decision above.

**Start investigation** (`POST /cases/{id}/investigations`, 202): `{ "investigation_id": "INV_0001", "status": "running" }`.

**Investigation** (`GET /investigations/{id}`): `{ "investigation_id", "case_id", "status": "running|done|error", "mode": "llm|fallback", "steps": [Step...], "assessment": {...}, "proposed_action": {...} }`.

**Investigation SSE events** (`GET /investigations/{id}/events`). `mode` is `llm` or `fallback`. Action `type` is `escalate`, `monitor`, `dismiss` or `draft_sar`; action `status` is `pending`, `approved` or `rejected`.

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

**Similar cases** (`GET /cases/{id}/similar`): `{ "items": [ { "case_id": "CASE_0007", "match": "shared_accounts|same_signature", "shared_account_ids": ["ACC_00012"], "outcome": "dismissed", "decided_at": "2026-02-12T10:00:00Z" } ], "next_cursor": null }`.

**Action approve/reject response**: the updated action plus, on approve, the created `Decision`.

**Stream**: `GET /stream/status` returns `{ "state": "idle|running|paused|stopped", "sent": 1200, "total": 4066, "batch_size": 50 }`. Events on `/stream/events`: `stream_status` `{state, sent, total}`, `tx_batch` `{count, tx_ids}`, `case_created` `{case_id, score, patterns}`, `case_updated` `{case_id, score}`, `heartbeat` `{ts}`.

**Demo reset** (`POST /demo/reset`): `{ "removed_demo_accounts": 18, "cases_cleared": 12, "memory_cleared": true, "replay_reset": true, "reseeded": true }`.

### Shapes you consume (produced by Member A)

**Case summary** (items in `GET /cases`). `status` is `open`, `escalated`, `monitoring`, `dismissed` or `sar_drafted`. `severity` is `low` (score under 40), `medium` (40 to 69) or `high` (70 and above).

```json
{ "case_id": "CASE_0001", "status": "open", "severity": "high", "score": 82,
  "patterns": ["cycle", "relay_chain"], "account_count": 5, "tx_count": 9,
  "total_amount": 214300.0, "first_ts": "2026-02-11T09:14:00Z",
  "last_ts": "2026-02-11T13:40:00Z", "similar_case_count": 0,
  "updated_at": "2026-02-11T14:00:00Z" }
```

**Case detail** (`GET /cases/{id}`) is the summary plus `hits`, `transactions`, `decisions` and `score_breakdown`:

```json
"score_breakdown": { "severity": 30, "amount": 14, "velocity": 12,
                     "account_count": 6, "corroboration": 20, "total": 82 }
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

**Transaction**

```json
{ "tx_id": "TX_0001234", "src": "ACC_00012", "dst": "ACC_00045",
  "amount": 48500.0, "ts": "2026-02-11T09:14:00Z", "tx_type": "UPI" }
```

**Graph** (`/cases/{id}/graph`, `/accounts/{id}/neighborhood`, and the shape your graph tools should mirror). One edge per transaction, never merged.

```json
{ "nodes": [ { "id": "ACC_00012", "type": "personal", "roles": ["origin"], "in_case": true } ],
  "edges": [ { "tx_id": "TX_0001234", "source": "ACC_00012", "target": "ACC_00045",
               "amount": 48500.0, "ts": "2026-02-11T09:14:00Z" } ] }
```

### Memory-graph schema (shared, owners marked)

Member A's: `(:Case {id, patterns, score, status, signature, updated_at})-[:INVOLVES]->(:AccountRef {id})` and `(:Case)-[:HAS_HIT]->(:Hit {hit_id, pattern, tx_ids, measurements})`. Yours: `(:Case)-[:DECIDED]->(:Decision {decision_id, decision, note, actor, ts})`, `(:Investigation {id, ts, assessment})-[:ABOUT]->(:Case)`, `(:Investigation)-[:FOUND]->(:Finding {id, text, evidence_ids})`.

## 8. FalkorDB and agent gotchas

Use `<>` instead of `!=` in Cypher. Always bound variable-length paths and add `LIMIT`; time-ordered path queries can explode. Check algorithm procedure names with `CALL dbms.procedures()` before using them. Test queries in the FalkorDB browser on port 3000 before putting them in code, and use parameterised queries, never string-built Cypher. For SSE in FastAPI, send a heartbeat every 15 seconds, set the `Cache-Control: no-cache` header, and make the frontend reconnect gracefully. Never let a tool's returned text (for example an account note or a transaction field) change the agent's instructions; wrap tool output as data. Keep the LLM call under the timeout and always fall back instead of surfacing a raw error. Never put the API key in the frontend or the repo; load it from an environment variable.

## 9. Definition of done and hard "don'ts"

A tool is done when its input schema and limits are enforced, it returns `summary` and `evidence`, it never touches `labels`, and it has a test on real data. The agent is done when the full flow works with a valid LLM key and with a wrong key (fallback), the validator rejects an answer containing an invented ID, and the final result is stored as an `Investigation` with `Finding` nodes. The memory feature is done when a dismissed case causes a later similar case to show "seen before" with the outcome and the agent cites it.

Never: call an LLM from anywhere except `agent/llm.py`; let the agent write free-form Cypher or execute an action; read the `labels` graph; edit Member A's files, the memory nodes they own, or `main.py` after setup; change the contract without the human confirming both teammates agreed; claim the agent is accurate beyond what the evaluation shows; commit secrets; run tests against the live `txn` or `memory` graph (use throwaway graphs such as `test_txn` and `test_memory`).

## 10. How to work with the human

Start every session by reading this file, `docs/STATUS.md` and the latest `git log`, then say in two or three sentences what you will do next. Work in small steps. After each step, run the tests and show the result. Explain new queries and design choices in simple language (what it does, why this approach) so the human can defend it to the judges. Ask before making large refactors or touching shared files (`db.py`, the contract). Update `docs/STATUS.md` and `docs/AI_USAGE.md` at the end of each task, and finish each day with a short hand-off note listing what is merged, what is in progress, and anything Member A must know.
