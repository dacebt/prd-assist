# Plan — Multi-Agent PRD-Assist Turn Pipeline

**Created:** 2026-04-21
**Status:** Draft (awaiting user confirmation)
**Project root:** `/Users/colond01/projects/d-prototypes/prd-assist`

## Project Intent

Replace the single-supervisor turn pipeline in `apps/server/src/turn.ts` with a tiered multi-agent pipeline. One user turn now executes multiple LLM calls across small and big local Gemma 4 models (served OpenAI-compatible via LM Studio), routed by a small Orchestrator that classifies whether the turn requires PRD editing or more interviewing. Mid-turn "thinking" messages stream to the client over SSE; the final assistant reply closes the turn.

### What already exists

- **Single-supervisor turn** at `apps/server/src/turn.ts:188` (`handleTurn`) runs one LLM in an OpenAI-style tool loop over four MCP tools (`get_prd`, `update_section`, `list_empty_sections`, `mark_confirmed`). Returns one reply string.
- **Session mutex** at `apps/server/src/mutex.ts` — one turn at a time per session. Held across the entire turn.
- **PRD schema** pinned in `packages/shared/src/schemas.ts:14` — seven sections (`vision`, `problem`, `targetUsers`, `goals`, `coreFeatures`, `outOfScope`, `openQuestions`), each with `content`, `status` (`empty | draft | confirmed`), `updatedAt`.
- **SQLite store** at `apps/server/src/db.ts` — `sessions` table with `prd_json` column and `CREATE TABLE IF NOT EXISTS` (no migration path today).
- **MCP server** at `apps/mcp` — four tools above. Untouched by this project. Small worker agents call the same MCP server through the existing client.
- **HTTP API** at `apps/server/src/routes/messages.ts:30` — `POST /api/sessions/:id/messages` returns `{ reply }` JSON. Not streaming.
- **Web client** at `apps/web/src` — React + Vite. `useSessionPolling.ts` polls at 500ms while a turn is in flight.

### What "done" looks like

A user's turn runs through the new pipeline end-to-end: the Orchestrator classifies, one of two branches executes (Interviewer-Big or Planner-Big with workers), the client sees interim streamed "thinking" messages and a final message, the PRD summary is fresh for the next turn, and the current single-supervisor code path is gone.

### Runnability

- **Entrypoint:** `apps/server/src/index.ts` — Hono HTTP server. Launched by `pnpm` scripts in `apps/server/package.json`.
- **User-facing surface:** `apps/web` in the browser, POSTs messages, renders replies. After SSE lands, subscribes to streamed events on an active turn.
- **End-to-end walking skeleton already exists** — the current single-supervisor pipeline is running. Every slice must leave this skeleton working. Slice 1 preserves current behavior behind the new config shape; slice 6 is the only slice that changes the transport layer.

## Architecture

### Runtime topology (target state)

```digraph
user -> http_post_message -> server_turn_handler [label="apps/web → POST /api/sessions/:id/messages"]
server_turn_handler -> session_mutex_acquire
session_mutex_acquire -> orchestrator [label="small Gemma 4"]
orchestrator_input -> orchestrator [label="recent history + prd_summary"]
orchestrator -> routing_decision [label="{ needsPrdWork: boolean }"]

routing_decision -> interviewer_big [label="needsPrdWork=false"]
routing_decision -> planner_big [label="needsPrdWork=true"]

interviewer_big -> final_reply [label="big Gemma 4, no tools, asks next question"]

planner_big -> task_list [label="big Gemma 4, planning only, no edit tools"]
task_list -> worker_sequence [label="one worker per task, serial"]
worker_sequence -> mcp_edit_tools [label="small Gemma 4, scoped MCP tools per task"]
mcp_edit_tools -> prd_json_updated
worker_sequence -> planner_big_final_verify [label="planner-big reads updated PRD"]
planner_big_final_verify -> interviewer_small_close [label="small Gemma 4, per-step prompt"]
interviewer_small_close -> final_reply

final_reply -> summary_trigger [label="if prd_json changed this turn"]
summary_trigger -> summary_agent [label="small Gemma 4"]
summary_agent -> prd_summary_persisted

final_reply -> session_mutex_release
session_mutex_release -> http_response [label="SSE final event + DB-persisted assistant message"]

stream_events -> sse_transport [label="every stage emits thinking events"]
sse_transport -> web_client [label="EventSource renders thinking + final"]
```

