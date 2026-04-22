# Multi-Agent Turn Pipeline — S3 Orchestrator and Routing

## Project Status
feature

## Parent Reference
- Kind: plan
- Plan: `../plans/2026-04-21-multi-agent-turn-pipeline.plan.md`
- Slice: S3 — Orchestrator and routing
- Boundary: `apps/server/src/orchestrator.ts` (new small-model classifier), `apps/server/src/prompts/orchestrator.ts` (fill in stub from S1), `apps/server/src/turn.ts` (routing stage before `runToolCallLoop` + branch-decision logging), plus tests for all three.
- Inherited constraints:
  - **C1** (consumer): `config.models.orchestrator` selects the orchestrator model (`google/gemma-4-e4b`, `perCallTimeoutMs: 90_000`, `maxIterations: 1` per S1's `DEFAULT_MODEL_CONFIG`).
  - **C2** (consumer): orchestrator emits one `{ kind: "thinking", agentRole: "orchestrator", content: ..., at: ... }` event per turn via the `StreamSink` constructed in `handleTurn`.
  - **C4** (consumer): orchestrator input prefers `summary` from `SessionWithSummary.summary`; when null (no prior PRD-touching turn), it falls back to `JSON.stringify(prd, null, 2)`.
  - **C5** (owner): this spec pins the orchestrator's output schema — `{ needsPrdWork: boolean }` validated by Zod. On Zod parse failure, one retry with a JSON-only reminder user message; second failure falls closed to `{ needsPrdWork: false }` and logs via `console.error` with prefix `"orchestrator classification fail-closed: "`.
  - Runnability: every turn leaves the product running end-to-end. The orchestrator stage runs once per turn before `runToolCallLoop`. Both branches still dispatch to the existing supervisor tool loop — behavior is externally unchanged; only the routing decision is observable via console logs, the stream sink buffer, and the turn-summary log line.
  - No global turn wall-clock; per-call timeouts only. Orchestrator adds one small-model call to every turn (~1–3 seconds typical on local Gemma 4 e4b); it runs inside the existing session-mutex scope.

## Intent

Insert a classification stage at the start of every turn that decides whether the turn requires PRD editing. The classifier reads recent conversation plus the persisted PRD summary from S2 (or the full PRD JSON when no summary exists yet) and emits a JSON object `{ needsPrdWork: boolean }`. The decision is captured in a mutable branch variable, logged as a `thinking` stream event, and folded into the turn's summary log line. Both branches still dispatch to the existing supervisor tool loop — S4 and S5 will make the branches diverge.

## Scope

### In Scope
- New file `apps/server/src/orchestrator.ts` exporting `classifyTurn(opts): Promise<{ needsPrdWork: boolean }>`. Single small-model call, Zod-validated output, one retry on parse failure, fail-closed default on second failure.
- Fill `apps/server/src/prompts/orchestrator.ts` — replace the empty-string stub from S1 with the classifier prompt defined in R3 below.
- `apps/server/src/turn.ts` — call `classifyTurn` after user-message persist and before `runToolCallLoop`. Emit a `thinking` stream event with the classification result. Add a `routed` field to the turn log line. Both branches continue to dispatch to `runToolCallLoop`.
- New test file `apps/server/src/orchestrator.test.ts` covering: happy-path classification with summary, null-summary fallback to raw PRD, parse-failure retry succeeds, parse-failure twice falls closed, `llm.chat` throw falls closed, `recent` message slicing.
- Additions to `apps/server/src/turn-summary.test.ts` (or a new `apps/server/src/turn-orchestrator.test.ts`) covering: `handleTurn` emits exactly one `thinking` event with `agentRole: "orchestrator"` per turn, routing decision appears in the turn log line.

### Out of Scope
- Interviewer-Big agent and any real behavior divergence on the no-work branch (S4).
- Planner-Big agent, workers, Interviewer-Small, and any real behavior divergence on the work branch (S5).
- Streaming transport — thinking events are buffered + `console.warn`ed by the S1 `BufferedSink` and do not affect the HTTP response.
- Any addition of JSON output-format parameters to `llm.chat` (e.g., `response_format: { type: "json_object" }`) — rely on Gemma 4's native structured output, plain prompting, and the Zod boundary.
- Adaptive thresholding, confidence scores, or multi-flag orchestrator output — the contract is exactly `{ needsPrdWork: boolean }`.
- Session-level caching of the classification across turns.

## Implementation Constraints

### Architecture

Dependencies flow inward. The orchestrator is an app-layer agent that calls out through the existing `LlmClient` boundary and reads its input from `SessionWithSummary`. Core turn logic (`handleTurn`) orchestrates; the orchestrator owns its prompt, input construction, and failure handling.

- `apps/server/src/orchestrator.ts` — owns `classifyTurn`, the user-message builder, and the Zod schema. Imports `LlmClient` from `./llm`, `ModelConfig` from `./config`, `buildOrchestratorPrompt` from `./prompts`. Does not import from `sessions.ts`, `turn.ts`, `stream.ts`, `routes/*`, or `summaryAgent.ts`. Takes PRD + summary + recent messages as arguments; does not fetch them.
- `apps/server/src/prompts/orchestrator.ts` — leaf module, exports `buildOrchestratorPrompt(): string`.
- `apps/server/src/turn.ts` — calls `classifyTurn` and passes the result forward. Owns the routing decision variable and the thinking-event emission.

The session mutex at `apps/server/src/turn.ts` continues to scope the entire turn. The orchestrator call runs inside the same `try` block as `runToolCallLoop` and `maybePersistSummary`.

### Boundaries

External inputs this slice handles:

- **Orchestrator LLM response** — untrusted. `classifyTurn` validates the response content with a Zod schema. Invalid JSON, invalid shape, or missing `needsPrdWork` boolean all trigger a single retry with an explicit JSON-only reminder message appended to the conversation. If the retry also fails validation, `classifyTurn` returns `{ needsPrdWork: false }` and logs `"orchestrator classification fail-closed: <reason>"` via `console.error`.
- **`llm.chat` thrown error** — treated identically to parse failure: log and fail closed to `{ needsPrdWork: false }`. Does not bubble up.
- **Null summary** — `SessionWithSummary.summary === null` for turns where no prior PRD-editing turn has completed. `classifyTurn` substitutes `JSON.stringify(prd, null, 2)` for the summary in the user message. No Zod validation of the PRD is done by the orchestrator — the PRD shape is already validated by `sessionGet`.

Validation rules:
- Orchestrator output Zod schema: `z.object({ needsPrdWork: z.boolean() }).strict()`. Extra keys fail parsing; missing keys fail parsing; non-boolean value fails parsing.
- The retry uses the same `llm.chat` args except the `messages` array is extended with two additional messages: the assistant's previous (invalid) reply and a user-role message with content `"Your previous reply was not valid JSON matching the schema { \"needsPrdWork\": boolean }. Reply with only the JSON object and nothing else."`.

### Testing Approach

- Type system + existing tests are primary verification for structural correctness. All pre-S3 tests pass unchanged (`turn.test.ts`, `turn-limits.test.ts`, `turn-toolcalls.test.ts`, `turn-summary.test.ts`, `routes.test.ts`, `sessions.test.ts`, `db.test.ts`, `summaryAgent.test.ts`, `stream.test.ts`, `llm.test.ts`, `config.test.ts`, `prompts/supervisor.test.ts`).
- **`classifyTurn` happy path** in `apps/server/src/orchestrator.test.ts` (new): mock `LlmClient.chat` to return `{ role: "assistant", content: '{"needsPrdWork": true}' }`. Call `classifyTurn` with a PRD, non-null summary, and two recent messages. Assert returns `{ needsPrdWork: true }`. Assert `llm.chat` was called exactly once with `model === "google/gemma-4-e4b"`, `messages[0].content === buildOrchestratorPrompt()`, and the user message body contains both the summary text and `"[user]"` / `"[assistant]"` role labels.
- **Null-summary fallback**: mock `chat` to return `{"needsPrdWork": false}`. Call `classifyTurn` with `summary: null`. Assert the user message body contains `"Current PRD:"` followed by a JSON-looking block (substring match on PRD section keys like `"vision"` or `"status"`). Does NOT contain `"PRD summary:"`.
- **Parse-failure retry succeeds**: mock `chat` to return a non-JSON string on first call, valid JSON on second. Assert `classifyTurn` returns the value from the second call. Assert `chat` was called twice. Assert the second call's `messages` array has exactly two more entries than the first (the assistant's invalid reply and a user-role reminder).
- **Parse-failure twice falls closed**: mock `chat` to return non-JSON on both calls. Assert returns `{ needsPrdWork: false }`. Assert `console.error` was called with a string starting `"orchestrator classification fail-closed:"`.
- **Invalid-shape falls closed after retry**: mock `chat` to return `{"somethingElse": true}` twice. Assert returns `{ needsPrdWork: false }` and logs.
- **`llm.chat` throws falls closed**: mock `chat` to throw `new Error("boom")`. Assert returns `{ needsPrdWork: false }` and logs a string starting `"orchestrator classification fail-closed:"` containing `"boom"`.
- **Recent-messages slicing**: pass in five messages; assert the user message body contains the last three and does NOT contain the first two. The spec pins `recent = messages.slice(-3)`.
- **`handleTurn` emits a thinking event + routes both branches through the supervisor loop** in `apps/server/src/turn-orchestrator.test.ts` (new): construct a turn. Spy on `console.warn` for the stream-sink console-emit from `createBufferedSink`. Assert at least one line starting `"stream [orchestrator] thinking: classified: needsPrdWork="` appears before the `"stream [final] final:"` line.
- **`handleTurn` log line includes `routed=`**: assert `console.warn` was called with a line matching `/turn [0-9a-f]{8} termination=\w+ routed=(work|no_work) elapsed_ms=\d+/`.
- **`handleTurn` does not change reply behavior**: existing `turn.test.ts` happy-path continues to pass without modification. Routing stage is invisible to the reply.

