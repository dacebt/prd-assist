# Multi-Agent Turn Pipeline — S1 Foundation

## Project Status
refactor

## Parent Reference
- Kind: plan
- Plan: `../plans/2026-04-21-multi-agent-turn-pipeline.plan.md`
- Slice: S1 — Foundation
- Boundary: `apps/server/src/config.ts` (extended), `apps/server/src/llm.ts` (extended), `apps/server/src/prompts/` (new directory), `apps/server/src/stream.ts` (new), `apps/server/src/turn.ts` (rewired through new config and sink), plus test relocations. No new agent logic, no routing, no DB schema change, no transport change.
- Inherited constraints:
  - **C1** owner: `AgentRole`, `ModelRoleConfig`, `ModelConfig` shapes pinned by this spec.
  - **C2** owner: `StreamEvent` shape pinned by this spec.
  - **C3** owner: streaming `LlmClient` method signature pinned by this spec; implementation body is `NotImplemented` until S6.
  - No global turn wall-clock; per-call timeouts only. Session mutex remains the turn-level scope at `apps/server/src/turn.ts:196`.
  - Runnability: every slice leaves the product running end-to-end. Current behavior (single supervisor over MCP tool loop) is preserved externally.
  - All files added in a slice are reachable from the server entrypoint (`apps/server/src/index.ts`) within that same slice.

## Intent

Establish the foundational types, config shape, prompt module layout, and stream plumbing that slices S2–S6 consume. Preserve current user-facing behavior: the single supervisor agent continues to run over the existing MCP tool loop and returns identical replies to identical inputs. This slice pins shared contracts C1, C2, and C3 from the plan and reorganizes internal structure so subsequent slices have stable seams to land against.

## Scope

### In Scope
- Define `AgentRole` union type with literal string values.
- Define `ModelRoleConfig` and `ModelConfig` types.
- Replace the single `model: string` field in `ServerOptions`, `RouteDeps`, and `TurnConfig` with a `ModelConfig` map keyed by `AgentRole`.
- Extend `apps/server/src/config.ts` with `DEFAULT_MODEL_CONFIG` — a baked-in default map for every `AgentRole`, overridable via a single `LM_STUDIO_MODELS_OVERRIDE` JSON env var merged on top.
- Move the current prompt from `apps/server/src/prompt.ts` to `apps/server/src/prompts/supervisor.ts`; delete the old file. Move `apps/server/src/prompt.test.ts` to `apps/server/src/prompts/supervisor.test.ts`. Update the import in `apps/server/src/turn.ts:6`.
- Add empty prompt-builder stub files at `apps/server/src/prompts/<role>.ts` for every non-supervisor role. Each file exports `buildXxxPrompt(): string` returning an empty string. Imported into a new `apps/server/src/prompts/index.ts` that re-exports them, and the re-export is referenced from `turn.ts` so the stubs are reachable from the entrypoint.
- Add `apps/server/src/stream.ts` exporting `StreamEvent` and `StreamSink` types plus `createBufferedSink()` — a factory returning a sink that appends events to an in-memory array and `console.warn`s each event.
- Rewire `handleTurn` to emit one `kind: "final"` event through a `StreamSink` when the tool loop returns. The returned reply string is derived from the final event in the sink's buffer. All intermediate termination paths (`iteration_cap`, `per_call_timeout`, `wall_clock`, `unexpected`) emit the same `kind: "final"` event shape carrying their termination message.
- Extend `LlmClient` with a `chatStreaming(args): AsyncIterable<ChatCompletionChunk>` method. The OpenAI-backed implementation throws `NotImplemented` for the streaming method until S6. The non-streaming `chat()` method is unchanged.
- Update `apps/server/src/index.ts` env bootstrap: read `LM_STUDIO_BASE_URL` as today; build the effective `ModelConfig` from `DEFAULT_MODEL_CONFIG` merged with any `LM_STUDIO_MODELS_OVERRIDE` JSON; pass the merged `ModelConfig` into `startServer`. The legacy `LM_STUDIO_MODEL` env var is removed.

### Out of Scope
- Any new agent (orchestrator, interviewer-big, planner-big, workers, interviewer-small, summary).
- Any routing logic — `handleTurn` still runs the single supervisor tool loop.
- DB schema changes and the `prd_summary` column (S2).
- Real SSE transport — messages endpoint still returns `{ reply }` JSON (S6).
- Implementation of `chatStreaming` body — throws `NotImplemented` (S6).
- Web client changes.
- `apps/mcp/*`, `packages/shared/*` edits.
- Content of non-supervisor prompt files — empty strings for S1.
- Per-role timeout tuning — all roles copy today's `perCallTimeoutMs: 90_000` (plan research item R4 refines later).

## Implementation Constraints

### Architecture

Dependencies flow inward. Boundary layers (`apps/server/src/llm.ts`, `apps/server/src/stream.ts`, `apps/server/src/routes/*`) import types from core config and turn logic; core turn logic does not import from transport.