### Dependency direction (slices)

```digraph
S1_foundation -> S2_summary
S1_foundation -> S3_orchestrator
S2_summary -> S3_orchestrator [label="orchestrator reads summary"]
S3_orchestrator -> S4_interviewer_big [label="routing in place, branch replaces no-work path"]
S3_orchestrator -> S5_planner_pipeline [label="routing in place, branch replaces work path"]
S4_interviewer_big -> S6_streaming [label="producer live"]
S5_planner_pipeline -> S6_streaming [label="producer live"]
S2_summary -> S6_streaming [label="producer live"]

dependencies_point_inward -> core_logic [label="agents, routing, state"]
boundary_adapters -> http_sse_llm_mcp [label="transport and model I/O"]
core_logic -> never_imports_from_boundary
```

### Slice order: pipeline first, SSE last

```digraph
slice_1_foundation -> slice_2_summary -> slice_3_orchestrator -> slice_4_interviewer_big -> slice_5_planner_pipeline -> slice_6_streaming

rationale_pipeline_first -> every_intermediate_commit_runs
rationale_sse_last -> all_stream_producers_live_before_transport_wires
alternative_sse_first -> rejected [label="would require synthetic events with no real producer"]
```

## Shared Contracts

Contracts defined in one slice and consumed by others. Pinned here; specs reference by name.

### C1. `AgentRole` + `ModelConfig`

**Owner:** S1. **Consumers:** S2, S3, S4, S5, S6.

```
type AgentRole =
  | "supervisor"       // legacy; removed in S4+S5 cutover
  | "orchestrator"
  | "interviewerBig"
  | "interviewerSmall"
  | "plannerBig"
  | "worker"
  | "summary";

type ModelRoleConfig = {
  model: string;        // LM Studio model id, e.g. "google/gemma-4-26b"
  perCallTimeoutMs: number;
  maxIterations: number; // tool-loop iteration cap for roles that loop; 1 for single-shot roles
};

type ModelConfig = Record<AgentRole, ModelRoleConfig>;
```

No global `wallClockMs` — per-call timeouts only. The session mutex scopes the turn; runaway turns hurt one user on a local prototype.

### C2. Stream event schema

**Owner:** S1. **Producers:** S2 (summary), S3 (orchestrator), S4 (interviewer-big), S5 (planner + workers + interviewer-small). **Consumer:** S6 (transport + web rendering).

```
type StreamEvent =
  | { kind: "thinking"; agentRole: AgentRole; content: string; at: string }
  | { kind: "final"; content: string; at: string };
```

`kind: "final"` closes the turn; any events after `final` are protocol violations. Producers emit through a per-turn `StreamSink` handle. In S1 through S5, `StreamSink` is implemented as a function that writes to `console.warn` for dev-time observability and to a buffer the existing JSON response reads from. In S6, `StreamSink` is implemented to write SSE frames.

### C3. Streaming `LlmClient` interface

**Owner:** S1. **Consumer:** S6 (implementation).

`apps/server/src/llm.ts` today exports `LlmClient.chat()` typed as non-streaming. S1 adds a second method `LlmClient.chatStreaming()` that returns an async iterable of tokens or delta chunks, typed but unimplemented (throws `NotImplemented` until S6). Agent roles that benefit from token streaming (Interviewer-Big, Interviewer-Small) call the streaming method only in S6; earlier slices use `chat()`.

### C4. Summary storage shape

**Owner:** S2. **Consumer:** S3.

`sessions` table gains column `prd_summary TEXT` (nullable). `SessionStore` exposes `persistSummary(sessionId, summary)` and `sessionGet` is extended to return `summary: string | null`. Null means no summary has been generated yet — slice 3 must fall back to raw `prd_json` in that case.

DB migration runs on server start: a versioned migration step reads the current schema version from a new `schema_version` table and applies the `ALTER TABLE sessions ADD COLUMN prd_summary TEXT` if not already applied. `CREATE TABLE IF NOT EXISTS` alone will not add the column to existing databases.

### C5. Orchestrator output

**Owner:** S3. **Consumer:** S3 (routing code only, no cross-slice consumption).

`{ needsPrdWork: boolean }` validated by Zod. Gemma 4 has native structured-output support — rely on it. On Zod parse failure, fail closed: default to `needsPrdWork: false` (routes to Interviewer-Big, the read-only branch). One retry is permitted with an explicit JSON-only instruction; second failure falls through to the safe default.