Do not add tests that restate type-system guarantees. Do not test that `z.object({ needsPrdWork: z.boolean() }).strict()` rejects extra keys — that's Zod's contract.

### Naming

- **`classifyTurn(opts: { llm, models, prd, summary, recentMessages }): Promise<{ needsPrdWork: boolean }>`** — top-level export of `orchestrator.ts`. Never throws; failures fall closed.
- **`buildOrchestratorPrompt(): string`** — prompt builder, leaf module. Returns the system-prompt text.
- **`OrchestratorOutputSchema`** — Zod schema `z.object({ needsPrdWork: z.boolean() }).strict()`. Not exported unless a consumer needs it. Declared local to `orchestrator.ts`.
- **`needsPrdWork`** — the single boolean flag. Domain language: `true` means the user's most recent turn should trigger PRD writes (update sections, mark confirmed). `false` means the turn is conversation / interviewing / non-editing.
- **`routed`** — the log-line key used in `handleTurn`'s turn-summary log. Value is the literal string `"work"` or `"no_work"`.
- **`RouteDecision`** — local type alias `type RouteDecision = "work" | "no_work"` in `turn.ts`. Small, internal.

## Requirements

### R1. `buildOrchestratorPrompt`

`apps/server/src/prompts/orchestrator.ts` replaces its empty-string stub with:

```ts
export function buildOrchestratorPrompt(): string {
  return [
    "You are the orchestrator in a PRD-building session. You do not speak to the user. Your single job is to classify whether the user's most recent turn requires PRD writes (updating a section or marking a section confirmed) versus conversation / interviewing that does not yet change the PRD.",
    "",
    "You will receive the current PRD summary (or the full PRD JSON if no summary exists yet) and the last three messages of the conversation.",
    "",
    "Respond with a single JSON object matching exactly this schema:",
    "{ \"needsPrdWork\": boolean }",
    "",
    "Set `needsPrdWork` to `true` when the user's latest message supplies new or revised content for a PRD section, or explicitly asks to confirm a section. Set it to `false` when the user is asking questions, clarifying, planning, or providing input that has not yet crystallized into a section update.",
    "",
    "Do not include explanation, preamble, markdown, or any other content outside the JSON object. Your entire reply must be valid JSON that parses into the schema above.",
  ].join("\n");
}
```

### R2. `OrchestratorOutputSchema`

Declared in `apps/server/src/orchestrator.ts`:

```ts
const OrchestratorOutputSchema = z.object({ needsPrdWork: z.boolean() }).strict();
```

Not exported. Used internally by `classifyTurn`.

### R3. `classifyTurn`

`apps/server/src/orchestrator.ts`:

```ts
import type { LlmClient } from "./llm";
import type { ModelConfig } from "./config";
import type { PRD, ChatMessage } from "@prd-assist/shared";
import { buildOrchestratorPrompt } from "./prompts";
import { z } from "zod";

export async function classifyTurn(opts: {
  llm: LlmClient;
  models: ModelConfig;
  prd: PRD;
  summary: string | null;
  recentMessages: ChatMessage[];
}): Promise<{ needsPrdWork: boolean }> { /* impl */ }
```