- `apps/server/src/config.ts` — owns `AgentRole`, `ModelRoleConfig`, `ModelConfig`, `DEFAULT_MODEL_CONFIG`, `TURN_DEFAULTS`. No imports from LLM, stream, or route modules.
- `apps/server/src/stream.ts` — owns `StreamEvent`, `StreamSink`, `createBufferedSink`. Imports `AgentRole` from `config.ts`. No imports from transport or route modules.
- `apps/server/src/llm.ts` — owns `LlmClient` interface including `chatStreaming`. Imports nothing from stream or config beyond type-level symbols if needed.
- `apps/server/src/prompts/` — each role file is a leaf module. No cross-imports between prompt files. `prompts/index.ts` re-exports all builders.
- `apps/server/src/turn.ts` — consumes `ModelConfig`, `StreamSink`, and the prompts barrel. Continues to own the tool-call loop and mutex-scoped turn lifecycle.

### Boundaries

External inputs validated at the server boundary, not inside core logic:

- `LM_STUDIO_MODELS_OVERRIDE` env var, when set, is parsed as JSON and validated by a Zod schema (`z.record(AgentRoleSchema, z.object({ model: z.string().min(1), perCallTimeoutMs: z.number().int().positive().optional(), maxIterations: z.number().int().positive().optional() }))`) in `apps/server/src/index.ts` before merging into `DEFAULT_MODEL_CONFIG`. Parse failures log the error to `console.error` and abort startup with `process.exit(1)`. Partial overrides are permitted — any role not present in the override retains the default.
- `DEFAULT_MODEL_CONFIG` is a typed literal in `config.ts`; TypeScript enforces every `AgentRole` key is present at compile time via `Record<AgentRole, ModelRoleConfig>`.

### Testing Approach

- Type system and existing test suites are the primary verification. No new unit tests for the types or the prompt-file rename — compile-time enforcement is the proof.
- Every existing test in `apps/server/src/*.test.ts` and `apps/server/src/routes/*.test.ts` must pass unchanged after this slice, except for:
  - `apps/server/src/prompt.test.ts` — moves to `apps/server/src/prompts/supervisor.test.ts` with its import path updated; test bodies unchanged.
  - Any test that constructs `TurnDeps`, `ServerOptions`, or `RouteDeps` inline — updated to pass a `ModelConfig` in place of the removed `model: string` field. Test expectations unchanged.
- Do not add tests that restate type-system guarantees (e.g., "DEFAULT_MODEL_CONFIG has a key for every AgentRole"). The type `Record<AgentRole, ModelRoleConfig>` proves this at compile time.
- `createBufferedSink` gets one focused test at `apps/server/src/stream.test.ts`: construct a sink, emit two events (one `thinking`, one `final`), assert the buffer contains both in order and the `final` event's `content` is retrievable via a `getFinal()` helper. One test, no more.

### Naming

- `AgentRole` — the union type. String literal values: `"supervisor" | "orchestrator" | "interviewerBig" | "interviewerSmall" | "plannerBig" | "worker" | "summary"`. Do not introduce new role names in this slice.
- `ModelRoleConfig` — per-role record: `{ model: string; perCallTimeoutMs: number; maxIterations: number }`.
- `ModelConfig` — `Record<AgentRole, ModelRoleConfig>`.
- `DEFAULT_MODEL_CONFIG` — exported constant in `config.ts`.
- `StreamEvent` — discriminated union keyed on `kind`.
- `StreamSink` — `(event: StreamEvent) => void`.
- `createBufferedSink` — factory returning `{ sink: StreamSink; events: readonly StreamEvent[]; getFinal(): string | null }`.
- `buildSupervisorPrompt` — function in `prompts/supervisor.ts`. Replaces `buildSystemPrompt` from `prompt.ts`.
- Stub builders follow the pattern `build<Role>Prompt` — e.g., `buildOrchestratorPrompt`, `buildInterviewerBigPrompt`.

## Requirements

### R1. `AgentRole` union

Defined in `apps/server/src/config.ts`:

```ts
export type AgentRole =
  | "supervisor"
  | "orchestrator"
  | "interviewerBig"
  | "interviewerSmall"
  | "plannerBig"
  | "worker"
  | "summary";
```

A Zod schema `AgentRoleSchema = z.enum([...])` is exported alongside for runtime validation of the env override.

### R2. `ModelRoleConfig` and `ModelConfig`

Defined in `apps/server/src/config.ts`:

```ts
export interface ModelRoleConfig {
  model: string;
  perCallTimeoutMs: number;
  maxIterations: number;
}

export type ModelConfig = Record<AgentRole, ModelRoleConfig>;
```

### R3. `DEFAULT_MODEL_CONFIG`

Exported constant in `apps/server/src/config.ts` typed as `ModelConfig`:

| Role | `model` | `perCallTimeoutMs` | `maxIterations` |
|---|---|---|---|
| `supervisor` | `google/gemma-4-26b-a4b` | `90_000` | `12` |
| `orchestrator` | `google/gemma-4-e4b` | `90_000` | `1` |
| `interviewerBig` | `google/gemma-4-26b-a4b` | `90_000` | `1` |
| `interviewerSmall` | `google/gemma-4-e4b` | `90_000` | `1` |
| `plannerBig` | `google/gemma-4-26b-a4b` | `90_000` | `12` |
| `worker` | `google/gemma-4-e4b` | `90_000` | `12` |
| `summary` | `google/gemma-4-e4b` | `90_000` | `1` |

`TURN_DEFAULTS` retains its existing members (`maxIterations`, `perCallTimeoutMs`, `wallClockMs`) for the supervisor call site during S1. `wallClockMs` is retained in `TURN_DEFAULTS` for S1 and removed in S5 when the legacy supervisor path is deleted.

### R4. Env override parsing

In `apps/server/src/index.ts`, replace the current `LM_STUDIO_MODEL` read with:

1. Read `process.env["LM_STUDIO_MODELS_OVERRIDE"]`. If undefined, effective config is `DEFAULT_MODEL_CONFIG`.
2. If defined, parse as JSON; on `SyntaxError`, log `"invalid LM_STUDIO_MODELS_OVERRIDE JSON: <message>"` to `console.error` and `process.exit(1)`.
3. Validate the parsed value with the Zod schema:
   ```ts
   z.record(
     AgentRoleSchema,
     z.object({
       model: z.string().min(1),
       perCallTimeoutMs: z.number().int().positive().optional(),
       maxIterations: z.number().int().positive().optional(),
     }).partial({ perCallTimeoutMs: true, maxIterations: true })
   )
   ```
   On validation failure, log `"invalid LM_STUDIO_MODELS_OVERRIDE shape: <zod error>"` to `console.error` and `process.exit(1)`.
4. For each role present in the override, replace the corresponding entry in `DEFAULT_MODEL_CONFIG` field-by-field (e.g., override `{ "orchestrator": { "model": "x" } }` replaces only `model` for `orchestrator`, retaining the default `perCallTimeoutMs` and `maxIterations`).
5. Pass the merged `ModelConfig` into `startServer({ ..., models: merged })`.

### R5. `ServerOptions`, `RouteDeps`, `TurnConfig`, `TurnDeps` reshape

- `ServerOptions.model: string` → `ServerOptions.models: ModelConfig`.
- `RouteDeps` in `apps/server/src/routes/index.ts` mirrors the change.
- `TurnConfig` in `apps/server/src/config.ts`: replace `model: string` with no per-call model field — the config passed into `handleTurn` receives `models: ModelConfig` and `handleTurn` selects the supervisor entry internally.
- `TurnDeps.config` in `apps/server/src/turn.ts` carries `{ models: ModelConfig; maxIterations: number; perCallTimeoutMs: number; wallClockMs: number }` for S1. `maxIterations`, `perCallTimeoutMs`, and `wallClockMs` at the top level continue to govern the supervisor loop and are removed in S5 when the supervisor path is deleted.

### R6. Prompt module layout

- Create directory `apps/server/src/prompts/`.
- `apps/server/src/prompts/supervisor.ts` — contains the current prompt body verbatim, exported as `buildSupervisorPrompt(): string`. The returned string is byte-identical to the string currently returned by `buildSystemPrompt()` in `apps/server/src/prompt.ts:1`.
- `apps/server/src/prompts/orchestrator.ts`, `apps/server/src/prompts/interviewerBig.ts`, `apps/server/src/prompts/interviewerSmall.ts`, `apps/server/src/prompts/plannerBig.ts`, `apps/server/src/prompts/worker.ts`, `apps/server/src/prompts/summary.ts` — each exports `build<Role>Prompt(): string` returning `""`.
- `apps/server/src/prompts/index.ts` — re-exports all seven builders by name.
- Delete `apps/server/src/prompt.ts`.
- Move `apps/server/src/prompt.test.ts` to `apps/server/src/prompts/supervisor.test.ts`; update its import to `./supervisor` and its assertion to reference `buildSupervisorPrompt`. Assertion contents remain equivalent in meaning.
- `apps/server/src/turn.ts` imports `buildSupervisorPrompt` from the prompts barrel: `import { buildSupervisorPrompt } from "./prompts"`. The `turn.ts:213` system-prompt construction uses it unchanged semantically.
- The prompts barrel must be imported and used somewhere reachable from `apps/server/src/index.ts` within this slice so the stub builders are not dead code. Achieved by `turn.ts` importing from `./prompts` (which re-exports all seven builders).

### R7. `StreamEvent` and `StreamSink`

Defined in `apps/server/src/stream.ts`:

```ts
import type { AgentRole } from "./config";

export type StreamEvent =
  | { kind: "thinking"; agentRole: AgentRole; content: string; at: string }
  | { kind: "final"; content: string; at: string };

export type StreamSink = (event: StreamEvent) => void;

export interface BufferedSink {
  sink: StreamSink;
  events: readonly StreamEvent[];
  getFinal(): string | null;
}

export function createBufferedSink(): BufferedSink { /* impl */ }
```

`createBufferedSink` returns an object whose `sink` appends to `events` and `console.warn`s each event (format: `stream [${agentRole ?? "final"}] ${kind}: <content first 120 chars>`). `getFinal()` scans `events` for the most recent `kind: "final"` entry and returns its `content`, or `null` if none present.

### R8. `handleTurn` rewiring to StreamSink

`handleTurn` in `apps/server/src/turn.ts`:

1. Construct a fresh `BufferedSink` at the start of each turn, inside the `mutex.tryAcquire` guard, after the session load.
2. Pass `sink` into `runToolCallLoop` as a new parameter. `runToolCallLoop` emits exactly one `StreamEvent` at each termination path: `{ kind: "final", content: <assistantContent>, at: <iso-now> }`. No `thinking` events are emitted in S1.
3. After `runToolCallLoop` returns, `handleTurn` reads `buffered.getFinal()`. If null (defensive — should not occur under the contract above), the returned reply is `UNEXPECTED_ERROR_MESSAGE`.
4. `handleTurn`'s external return type remains `Promise<string>`. `messages` endpoint still returns `{ reply }`.
5. `session.messages` assistant append uses the same final string derived from the sink.

### R9. `LlmClient.chatStreaming`

Extend `apps/server/src/llm.ts`:

```ts
import type OpenAI from "openai";

export interface LlmClient {
  chat(args: { model: string; messages: unknown[]; tools?: LlmToolDescriptor[]; signal?: AbortSignal }): Promise<AssistantMessage>;
  chatStreaming(args: { model: string; messages: unknown[]; tools?: LlmToolDescriptor[]; signal?: AbortSignal }): AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
}

export class NotImplementedError extends Error {
  constructor(feature: string) { super(`${feature} not implemented`); this.name = "NotImplementedError"; }
}
```

The OpenAI-backed implementation returned by `createOpenAiLlmClient` implements `chatStreaming` as:

```ts
async function* chatStreaming() {
  throw new NotImplementedError("chatStreaming");
  yield undefined as never; // unreachable, satisfies AsyncIterable shape
}
```

`chatStreaming` must be importable and type-reachable from `turn.ts` (via `LlmClient`) even though no call site invokes it in S1. Reachability is satisfied because `TurnDeps.llm: LlmClient` already references the interface.

### R10. Env bootstrap update

`apps/server/src/index.ts`:
- Remove the `const model = process.env["LM_STUDIO_MODEL"] ?? "google/gemma-4-26b-a4b";` line.
- Remove the line passing `model` into `startServer`.
- Read and validate `LM_STUDIO_MODELS_OVERRIDE` per R4.
- Pass `models: merged` into `startServer`.
- `turbo.json` `passThroughEnv` lists: remove `LM_STUDIO_MODEL`, add `LM_STUDIO_MODELS_OVERRIDE`, retain `LM_STUDIO_BASE_URL`, `MCP_COMMAND`, `MCP_ARGS`, `SQLITE_PATH`.

## Rejected Alternatives

- **Per-role env vars (e.g., `LM_STUDIO_MODEL_ORCHESTRATOR`)** — rejected: seven env vars for seven roles is noisy in shell invocations and deployment scripts; a single JSON override is easier to version-control as a block. Partial overrides are still supported via the merge strategy.
- **Keep `prompt.ts` as a re-export shim for back-compat** — rejected: prototype stage, no external consumers, internal call sites are all in `turn.ts`. Clean rename is cheaper than carrying a shim.
- **Define `StreamEvent` and `AgentRole` in `packages/shared`** — rejected for S1: web doesn't consume these types until S6, and S6 can promote the types then if needed. Premature promotion couples shared types to server-only concerns.
- **Promote prompts to `packages/shared`** — rejected: prompts are server-side orchestration concerns, not shared contracts.
- **Split S1 into a separate PR per sub-slice** — rejected: single spec, three sub-slices with checkpoint verification between them. Git strategy governs commit cadence.
- **Add a "supervisor" alias into `TURN_DEFAULTS` and deprecate in S5** — rejected: `TURN_DEFAULTS` keeps its role unchanged in S1 (loop bounds for the supervisor tool loop) and is retired when the supervisor path is deleted in S5. No intermediate aliasing.
- **Stream `thinking` events in S1** — rejected: no producer logic in S1, and emitting synthetic thinking events with no real origin would install a misleading signal that would need to be reworked. S1 emits only `final`.
- **Leave `LM_STUDIO_MODEL` as a backward-compat fallback for `supervisor.model`** — rejected: full cutover policy established in the plan. The override env var covers any runtime override need.