### C6. Planner task list schema

**Owner:** S5. **Consumer:** S5 (internal — Planner-Big ↔ worker dispatcher).

Structured Zod schema for the task list Planner-Big emits. Spec-creator pins the exact shape during S5's interview. The spec must resolve the worker-context question explicitly: either Planner-Big includes current section content in each task payload, or each worker calls `get_prd` itself before editing. These are the only two acceptable shapes; the spec picks one.

## Slice Manifest

Six slices. Every slice preserves a running end-to-end product. No slice introduces code unreachable from the entrypoint at commit time.

### S1 — Foundation

**Spec:** `.docs/planning/specs/2026-04-21-multi-agent-turn-pipeline-foundation.spec.md`

**Owns:** `apps/server/src/config.ts` (extended), `apps/server/src/llm.ts` (extended), `apps/server/src/prompts/` (new directory with one file per `AgentRole`; initial contents extract current prompt into `prompts/supervisor.ts`), `apps/server/src/stream.ts` (new).

**Runnability contribution:** Config surface and shared types land. `handleTurn` rewires to select its model via `config.models.supervisor` and consumes the extracted `prompts/supervisor.ts`. Behavior is identical to today; the new types have real callers this commit.

**Explicitly NOT owned:** no new agent logic, no routing, no DB schema change, no transport change.

### S2 — Summary storage and agent

**Spec:** `.docs/planning/specs/2026-04-21-multi-agent-turn-pipeline-summary.spec.md`

**Owns:** `apps/server/src/db.ts` (versioned migration scaffolding + `prd_summary` column), `apps/server/src/sessions.ts` (store method + extended `sessionGet`), `apps/server/src/summaryAgent.ts` (new small-model agent), `apps/server/src/turn.ts` (post-turn hook that fires summary regen when PRD changed this turn).

**Runnability contribution:** Every turn that edits the PRD writes a fresh summary. Nothing reads the summary yet — the write path is live, the read path activates in S3. This is not dead code: the persisted summary is a real behavioral output visible in the database.

**Explicitly NOT owned:** no orchestrator, no routing, no consumer of the summary.

### S3 — Orchestrator and routing

**Spec:** `.docs/planning/specs/2026-04-21-multi-agent-turn-pipeline-orchestrator.spec.md`

**Owns:** `apps/server/src/orchestrator.ts` (new small-model classifier), `apps/server/src/turn.ts` (routing: orchestrator called first, both branches temporarily dispatch to the existing `runToolCallLoop` under the legacy supervisor prompt).

**Runnability contribution:** Routing is live. Both branches still execute the legacy supervisor — behavior is unchanged end-to-end, but the orchestrator's classification is persisted (logged to stream sink) and drives which prompt/model combination runs. The routing decision is observable before the branches diverge.

**Explicitly NOT owned:** no new Interviewer or Planner agents.

### S4 — Interviewer-Big branch

**Spec:** `.docs/planning/specs/2026-04-21-multi-agent-turn-pipeline-interviewer-big.spec.md`

**Owns:** `apps/server/src/interviewerBig.ts` (new single-call agent, no tools, big Gemma 4), `apps/server/src/prompts/interviewerBig.ts`, `apps/server/src/turn.ts` (no-work branch now calls `interviewerBig` instead of the legacy loop).

**Runnability contribution:** When the Orchestrator routes no-work, the user's next question comes from the new agent with a gap-oriented prompt. Work-branch still runs the legacy loop temporarily.

**Explicitly NOT owned:** no planner, no workers.

### S5 — Planner-Big pipeline

**Spec:** `.docs/planning/specs/2026-04-21-multi-agent-turn-pipeline-planner.spec.md`

**Owns:** `apps/server/src/plannerBig.ts` (big Gemma 4, planning only, no edit tools, emits task list), `apps/server/src/workers.ts` (small Gemma 4 workers, each with scoped MCP tools, sequential execution), `apps/server/src/interviewerSmall.ts` (small Gemma 4, per-step prompt family, closes work-branch turns), `apps/server/src/prompts/plannerBig.ts`, `apps/server/src/prompts/worker.ts`, `apps/server/src/prompts/interviewerSmall.ts`, `apps/server/src/turn.ts` (work-branch replaced end-to-end). Legacy supervisor path deleted: `prompts/supervisor.ts`, `AgentRole "supervisor"`, and any supervisor-specific code removed. `runToolCallLoop` either deleted or retained only if workers reuse its scaffolding.

