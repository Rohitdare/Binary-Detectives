# RingTrace (SPYNEX) Documentation Directory

Welcome to the RingTrace / SPYNEX documentation hub. This directory contains system specifications, algorithmic guides, architecture documents, and development records.

---

## 1. Core Architecture & System Guides

| Document | Description |
|---|---|
| **[`DETECTOR_GUIDE.md`](file:///d:/vortex/ringtrace/docs/DETECTOR_GUIDE.md)** | Comprehensive specification of all 9 graph pattern detection engines (cycles, fan-in, fan-out, relay chains, scatter-gather, gather-scatter, bipartite, dense clusters, hub accounts), mathematical definitions, Cypher queries, threshold tunings, and output schemas. |
| **[`DETECTION_SCHEDULER.md`](file:///d:/vortex/ringtrace/docs/DETECTION_SCHEDULER.md)** | Production background fraud detection scheduler architecture: threadpool concurrency control, graceful cooperative shutdown, supervisor timeout bounds, and lifecycle management. |
| **[`DEMO_AND_PITCH.md`](file:///d:/vortex/ringtrace/docs/DEMO_AND_PITCH.md)** | Step-by-step hackathon presentation guide, jury script, and interactive investigation demo walkthrough. |
| **[`STATUS.md`](file:///d:/vortex/ringtrace/docs/STATUS.md)** | Real-time project roadmap, milestone verification log, completed deliverables, and system status tracker. |
| **[`AI_USAGE.md`](file:///d:/vortex/ringtrace/docs/AI_USAGE.md)** | AI pair-programming transparency log: every AI-assisted code change, verification method, test outputs, and audit traces. |

---

## 2. Team Architectural Contracts

| Document | Description |
|---|---|
| **[`AGENTS_MEMBER_A.md`](file:///d:/vortex/ringtrace/docs/AGENTS_MEMBER_A.md)** | Member A contract (*Detect & Cases*): owns the 9 detection algorithms, synthetic generator fixtures, heuristic priority scorer, case builder, scan service, and evaluator. |
| **[`AGENTS_MEMBER_B.md`](file:///d:/vortex/ringtrace/docs/AGENTS_MEMBER_B.md)** | Member B contract (*Investigation & Memory*): owns the autonomous agent loop, 8 restricted MCP graph tools, FalkorDB memory graph, SSE event streaming, transaction replay, and interactive cockpit UI. |

---

## 3. Generated Analysis & System Audit Reports

Historical reports, simulation field mappings, and automated audit logs are organized in the [`generated_reports/`](file:///d:/vortex/ringtrace/docs/generated_reports/) subdirectory:

| Report | Description |
|---|---|
| **[`generated_reports/AGENT_DECISIONS.md`](file:///d:/vortex/ringtrace/docs/generated_reports/AGENT_DECISIONS.md)** | Architectural Decision Records (ADRs) tracking structural choices. |
| **[`generated_reports/BUILD_LOG.md`](file:///d:/vortex/ringtrace/docs/generated_reports/BUILD_LOG.md)** | Shell commands and historical build execution logs. |
| **[`generated_reports/FUNCTION_MAP.md`](file:///d:/vortex/ringtrace/docs/generated_reports/FUNCTION_MAP.md)** | Codebase AST mapping of all functions, classes, and backend endpoints. |
| **[`generated_reports/QUERY_LOG.md`](file:///d:/vortex/ringtrace/docs/generated_reports/QUERY_LOG.md)** | FalkorDB Cypher query audit traces and execution performance timings. |
| **[`generated_reports/SIMULATOR_ANALYSIS.md`](file:///d:/vortex/ringtrace/docs/generated_reports/SIMULATOR_ANALYSIS.md)** | Deep-dive analysis of the AMLSim-inspired synthetic transaction generator. |
| **[`generated_reports/SIMULATOR_FIELD_MAPPING.md`](file:///d:/vortex/ringtrace/docs/generated_reports/SIMULATOR_FIELD_MAPPING.md)** | Synthetic CSV data to FalkorDB property graph schema mappings. |
| **[`generated_reports/SIMULATOR_PATTERN_COVERAGE.md`](file:///d:/vortex/ringtrace/docs/generated_reports/SIMULATOR_PATTERN_COVERAGE.md)** | 9-pattern topology simulation and test coverage matrix. |