## Accepted Risks

- **Placeholder per-role timeouts are uniform at 90s** — accepted: research item R4 refines these per-role after measuring LM Studio latency floors. The uniform placeholder does not gate S1 correctness since S1 only exercises the supervisor entry.
- **`chatStreaming` body throws `NotImplemented`** — accepted: no call site invokes it in S1–S5; the type must land in S1 so S2–S5 can reference `LlmClient` without churn. S6 supplies the real body.
- **`DEFAULT_MODEL_CONFIG` is hardcoded to specific Gemma 4 model IDs** — accepted: override env var exists for deployment-time customization; changes to model IDs post-launch are one-file edits.
- **Non-supervisor prompt files are empty strings** — accepted: reachability is satisfied by re-exporting the builders through the barrel imported by `turn.ts`; content lands in slices S3–S5 as those agents are introduced. Empty-string returns from unused builders cannot affect runtime behavior in S1.

## Build Process

### Git Strategy

**HITL Agentic** — AI commits after every slice that passes gates; pauses at spec boundaries to hand control back to the user for review before the next spec begins.

See `skills/spec-creator/references/git-strategies.md` for the four canonical strategies and their digraphs.

### Verification Commands

Run from repo root (`/Users/colond01/projects/d-prototypes/prd-assist`):

```
pnpm typecheck
pnpm lint
pnpm test
```

All three must succeed with zero failures and zero warnings before a slice is considered complete. `pnpm test` invokes `turbo test` which runs `vitest run` in every workspace that defines it; the server workspace's existing test suite covers `turn.ts`, `routes.ts`, `sessions.ts`, `deriveTitle.ts`, `mcpClient.ts`, `mutex.ts`, and the relocated supervisor prompt test.

### Work Process

This is the canonical implementation workflow for EBT work mode.

---

#### Agent Roles

- **Orchestrator** (main session) — runs the workflow, manages agents, makes judgment calls on gate results and rival feedback.
- **Worker** (`worker`) — persistent across slices. Implements each slice. Carries context for consistency.
- **Code-quality-gate** (`code-quality-gate`) — disposable, single-use. Checks mechanical correctness, strictness, conventions, and integration seam soundness at component boundaries.
- **Spec-check-gate** (`spec-check-gate`) — disposable, single-use. Verifies implementation against spec requirements and checks whether code structure can achieve the Verification Scenarios.
- **System-coherence** (`system-coherence`) — persistent. Walks critical user scenarios across accumulated slices; surfaces broken handoffs, competing ownership, missing scenario steps, and operational surface gaps the walk exercises.
- **Rival** (`rival-work`) — persistent. Reads the spec and watches for broken assumptions. Delivers challenges at decision points.

---

#### Tracking Work

**One todo per slice. Not one todo per gate.** The slice lifecycle below is the work of completing a slice — it is not a checklist to track. Do not create separate todos for "run verification commands," "run code-quality-gate," "run spec-check," "rival checkpoint," "commit." That is ceremony noise that makes a routine slice look like seven items.

If you use a todo tool, the structure is:
- `Slice 1: <name>`
- `Slice 2: <name>`
- `Slice N: <name>`

Mark a slice in_progress when you start it and completed when its commit lands. The gates, rival checkpoints, and verification commands all happen between those two transitions — they are how you complete the slice, not separate trackable steps.

---

#### Slice Lifecycle

The lifecycle below is what happens inside a single slice todo. Run it as continuous work, not as a checklist.

1. **Worker implements the slice** — smallest coherent change. Runs type checks and lint before reporting.
2. **Orchestrator runs verification commands** — commands defined in the Verification Commands section of this spec. Capture output. If failures, send to worker for fixing before any gates run.
3. **Run `code-quality-gate`** — always. Pass the verification output as context. The gate checks code quality and integration seam soundness.
4. **Run `system-coherence` check** — after behavior-changing slices only. Send the worker's slice name, files touched, and System surface field. Route Concern responses: insert a correction slice, trigger spec adaptation, or defer with documented justification ("not in this slice" is not a valid deferral reason). A deferred concern will be re-checked — if re-raised after deferral, escalate to user immediately with no second deferral.
5. **Run `spec-check-gate`** — at milestones only (see Gate Triggering Rules below).
6. **If any gate fails:** read findings in full, send to worker with fix instructions, spawn a fresh gate to re-check. Never reuse a gate.
7. **Apply git strategy** from the Git Strategy section.
8. **Next slice.**

---

#### Gate Triggering Rules

**Code-quality-gate:** always, after every slice.

**System-coherence check:** after every behavior-changing slice. May skip for pure internal refactors confirmed by existing type checks or tests.

**Spec-check-gate:** at milestones only:
- After the first slice (early drift detection)
- After any slice that changes the public interface or observable behavior
- After the final slice (full spec alignment check)
- When the rival raises concerns about drift