**Runnability contribution:** Work-branch runs the full new pipeline. Legacy supervisor is removed. Both branches now use only new-pipeline agents.

**Spec-level decomposition signal:** S5 is the largest slice. If the spec interview surfaces that S5 cannot be verified end-to-end as one unit (likely — planner task-list contract, worker invocation, final verify, and interviewer-small close each have distinct failure modes), spec-creator decomposes S5 into subspecs at `.docs/planning/subspecs/`. That is a spec-level decision, not a plan-level one.

**Explicitly NOT owned:** transport changes, web client changes.

### S6 — SSE transport and web streaming

**Spec:** `.docs/planning/specs/2026-04-21-multi-agent-turn-pipeline-streaming.spec.md`

**Owns:** `apps/server/src/routes/messages.ts` (endpoint becomes SSE-native via Hono `streamSSE`), `apps/server/src/llm.ts` (real `chatStreaming()` implementation), `apps/server/src/turn.ts` (wires a real SSE-writing `StreamSink` in place of the console-log/buffer sink), `apps/web/src/api.ts` (new `EventSource`-based message posting), `apps/web/src/hooks/useSessionPolling.ts` (removed or disabled when SSE is active — polling was only for interim-state visibility), `apps/web/src/components/` (render interim `thinking` messages with animated indicators).

**Runnability contribution:** Users see modern-chat streaming UX — thinking indicators during long turns, tokens as they arrive for Interviewer messages, final message closes the turn. Persistence semantics: the final message is written to `messages_json` only on `kind: "final"` event; thinking events are transport-only (not persisted to history).

**Explicitly NOT owned:** no new agent logic; all producers are already live from S1–S5.

## Cross-System Verification Scenarios

Scenarios that exercise more than one slice and cannot live in any single spec.

### V1. Interview turn — no PRD work

**Exercises:** S1, S2 (read path), S3, S4.

**User observes:** User sends a clarifying reply that does not change the PRD. The web client displays the Interviewer-Big's next question within the per-call timeout. Database shows no change to `prd_json`; `prd_summary` unchanged from prior turn. Assistant message persists to `messages_json`.

### V2. Work turn — single-section edit

**Exercises:** S1, S2, S3, S5.

**User observes:** User provides information that should populate a section. Orchestrator routes to work. Planner-Big emits a one-task plan, a worker edits the section via `update_section`, Planner-Big final-verifies, Interviewer-Small confirms the edit to the user. Database shows the edited section with `status: "draft"` and refreshed `prd_summary`. Assistant message persists.

### V3. Work turn — multi-section edit

**Exercises:** S1, S2, S3, S5.

**User observes:** User provides information spanning two sections. Planner-Big emits a two-task plan, workers execute serially, final verify passes, Interviewer-Small confirms both edits. Database shows both sections updated.

### V4. Streaming — thinking and final events

**Exercises:** S1, S3, S4 or S5, S6.

**User observes:** During a turn, the web client shows animated thinking indicators labeled by agent role (`orchestrator`, `plannerBig`, `worker`, etc.). The final assistant message replaces the indicators when the `final` event arrives. No duplicate history entries. Reloading the page mid-turn shows no partial state — history only contains the final user + assistant pair.

### V5. Summary freshness across turns

**Exercises:** S2, S3.

**User observes (via database):** Turn 1 edits a section. Turn 2's Orchestrator receives the fresh summary generated after turn 1, not stale or null. Verifiable by inspecting the orchestrator's logged input and the `prd_summary` column at turn boundaries.

### V6. Failure mode — orchestrator JSON parse failure

**Exercises:** S3.

**User observes:** A malformed classifier response falls closed to `needsPrdWork: false`; the turn completes through Interviewer-Big and the PRD is not accidentally edited. No error is visible to the user beyond a possibly off-topic reply, which is the correct safe default.

### V7. Failure mode — worker tool failure

**Exercises:** S5.

**User observes:** A worker's `update_section` call fails (e.g., content too long). Planner-Big's final verify detects the incomplete edit and the turn closes with an Interviewer-Small message that acknowledges the partial failure without claiming success. The database reflects whichever edits did land; no silent partial-state claim.