Behavior:

1. Build the system message from `buildOrchestratorPrompt()`.
2. Build the user message content:
   - Header: `"PRD summary:\n"` + `summary` when `summary !== null`, else `"Current PRD:\n" + JSON.stringify(prd, null, 2)`.
   - Separator: `"\n\nRecent conversation:\n"`.
   - Each of the last three messages (slice `-3`): `` `[${m.role}] ${m.content}` `` joined by `"\n"`. If fewer than three messages exist, include all of them (no padding).
3. First call: `llm.chat({ model: models.orchestrator.model, messages: [system, user], signal: AbortSignal.timeout(models.orchestrator.perCallTimeoutMs) })`. No `tools` passed.
4. Parse the reply's `content` (nullable — if null, treat as empty string). Attempt `JSON.parse`; on SyntaxError, proceed to retry. On success, validate with `OrchestratorOutputSchema.safeParse`; on validation failure, proceed to retry.
5. Retry: append two messages to the existing `messages` array — an `{ role: "assistant", content: <the prior invalid content or null-as-empty-string> }` and a `{ role: "user", content: "Your previous reply was not valid JSON matching the schema { \\"needsPrdWork\\": boolean }. Reply with only the JSON object and nothing else." }`. Call `llm.chat` again with the extended messages. Parse + validate again. If that also fails, log `console.error("orchestrator classification fail-closed: " + <reason>)` and return `{ needsPrdWork: false }`.
6. If either `llm.chat` call throws (timeout, network, etc.), catch the error and fail closed: log the error with the fail-closed prefix, return `{ needsPrdWork: false }`. Do not re-throw.

The function never throws. Its Promise resolves with a valid `{ needsPrdWork: boolean }` in every code path.

### R4. `handleTurn` orchestrator stage and routing

In `apps/server/src/turn.ts`, inside the `try` block of `handleTurn`, after `store.persistUserMessage(session)`, keep the existing `const buffered = createBufferedSink();` line. Insert the orchestrator stage immediately after `buffered` is constructed and before `runToolCallLoop` is called — the sink has to exist before a thinking event can be emitted into it:

```ts
const buffered = createBufferedSink();

const classification = await classifyTurn({
  llm,
  models: config.models,
  prd: session.prd,
  summary: session.summary,
  recentMessages: session.messages.slice(-3),
});

buffered.sink({
  kind: "thinking",
  agentRole: "orchestrator",
  content: `classified: needsPrdWork=${String(classification.needsPrdWork)}`,
  at: now().toISOString(),
});

const routed: RouteDecision = classification.needsPrdWork ? "work" : "no_work";
```

The variable `routed` is captured and used below in the final log line. The orchestrator stage runs BEFORE `runToolCallLoop`. Both branches continue to call `runToolCallLoop` — no branch divergence in S3.

The final log line changes from:

```ts
console.warn(
  `turn ${sessionId.slice(0, 8)} termination=${termination} elapsed_ms=${now().getTime() - wallStart}`,
);
```

to:

```ts
console.warn(
  `turn ${sessionId.slice(0, 8)} termination=${termination} routed=${routed} elapsed_ms=${now().getTime() - wallStart}`,
);
```

`RouteDecision` is declared as a local type alias near the top of `turn.ts`:

```ts
type RouteDecision = "work" | "no_work";
```

### R5. `session.summary` must be available on the loaded session

The existing `store.getSession(sessionId)` at the top of `handleTurn` already returns `SessionWithSummary | null` per S2's C4. No change needed — `session.summary` is already on the object. This requirement is a reminder to the implementer not to re-fetch or re-derive summary in the orchestrator stage.

### R6. Test fixture additions

`apps/server/src/turn.test.helpers.ts` — no shape changes required. `makeStore`'s `getSession` already returns `SessionWithSummary` with `summary: null` by default. The existing `llm: LlmClient` fixture from `makeLlmClient` will be called by the orchestrator stage as well as the supervisor loop. Test-by-test, mocks that construct `LlmClient` inline (as seen in `turn.test.ts`, `turn-limits.test.ts`, `turn-toolcalls.test.ts`, `turn-summary.test.ts`) must account for the extra orchestrator call — the simplest pattern is `chat`-as-counter with a leading reply of `'{"needsPrdWork": false}'` or `'{"needsPrdWork": true}'` depending on the desired branch. A new helper `stubOrchestratorReply(needsPrdWork: boolean): AssistantMessage` added to `turn.test.helpers.ts` standardizes this and exports it for reuse.