---

#### Gate Failure Protocol

1. Read the full gate output — understand every finding.
2. Send findings to the worker with instructions to fix.
3. Spawn a **new** gate agent and re-check. Never reuse the same gate instance.
4. If the same issue persists across two fix attempts, investigate root cause before another attempt.

---

#### Escalation Rules

**Unverified risk escalation:** Track unverified risks across worker slice reports. If the same unverified risk (same category, same reason) appears in 3 or more consecutive slice reports, stop and escalate to the user. Present the risk, explain what verification requires, and offer three choices: (a) arrange the needed environment, (b) accept the risk explicitly, or (c) adapt the verification approach.

**Deferred coherence escalation:** If system-coherence re-raises a previously deferred concern, escalate to the user immediately — no second deferral. Cross-reference incoming concerns against the deferred ledger even if the "Previously deferred" field is absent.

---

#### Rival Checkpoint Timing

Call `rival-work` at:
- After the first slice (is direction matching the spec?)
- When implementation surprises you (something harder or different than expected)
- When scope wants to grow (are we still building what was specced?)
- Before the final gate pass (last chance to surface blind spots)

Rival output is challenges, not decisions. Weigh it, decide, proceed.

---

#### Spec Adaptation Protocol

When the worker, rival, or system-coherence agent surfaces a conflict between the spec and reality:

1. **Surface the conflict** — state what the spec assumed and what reality shows.
2. **Spawn `set-based`** (on-demand) to explore adaptation options. Scope it to the specific conflict.
3. **Challenge with `rival-work`** — share options, get pushback.
4. **Decide** — if one option is clearly better, take it. If the decision requires a user priority judgment (risk tolerance, timeline, preferences), present the tradeoff and deciding factor to the user.
5. **Update the spec** — modify affected sections, add an entry to the Adaptation Log (what changed, why, which slices are affected). The Adaptation Log is not optional.
6. **Continue** — next slice proceeds against the updated spec.

---

#### Completion Criteria

Work mode is complete when:
- All slices are implemented
- A final `spec-check-gate` runs against the full spec and passes
- All verification commands from the Verification Commands section run and pass
- All triggered gates were run (or skipped with explicit reason recorded)

Report completion with: what was built, what was verified, what Verification Scenarios were proven, and what adaptations were made to the spec during implementation.

## Verification Scenarios

### Scenario: Existing turn behavior preserved end-to-end

- **Given**: A running server bootstrapped from `apps/server/src/index.ts` with no `LM_STUDIO_MODELS_OVERRIDE` set, a SQLite DB containing one session with an empty PRD, and an LM Studio instance reachable at `LM_STUDIO_BASE_URL` serving `google/gemma-4-26b-a4b`.
- **When**: The client issues `POST /api/sessions/:id/messages` with body `{"text": "hello"}` identical to a pre-S1 request.
- **Then**: The HTTP response is `200` with JSON body `{"reply": "<string>"}` where `<string>` is non-empty. The session's `messages_json` row contains one user message with text `"hello"` followed by one assistant message with content equal to the reply. No DB schema changes occurred. `prd_json` is unchanged from the pre-request state.
- **Runnable target**: composed product via `pnpm dev` plus `curl http://127.0.0.1:5174/api/sessions/<id>/messages -X POST -H 'content-type: application/json' -d '{"text":"hello"}'`.

### Scenario: Env override merges partially into default config

- **Given**: The server is bootstrapped with `LM_STUDIO_MODELS_OVERRIDE='{"orchestrator":{"model":"google/gemma-4-e2b"}}'`.
- **When**: The server starts successfully and processes one request as in the prior scenario.
- **Then**: Server startup logs no errors. The supervisor call still uses `google/gemma-4-26b-a4b` (unchanged from default) — verifiable by inspecting the `model` argument in the `llm.chat` call (via test harness instrumentation). The orchestrator default is now `google/gemma-4-e2b` — verifiable by inspecting the merged `ModelConfig` at startup via a temporary log or direct test.
- **Runnable target**: isolated package via a new focused test in `apps/server/src/config.test.ts` that calls the merge helper directly with a sample override and asserts the resulting map.

### Scenario: Invalid override JSON aborts startup

- **Given**: The server is started with `LM_STUDIO_MODELS_OVERRIDE='not-json'`.
- **When**: The server process launches.
- **Then**: The process writes a line containing `"invalid LM_STUDIO_MODELS_OVERRIDE JSON"` to stderr and exits with code `1` within 2 seconds. No HTTP port is opened.
- **Runnable target**: composed product via `LM_STUDIO_MODELS_OVERRIDE='not-json' pnpm --filter @prd-assist/server dev` and inspecting exit code + stderr. A focused test in `apps/server/src/config.test.ts` covers the validation helper directly.

### Scenario: Invalid override shape aborts startup