## Research Items

Items that require investigation before the spec they affect is written, recorded here so they are not forgotten.

- **R1. LM Studio streaming response shape** — confirm the delta/token shape returned by Gemma 4 via LM Studio's OpenAI-compatible streaming endpoint. Affects S1 (streaming interface shape) and S6 (client implementation). Can be answered by running a minimal streaming request against LM Studio before S1 spec is finalized.
- **R2. SQLite migration idiom for existing schema** — pick the migration approach (raw `ALTER TABLE` gated on a `schema_version` row, vs. an off-the-shelf migration library). Affects S2.
- **R3. Worker context tradeoff** — measure whether a worker given only a section key + instructions reliably produces correct edits, or whether current-content-in-task-payload is required. Resolvable by a small offline Gemma 4 7.5B probe. Affects S5's C6.
- **R4. Per-role timeout budget** — establish rough LM Studio latency floors for Gemma 4 at 7.5B and 26B for single inference calls on the target hardware. Affects S1 `ModelConfig` defaults. Measurable with the current codebase once S1 is stubbed.

## Adaptation Log

_Empty. Entries appended during spec interviews or work-mode when reality contradicts the plan._

## Directory Ownership (Runnability First)

Every top-level directory touched by this project has an owning slice.

| Directory | Owner Slice(s) |
|---|---|
| `apps/server/src/config.ts`, `apps/server/src/llm.ts`, `apps/server/src/stream.ts`, `apps/server/src/prompts/` | S1 |
| `apps/server/src/db.ts`, `apps/server/src/sessions.ts`, `apps/server/src/summaryAgent.ts` | S2 |
| `apps/server/src/orchestrator.ts` | S3 |
| `apps/server/src/interviewerBig.ts` | S4 |
| `apps/server/src/plannerBig.ts`, `apps/server/src/workers.ts`, `apps/server/src/interviewerSmall.ts` | S5 |
| `apps/server/src/turn.ts` | S1 (rewire), S2 (hook), S3 (routing), S4 (branch), S5 (branch), S6 (sink) |
| `apps/server/src/routes/messages.ts`, `apps/web/src/api.ts`, `apps/web/src/hooks/`, `apps/web/src/components/` | S6 |
| `apps/mcp/*`, `packages/shared/*`, `data/`, `scripts/`, `tmp/`, `dist/` | Untouched by this project |

Deployable entrypoint `apps/server/src/index.ts` continues to serve the same HTTP surface through all slices; S6 is the only slice that changes the wire protocol (adds SSE endpoint; the existing JSON endpoint is removed in S6).

## Accepted Risks

- **Local GPU serialization** — Branch B turns may take multiple minutes on a single GPU. Accepted for a local prototype; the session mutex and per-call timeouts bound the damage.
- **Summary drift** — the maintained summary may lag the PRD by one turn's edit, and regeneration may occasionally miss nuance. Accepted: Orchestrator consumes the summary and the summary regenerates on every PRD-editing turn, so lag is bounded to one turn. Risk revisited if routing accuracy becomes a measurable problem.
- **No reviewer loop on workers** — Planner-Big's final verification is the only check on worker output. Accepted: doubling small-model calls per task is not justified without measured bad-edit rates.

## Rejected Alternatives

- **Additive (keep legacy path behind a flag)** — rejected: prototype stage, no production users to protect, feature-flag infrastructure does not exist, dual-path would be cruft.
- **SSE-first, pipeline-later** — rejected: would require synthetic thinking events with no real producer until S3–S5 land, forcing a protocol tear-up when real events arrive.
- **WebSocket transport** — rejected: use is strictly server-to-client, client submits before the turn begins, mutex makes mid-turn interrupts architecturally awkward. SSE is the right fit.
- **Per-task planner-reviewer loop** — deferred, not permanently rejected. Revisited only if measurement shows bad edits slipping through Planner-Big's final verify.
- **Hard global turn timer** — rejected: per-call timeouts already bound single stuck calls; a global cap on local prototype hurts legitimate multi-call turns more than it protects.
- **Model swap to Qwen/Llama for tool-calling roles** — rejected: Gemma 4 has native tool-calling in LM Studio as of April 2026 (verified against current LM Studio changelog entries for Apr 2, 9, 10 2026). Gemma 4 across all roles.