Existing tests that use `makeLlmClient("some reply")` — which returns the same reply on every call — will need updating: the first `llm.chat` call is now the orchestrator, not the supervisor. Either (a) switch those tests to a counter-based LLM that returns an orchestrator reply first, or (b) change `makeLlmClient` to accept an orchestrator reply option. Choose (a): inline counter-based `LlmClient` in tests that need the distinction. `makeLlmClient` stays as-is for simple cases where the orchestrator reply is irrelevant to the assertion (existing tests that don't assert on the first `llm.chat` call may be amended to use the counter pattern directly rather than `makeLlmClient`).

The test fixtures touched by this slice must not break any existing test's assertion logic. If the assertion references the supervisor call argument, the test must be updated to account for the orchestrator being call 1 and the supervisor being call 2.

## Dependencies

No new npm packages. Uses existing `zod`, `better-sqlite3`, `vitest`, and internal modules.

## Impacted Modules

- `apps/server/src/orchestrator.ts` — new.
- `apps/server/src/orchestrator.test.ts` — new.
- `apps/server/src/prompts/orchestrator.ts` — replace stub body with real prompt.
- `apps/server/src/turn.ts` — import `classifyTurn`, add orchestrator stage, add `routed` variable and log-line update, add `RouteDecision` type.
- `apps/server/src/turn.test.helpers.ts` — add `stubOrchestratorReply` helper.
- `apps/server/src/turn.test.ts`, `turn-limits.test.ts`, `turn-toolcalls.test.ts`, `turn-summary.test.ts` — update inline `LlmClient` mocks to return an orchestrator reply before the supervisor reply(s). Assertion logic unchanged.
- `apps/server/src/turn-orchestrator.test.ts` — new.

## Rejected Alternatives

- **Emit the `thinking` event directly from `classifyTurn`** — rejected. `orchestrator.ts` should not depend on `stream.ts`; its callers own the sink. Keeping the orchestrator sink-free preserves its testability (no fake sink needed) and lets the caller choose when and how to surface the decision.
- **Use `response_format: { type: "json_object" }` on the OpenAI-compatible call** — rejected. LM Studio supports it on some backends but Gemma 4 native JSON + explicit prompting is simpler and already works end-to-end per the S2 validation run. Adding a backend-specific parameter tightens coupling to LM Studio's runtime and breaks on providers that don't accept it.
- **Retry loop with exponential backoff** — rejected. Exactly one retry, per the user's "no elaborate retry scaffolding" direction. A malformed reply once is a prompt signal; twice is model failure; backoff would only mask latency.
- **Make the classification richer (`{ needsPrdWork, confidence, reason }`)** — rejected for S3. Contract C5 is exactly `{ needsPrdWork: boolean }`. Future slices can extend the schema; S3 does not.
- **Cache classification per turn** — rejected. Every turn runs classification once by design; there is no repeated call within a turn to cache.
- **Push the orchestrator result into the legacy supervisor's system prompt as context** — rejected. S3 does not change branch behavior. Feeding the supervisor its own routing signal would add noise without payoff. S4 and S5 route to different agents that need their own context construction.
- **Promote `needsPrdWork` type to `packages/shared`** — rejected. The classification type is server-internal for S3–S5. The web client never sees it.

## Accepted Risks

- **Turn latency increases by one small-model call on every turn.** Accepted: Gemma 4 e4b typically returns classification output in 1–3 seconds on local GPU. Orchestrator runs even on trivial conversation turns, adding overhead. The user has accepted this latency in plan-mode as the cost of routing correctness.
- **Fail-closed bias toward Interviewer-Big branch.** Accepted: when classification fails (parse failure, LLM throw), the turn routes to `no_work`, which in S4 onward will be the read-only Interviewer-Big branch. A genuine PRD-edit request could be misrouted to interviewing on classification failure. The user accepted this in plan-mode: the Interviewer-Big branch cannot corrupt the PRD, so fail-closed is the safe default.
- **Gemma 4 e4b classification quality.** Accepted: small models are less reliable classifiers than big models. The user chose to put classification on the small model for latency reasons and accepts that misclassifications will occur. No scoring or adaptive threshold in S3; calibration is deferred.
- **Orchestrator output loose-coupled to supervisor behavior in S3.** Accepted: S3 logs and routes but both branches still run the legacy supervisor. Misclassification in S3 has no visible user effect. The real cost of misclassification lands in S4 and S5 when branches diverge.

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

All three must exit 0 with zero failures and zero warnings.

A manual end-to-end verification against a live LM Studio (with `google/gemma-4-26b-a4b` and `google/gemma-4-e4b` loaded) is also a completion criterion — see Acceptance Criteria and Verification Scenarios below.

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

### Scenario: Classifier returns `needsPrdWork: true` on a PRD-editing request

- **Given**: A session with an empty PRD and a non-null summary. User message: "Set the vision section to: a tool that helps engineers draft PRDs with AI." `llm.chat` (orchestrator call) returns `{"needsPrdWork": true}`.
- **When**: `classifyTurn` runs.
- **Then**: Returns `{ needsPrdWork: true }`. `llm.chat` was called once with `model === "google/gemma-4-e4b"` and a `messages[0]` whose content equals `buildOrchestratorPrompt()`.
- **Runnable target**: isolated package via `apps/server/src/orchestrator.test.ts`.

### Scenario: Classifier returns `needsPrdWork: false` on a conversation turn

- **Given**: A session with a drafted PRD and a non-null summary. User message: "What sections are in a typical PRD?". `llm.chat` returns `{"needsPrdWork": false}`.
- **When**: `classifyTurn` runs.
- **Then**: Returns `{ needsPrdWork: false }`.
- **Runnable target**: isolated package via `apps/server/src/orchestrator.test.ts`.

### Scenario: Null summary falls back to raw PRD in the user message

- **Given**: A session whose `summary` is null (no prior PRD-editing turn). `llm.chat` returns `{"needsPrdWork": false}`.
- **When**: `classifyTurn` runs with the full PRD and `summary: null`.
- **Then**: The user message passed to `llm.chat` contains `"Current PRD:"` and a stringified JSON containing section keys (e.g., `"vision"`, `"problem"`, `"status"`). It does NOT contain `"PRD summary:"`.
- **Runnable target**: isolated package via `apps/server/src/orchestrator.test.ts`.

### Scenario: Invalid JSON on first call, valid on retry

- **Given**: `llm.chat` is a counter-based mock: call 1 returns `{ role: "assistant", content: "sure here is the answer" }` (not JSON); call 2 returns `{ role: "assistant", content: '{"needsPrdWork": true}' }`.
- **When**: `classifyTurn` runs.
- **Then**: Returns `{ needsPrdWork: true }`. `llm.chat` was called exactly twice. The second call's `messages` array has two more entries than the first — the last two are `{ role: "assistant", content: "sure here is the answer" }` and a `{ role: "user" }` message containing the substring `"Reply with only the JSON object"`.
- **Runnable target**: isolated package via `apps/server/src/orchestrator.test.ts`.

### Scenario: Invalid JSON on both calls falls closed

- **Given**: `llm.chat` returns non-JSON content on both calls.
- **When**: `classifyTurn` runs.
- **Then**: Returns `{ needsPrdWork: false }`. `console.error` was called at least once with a first argument starting `"orchestrator classification fail-closed:"`.
- **Runnable target**: isolated package via `apps/server/src/orchestrator.test.ts`.

### Scenario: Shape-valid JSON with wrong keys falls closed

- **Given**: `llm.chat` returns `{"something": true}` on both calls — parses as JSON but fails Zod schema.
- **When**: `classifyTurn` runs.
- **Then**: Returns `{ needsPrdWork: false }` and logs the fail-closed message.
- **Runnable target**: isolated package via `apps/server/src/orchestrator.test.ts`.

### Scenario: `llm.chat` throws falls closed without crashing the turn

- **Given**: `llm.chat` throws `new Error("model unavailable")`.
- **When**: `classifyTurn` runs.
- **Then**: Returns `{ needsPrdWork: false }`. `console.error` was called with a message starting `"orchestrator classification fail-closed:"` containing the substring `"model unavailable"`.
- **Runnable target**: isolated package via `apps/server/src/orchestrator.test.ts`.

### Scenario: `handleTurn` emits exactly one orchestrator `thinking` event per turn

- **Given**: A session. `handleTurn` processes a user message; orchestrator returns `{"needsPrdWork": false}`; supervisor replies with plain content (no tool calls).
- **When**: The turn completes.
- **Then**: `console.warn` was called at some point with a string matching `/^stream \[orchestrator\] thinking: classified: needsPrdWork=(true|false)$/` (the `BufferedSink`'s `console.warn` format from S1). Exactly one such line per turn.
- **Runnable target**: composed product via `apps/server/src/turn-orchestrator.test.ts`.

### Scenario: `handleTurn` final log line includes `routed=`

- **Given**: Any successful turn.
- **When**: The turn completes.
- **Then**: `console.warn` was called with a string matching the regex `/^turn [0-9a-f]{8} termination=\w+ routed=(work|no_work) elapsed_ms=\d+$/`.
- **Runnable target**: composed product via `apps/server/src/turn-orchestrator.test.ts`.

### Scenario: Manual turn against live LM Studio — classifier runs and routes

- **Given**: LM Studio running with `google/gemma-4-26b-a4b` and `google/gemma-4-e4b` loaded. Server started on a temp SQLite path with default config (no override). A new session created via `POST /api/sessions`.
- **When**: A message is sent via `POST /api/sessions/:id/messages` with body text that is clearly a PRD edit (e.g., "Set the vision section to: a collaborative PRD tool.").
- **Then**: The server log contains `stream [orchestrator] thinking: classified: needsPrdWork=true` and a trailing `turn <id> termination=final routed=work elapsed_ms=<n>` line. `prd_summary` in the DB becomes non-null after the turn.
- **Runnable target**: composed product via `pnpm dev` + `curl`.

### Scenario: Manual turn against live LM Studio — conversation turn classified as no_work

- **Given**: Same setup as prior scenario, with any conversation-only user message (e.g., "What is a PRD?").
- **When**: The message is sent.
- **Then**: The server log contains `stream [orchestrator] thinking: classified: needsPrdWork=false` and `turn <id> termination=final routed=no_work elapsed_ms=<n>`.
- **Runnable target**: composed product via `pnpm dev` + `curl`.

## Adaptation Log

_Empty. Populated during work-mode if the spec needs updating._

## Implementation Slices

Single slice. Orchestrator agent + prompt + routing wire-up + tests land together — plumbing alone (no caller) would be dead code per Runnability First.

### Slice 1: Orchestrator stage, routing decision, and branch-agnostic log line

- What: Everything in Scope → In Scope above. New `orchestrator.ts` + tests; filled `prompts/orchestrator.ts`; `handleTurn` stage + thinking event + log-line update; test-fixture adjustments in existing turn tests to account for the orchestrator being LLM call 1.
- Verify: `pnpm typecheck && pnpm lint && pnpm test` exit 0 with zero warnings. All new orchestrator and turn-orchestrator scenarios pass. All pre-S3 tests continue to pass (with inline LLM mock updates to account for orchestrator call — no assertion logic changes).
- Outcome: Every turn runs through the classifier before the supervisor tool loop. The routing decision is observable via stream events and the turn log line. S4 and S5 can now diverge branches by reading `routed`.

## Acceptance Criteria

- `rg "export async function classifyTurn" apps/server/src/orchestrator.ts` returns one match.
- `rg "OrchestratorOutputSchema" apps/server/src/orchestrator.ts` returns at least one match AND the schema is NOT exported (no match in other production files).
- `rg "buildOrchestratorPrompt" apps/server/src/prompts/orchestrator.ts` returns at least one match AND the function body is NOT a simple `return "";`.
- `rg "classifyTurn" apps/server/src/turn.ts` returns at least one match (the call site).
- `rg "routed=" apps/server/src/turn.ts` returns at least one match in the log line.
- `rg "type RouteDecision" apps/server/src/turn.ts` returns one match.
- `rg "orchestrator classification fail-closed" apps/server/src/orchestrator.ts` returns one match.
- `test -f apps/server/src/orchestrator.ts && test -f apps/server/src/orchestrator.test.ts && test -f apps/server/src/turn-orchestrator.test.ts` exits 0.
- From the repo root, `pnpm typecheck` exits 0.
- From the repo root, `pnpm lint` exits 0 with zero warnings.
- From the repo root, `pnpm test` exits 0 with all suites passing and a higher test count than pre-S3 (baseline 80 after S2).
- Running a manual PRD-editing turn against live LM Studio logs `stream [orchestrator] thinking: classified: needsPrdWork=true` and `routed=work` in the turn-summary line.
- Running a manual conversation-only turn against live LM Studio logs `classified: needsPrdWork=false` and `routed=no_work`.