- **Given**: The server is started with `LM_STUDIO_MODELS_OVERRIDE='{"orchestrator":{"model":""}}'` (empty model string).
- **When**: The server process launches.
- **Then**: The process writes a line containing `"invalid LM_STUDIO_MODELS_OVERRIDE shape"` to stderr and exits with code `1`. No HTTP port is opened.
- **Runnable target**: isolated package — focused test in `apps/server/src/config.test.ts` exercising the Zod validator directly.

### Scenario: `BufferedSink` captures final event and returns via `getFinal`

- **Given**: A fresh `BufferedSink` from `createBufferedSink()`.
- **When**: Two events are emitted in order: `{ kind: "thinking", agentRole: "supervisor", content: "tick", at: "2026-04-21T00:00:00Z" }`, then `{ kind: "final", content: "done", at: "2026-04-21T00:00:01Z" }`.
- **Then**: `buffered.events` contains both events in that order. `buffered.getFinal()` returns `"done"`.
- **Runnable target**: isolated package via `pnpm --filter @prd-assist/server test apps/server/src/stream.test.ts`.

### Scenario: Supervisor prompt text is byte-identical after rename

- **Given**: The pre-S1 `buildSystemPrompt()` output.
- **When**: The post-S1 `buildSupervisorPrompt()` runs.
- **Then**: The returned string matches the pre-S1 output exactly, including whitespace and newlines. Verifiable by the existing `prompts/supervisor.test.ts` continuing to pass unchanged (assertions unchanged in content; only the import path updates).
- **Runnable target**: isolated package via `pnpm --filter @prd-assist/server test apps/server/src/prompts/supervisor.test.ts`.

### Scenario: `chatStreaming` throws `NotImplemented` when invoked

- **Given**: The OpenAI-backed `LlmClient` constructed via `createOpenAiLlmClient`.
- **When**: A caller invokes `.chatStreaming(...)` and attempts to iterate the returned `AsyncIterable`.
- **Then**: The iteration throws a `NotImplementedError` with message `"chatStreaming not implemented"`. No network call is made to LM Studio.
- **Runnable target**: isolated package — focused test in `apps/server/src/llm.test.ts` (new minimal test file) that constructs the client and asserts the throw.

## Adaptation Log

- **2026-04-21 — Slice 1c — R9 `chatStreaming` body simplified.** The spec prescribed `async function* chatStreaming() { throw new NotImplementedError("chatStreaming"); yield undefined as never; }`. The `yield` line triggered TS7027 (unreachable code). Dropped the `yield`; `AsyncGenerator<T>` is natively assignable to `AsyncIterable<T>` without an explicit yield, so C3 is still satisfied. Added `// eslint-disable-next-line @typescript-eslint/require-await` above the function to silence `require-await` (no await is reachable before the throw). Runtime behavior unchanged — throws `NotImplementedError` before any network call. Affected: R9 prescribed code block only; no other slice is affected.

## Followups

Items accepted into S1 but flagged for removal before S1's work is considered finished by the user.

- **`// eslint-disable-next-line @typescript-eslint/require-await` in `apps/server/src/llm.ts:60`** — remove when S6 implements the real `chatStreaming` body (it will contain `await` and satisfy the rule naturally).
- **Two tests in `apps/server/src/llm.test.ts` for the spec's "one focused test" R9 requirement** — consolidate to a single test before S6 lands. Options: write a custom matcher asserting both instance type and exact message, or delete one of the two tests (the error-message assertion implies the throw; the instance-type assertion is more informative).

## Implementation Slices

Three slices. Each slice leaves `pnpm typecheck && pnpm lint && pnpm test` green.

```digraph
slice_1a_prompts -> slice_1b_config -> slice_1c_stream_and_llm
```

### Slice 1a: Extract prompts/ directory and rename supervisor prompt

- What: Create `apps/server/src/prompts/` with seven files per R6. Move `buildSystemPrompt` body into `prompts/supervisor.ts` as `buildSupervisorPrompt`. Delete `apps/server/src/prompt.ts`. Move `apps/server/src/prompt.test.ts` to `apps/server/src/prompts/supervisor.test.ts` and update its import/symbol. Create `apps/server/src/prompts/index.ts` re-exporting all seven builders. Update `apps/server/src/turn.ts:6` import to use the barrel.
- Verify: `pnpm typecheck && pnpm lint && pnpm test` succeeds. The relocated supervisor test runs and passes. `rg "from \"./prompt\"" apps/server/src` returns no matches. `rg "buildSystemPrompt" apps/server/src` returns no matches.
- Outcome: foundational — prompt module structure exists for S3–S5 to land role-specific prompts into without churn.

### Slice 1b: `AgentRole`, `ModelConfig`, env override, and bootstrap rewire

- What: Add `AgentRole`, `AgentRoleSchema`, `ModelRoleConfig`, `ModelConfig`, `DEFAULT_MODEL_CONFIG` to `apps/server/src/config.ts` per R1–R3. Implement `buildModelConfigFromEnv(overrideJson: string | undefined): ModelConfig` in `config.ts` per R4. Add a focused test file `apps/server/src/config.test.ts` covering the merge behavior and both failure modes (invalid JSON, invalid shape). Reshape `ServerOptions`, `RouteDeps`, `TurnConfig`, `TurnDeps.config` per R5. Update `apps/server/src/index.ts` per R10: remove `LM_STUDIO_MODEL`, read and validate `LM_STUDIO_MODELS_OVERRIDE`, pass `models` into `startServer`. Update `turbo.json` env pass-through list. Update every test file that constructs `TurnDeps`/`ServerOptions`/`RouteDeps` inline to pass a `ModelConfig` in place of `model: string` — no test body logic changes beyond that field swap.
- Verify: `pnpm typecheck && pnpm lint && pnpm test` succeeds. `rg "model: string" apps/server/src` returns no matches in production files (only in test fixtures as `{ model: string }` property inside assertions against OpenAI call shapes, which remain). `rg "LM_STUDIO_MODEL[^S]" apps/server/src` returns no matches (only `LM_STUDIO_MODELS_OVERRIDE` remains).
- Outcome: foundational — per-role model selection is available throughout the server; consumer slices read from `config.models.<role>`.

### Slice 1c: `stream.ts`, `handleTurn` rewiring to `BufferedSink`, and `chatStreaming` interface

- What: Add `apps/server/src/stream.ts` with `StreamEvent`, `StreamSink`, `BufferedSink`, and `createBufferedSink` per R7. Add `apps/server/src/stream.test.ts` per R7/Testing Approach. Extend `LlmClient` interface and `createOpenAiLlmClient` with `chatStreaming` and `NotImplementedError` per R9. Add `apps/server/src/llm.test.ts` covering the throw. Rewire `handleTurn` to construct a `BufferedSink`, pass its `sink` into `runToolCallLoop`, have `runToolCallLoop` emit one `kind: "final"` event at every termination path, and derive the return string via `buffered.getFinal()` per R8.
- Verify: `pnpm typecheck && pnpm lint && pnpm test` succeeds. Existing `apps/server/src/turn.test.ts` and `apps/server/src/routes.test.ts` pass without modification of their assertions (only fixture construction if `ModelConfig` shape is referenced — already handled in 1b). `apps/server/src/stream.test.ts` and `apps/server/src/llm.test.ts` pass.
- Outcome: foundational — stream plumbing and streaming LlmClient seam are live and reachable from `handleTurn`; S6 replaces the sink implementation with an SSE writer without further churn to `turn.ts`.

## Acceptance Criteria

- `rg "export type AgentRole" apps/server/src/config.ts` returns exactly one match; the type union has exactly the seven members listed in R1.
- `rg "export (const|type) ModelConfig" apps/server/src/config.ts` returns at least one match; `DEFAULT_MODEL_CONFIG` contains exactly seven entries, one per `AgentRole`, matching the table in R3.
- `test -f apps/server/src/prompts/supervisor.ts && test -f apps/server/src/prompts/orchestrator.ts && test -f apps/server/src/prompts/interviewerBig.ts && test -f apps/server/src/prompts/interviewerSmall.ts && test -f apps/server/src/prompts/plannerBig.ts && test -f apps/server/src/prompts/worker.ts && test -f apps/server/src/prompts/summary.ts && test -f apps/server/src/prompts/index.ts` returns zero exit code.
- `test ! -f apps/server/src/prompt.ts` returns zero exit code.
- `test -f apps/server/src/prompts/supervisor.test.ts && test ! -f apps/server/src/prompt.test.ts` returns zero exit code.
- `rg "buildSystemPrompt" apps/server` returns no matches.
- `rg "from \"./prompt\"" apps/server/src` returns no matches.
- `test -f apps/server/src/stream.ts && test -f apps/server/src/stream.test.ts` returns zero exit code.
- `rg "export (type StreamEvent|type StreamSink|function createBufferedSink)" apps/server/src/stream.ts` returns three matches.
- `rg "chatStreaming" apps/server/src/llm.ts` returns at least two matches (interface declaration + implementation).
- `rg "LM_STUDIO_MODEL[^S]" apps/server/src` returns no matches.
- `rg "LM_STUDIO_MODELS_OVERRIDE" apps/server/src turbo.json` returns matches in both locations.
- `rg "wallClockMs" apps/server/src/turn.ts` returns matches (retained for S1 supervisor path; removed in S5).
- From the repo root, `pnpm typecheck` exits 0 with no errors.
- From the repo root, `pnpm lint` exits 0 with zero warnings.
- From the repo root, `pnpm test` exits 0 with all suites passing.
- A running server started with no `LM_STUDIO_MODELS_OVERRIDE` env var handles `POST /api/sessions/:id/messages` identically to pre-S1 — same reply shape, same DB mutation pattern.
