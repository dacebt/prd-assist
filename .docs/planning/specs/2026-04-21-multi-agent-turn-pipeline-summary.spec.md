# Multi-Agent Turn Pipeline — S2 Summary Storage and Agent

## Project Status
feature

## Parent Reference
- Kind: plan
- Plan: `../plans/2026-04-21-multi-agent-turn-pipeline.plan.md`
- Slice: S2 — Summary storage and agent
- Boundary: `apps/server/src/db.ts` (versioned migration + `prd_summary` column), `apps/server/src/sessions.ts` (store method + extended `sessionGet`), `apps/server/src/summaryAgent.ts` (new small-model agent), `apps/server/src/prompts/summary.ts` (fill in the stub from S1), `apps/server/src/turn.ts` (post-turn hook + `prdTouched` return from `runToolCallLoop`). Test additions for all of the above.
- Inherited constraints:
  - **C1** (consumer): `config.models.summary` selects the summary agent's model (`google/gemma-4-e4b`, `perCallTimeoutMs: 90_000`, `maxIterations: 1` per S1's `DEFAULT_MODEL_CONFIG`).
  - **C4** (owner): adds `prd_summary TEXT` column; `persistSummary(sessionId, summary)` method on `SessionStore`; `sessionGet` returns `(Session & { summary: string | null }) | null`.
  - Versioned DB migration — `CREATE TABLE IF NOT EXISTS` alone will not add the column to existing databases. Migration must read a schema version and apply the `ALTER TABLE` idempotently.
  - Runnability: every turn leaves the product running end-to-end. The summary write path is reachable from the entrypoint within this slice (via `handleTurn`'s post-turn hook). No consumer of the summary exists yet — S3 activates the read path.
  - No global turn wall-clock; per-call timeouts only. Summary generation adds one small-model call to the turn when the PRD was touched; it runs inside the existing session-mutex scope at `apps/server/src/turn.ts:205`.

## Intent

Persist a verbose natural-language summary of each PRD alongside the PRD itself. The summary is a compressed stand-in for the full PRD — its only input is the PRD JSON; it does not see the conversation. After any turn that modifies the PRD (via `update_section` or `mark_confirmed`), regenerate the summary in-process before the turn's HTTP response returns. The persisted summary becomes C4 — the shared contract S3's Orchestrator consumes so it can route each turn on a compact PRD view plus its own look at recent conversation, without rereading the PRD JSON each time.

## Scope

### In Scope
- Add `prd_summary TEXT NULL` column to the `sessions` table via a versioned migration.
- Add a `schema_version` table that tracks the applied migration version (starting state: version 0; post-migration: version 1).
- Extend `SessionStore` with `persistSummary(sessionId: string, summary: string): void`.
- Extend `sessionGet` to return `(Session & { summary: string | null }) | null`. Define and export `SessionWithSummary` in `apps/server/src/sessions.ts`.
- New file `apps/server/src/summaryAgent.ts` exporting `regenerateSummary(opts): Promise<string>` — invokes the small Gemma 4 summary model with the filled-in `buildSummaryPrompt()` + PRD + recent conversation, returns the summary string.
- Fill in `apps/server/src/prompts/summary.ts` — replace the empty-string stub from S1 with the actual summary-builder prompt per the template in R6 below.
- Modify `runToolCallLoop` in `apps/server/src/turn.ts` to return a `prdTouched: boolean` alongside `termination` and `wallStart`. `prdTouched` is `true` iff at least one `update_section` or `mark_confirmed` MCP call in the loop returned a result that did not contain an `error` field.
- Modify `handleTurn` in `apps/server/src/turn.ts` to, when `prdTouched === true`, re-fetch the session (which now contains the post-edit PRD) and invoke `regenerateSummary`; on success, call `store.persistSummary(sessionId, summary)`; on any thrown error from the agent, log the error to `console.error` with prefix `"summary regen failed: "` and continue. The turn reply and HTTP response are unaffected by summary regen outcome.
- Test coverage for: migration idempotency across restarts, migration applied to a pre-existing DB without the column, `persistSummary` round-trip through `sessionGet`, `regenerateSummary` happy path with a mocked `LlmClient`, `handleTurn` writes a summary on a PRD-touching turn, `handleTurn` does NOT write a summary on a non-PRD turn, `handleTurn` still returns the reply when the summary agent throws.

### Out of Scope
- Any reader of the summary (S3 Orchestrator).
- Any frontend surfacing of the summary.
- Incremental / diff-based summary generation — full regeneration from the current PRD every time.
- Summary caching or invalidation logic beyond "regenerate when prd_touched."
- `Session` type extension in `packages/shared` — summary stays a server-internal field.
- Migration rollback. `schema_version` is forward-only.
- Multi-step migrations — this slice defines the framework, but only one migration (`0 → 1`) exists.
- Async / background summary generation. Regen is synchronous with turn close.

## Implementation Constraints

### Architecture

Dependencies flow inward. The summary agent is part of the server app layer and calls out through the existing `LlmClient` boundary. Core turn logic (`handleTurn`) orchestrates; the summary agent owns its prompt and LLM call.

- `apps/server/src/db.ts` — owns the migration runner. Imports nothing from agent, sessions, or transport modules.
- `apps/server/src/sessions.ts` — owns `SessionStore`, `SessionWithSummary`, the `persistSummary` statement, and the extended `sessionGet`. Imports from `@prd-assist/shared` and `./db`.
- `apps/server/src/summaryAgent.ts` — owns `regenerateSummary`. Imports `LlmClient` from `./llm`, `ModelConfig` from `./config`, `buildSummaryPrompt` from `./prompts`, and the `PRD` type from `@prd-assist/shared`. Does not import from `sessions.ts`, `turn.ts`, or `routes/*`.
- `apps/server/src/prompts/summary.ts` — exports `buildSummaryPrompt(): string`. Leaf module.
- `apps/server/src/turn.ts` — consumes `regenerateSummary` and `SessionStore.persistSummary`. The post-turn hook lives inside `handleTurn`'s `try` block, before `mutex.release`.

The session mutex at `apps/server/src/turn.ts:205` continues to scope the entire turn including summary regen. No new mutex, no concurrent-turn concerns introduced.

### Boundaries

External inputs in scope for this slice:

- **Summary LLM response** — the small model's reply is untrusted. `regenerateSummary` must tolerate any string output (including empty) and pass it through to `persistSummary`. No parsing or structural validation — the summary is free-form prose. If `LlmClient.chat()` throws, the error propagates to `handleTurn`, which catches and logs it.
- **Pre-existing DB without `prd_summary` column** — the migration detects the missing column via `schema_version` and applies `ALTER TABLE`. Fresh DBs get the column in the initial `CREATE TABLE` DDL; the migration is a no-op for them (version check says "already at 1").

Validation rules:
- `persistSummary` accepts any string, including empty. Rejecting would require domain judgment the server does not have.
- `schema_version` table holds exactly one row enforced by `CHECK (id = 1)`. Multiple rows indicate corruption — the migration runner throws `SchemaVersionCorruptError`.

### Testing Approach

- Type system + existing tests are primary verification. All pre-S2 tests pass unchanged.
- **DB migration test** in `apps/server/src/db.test.ts` (new):
  1. Open a DB at a temp path using the *current* `openDatabase`, then close.
  2. Use raw `better-sqlite3` to drop the `prd_summary` column and the `schema_version` table, simulating a pre-S2 DB. (SQLite lacks `DROP COLUMN` prior to 3.35; use `ALTER TABLE ... DROP COLUMN` which is supported in the bundled version, or recreate the table from scratch.)
  3. Re-open with `openDatabase`. Assert `PRAGMA table_info(sessions)` includes `prd_summary`, and `schema_version` row has `version = 1`.
  4. Second open is idempotent — `schema_version` stays at 1, no errors.
- **`persistSummary` round-trip test** in `apps/server/src/sessions.test.ts` (new): create a session, call `persistSummary(id, "hello world")`, call `sessionGet(id)`, assert `summary === "hello world"`.
- **`sessionGet` null summary test** in the same file: brand-new session returns `summary: null`.
- **`regenerateSummary` happy path test** in `apps/server/src/summaryAgent.test.ts` (new): mock `LlmClient.chat` to return `{ role: "assistant", content: "mocked summary" }`. Call `regenerateSummary` with a sample PRD. Assert the function returns `"mocked summary"`. Assert `llm.chat` was called with `model === "google/gemma-4-e4b"` (the `summary` role default), that the system message equals `buildSummaryPrompt()`, and that the user message body contains `"Current PRD:"` followed by the stringified PRD.
- **`handleTurn` summary-on-touch test** in `apps/server/src/turn.test.ts` or a new `apps/server/src/turn-summary.test.ts`: construct a turn that makes an `update_section` tool call successfully. Spy on `store.persistSummary`. Assert called exactly once with the session id and the mocked summary string.
- **`handleTurn` no-summary-on-no-touch test**: construct a turn that returns a plain assistant message with no tool calls. Assert `store.persistSummary` was not called.
- **`handleTurn` summary-failure-safe test**: mock the summary agent to throw. Assert the turn still returns the reply, `store.persistAssistantMessage` still ran, and `console.error` was called with a message starting `"summary regen failed:"`. `store.persistSummary` was not called.

Do not add tests that restate type-system guarantees (e.g., "SessionWithSummary has `summary` property"). The type system proves this at compile time.

### Naming

- **`SessionWithSummary`** — `Session & { summary: string | null }`. Exported from `apps/server/src/sessions.ts`. The return type of `sessionGet`.
- **`persistSummary(sessionId: string, summary: string): void`** — method on `SessionStore`. Writes the summary column for the given session id. No return value.
- **`regenerateSummary(opts: { llm, models, prd }): Promise<string>`** — top-level export of `summaryAgent.ts`.
- **`buildSummaryPrompt(): string`** — the prompt builder in `prompts/summary.ts`. Returns a static prompt (no arguments); the PRD is passed as user-role content by `regenerateSummary`, not embedded in the system prompt.
- **`prdTouched`** — new field on `LoopResult` in `turn.ts`. Boolean.
- **`SchemaVersionCorruptError`** — new error class in `db.ts` thrown when `schema_version` contains more than one row.
- **`schema_version`** — the new SQLite table name (snake_case matching `sessions`).

## Requirements

### R1. Schema version table

`db.ts` creates the table in the initial DDL block, alongside `sessions`:

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL
);
```

Initial row insert on a fresh DB: `INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, 0)`. The `OR IGNORE` keeps repeated `openDatabase` calls idempotent.

### R2. `prd_summary` column on fresh DBs

The `CREATE TABLE IF NOT EXISTS sessions` DDL gains `prd_summary TEXT` (nullable). Fresh DBs created from scratch have this column without needing migration.

### R3. Migration runner

`db.ts` exports (or defines internally and invokes in `openDatabase`) a `runMigrations(db)` function that:

1. Reads the single row from `schema_version`. If zero rows, inserts `(1, 0)` and treats current version as `0`. If more than one row, throws `SchemaVersionCorruptError("schema_version has N rows")`.
2. For each migration in a sequential list, if current version is below the migration's target version, applies its SQL and updates `schema_version.version` in the same transaction.
3. For this slice, exactly one migration exists: `{ target: 1, up: "ALTER TABLE sessions ADD COLUMN prd_summary TEXT" }`. On a fresh DB (where the column already exists in CREATE TABLE and the version is `0`), the ALTER TABLE will fail with `duplicate column name`. Handle this by wrapping the ALTER in a try/catch that swallows `SqliteError` with code `SQLITE_ERROR` and message containing `duplicate column name`; the version is still bumped to `1`.

`openDatabase` calls `runMigrations(db)` after the CREATE TABLE block.

### R4. `persistSummary` on `SessionStore`

`apps/server/src/sessions.ts`:

```ts
export interface SessionStore {
  // ...existing methods...
  persistSummary(sessionId: string, summary: string): void;
}
```

Prepared statement: `UPDATE sessions SET prd_summary = ? WHERE id = ?`. The `updated_at` column is NOT touched by `persistSummary` — summary regen is a background-ish bookkeeping operation that should not bump a session's last-activity timestamp.

### R5. `SessionWithSummary` and extended `sessionGet`

`apps/server/src/sessions.ts`:

```ts
export type SessionWithSummary = Session & { summary: string | null };
```

`sessionGet` return type changes from `Session | null` to `SessionWithSummary | null`. `SessionRowSchema` gains `prd_summary: z.string().nullable()`. The `SELECT` statements (`getStmt`, `listStmt`) add `prd_summary` to their column list. The `SessionStore.getSession` method's return type updates to match.

`sessionList` is NOT changed to include summary — list items remain `SessionSummary` shape. The `prd_summary` selected in the list query is simply ignored (the Zod schema permits the field but it's not used). Alternative: keep `listStmt` selecting only the columns it needs — drop `prd_summary` from `listStmt`'s SELECT. Choose the second: tighter, no wasted read.

### R6. `buildSummaryPrompt`

`apps/server/src/prompts/summary.ts` replaces its empty-string stub with:

```ts
export function buildSummaryPrompt(): string {
  return [
    "You are the summary agent in a PRD-building session. You do not speak to the user. Your output is persisted as a compressed stand-in for the full PRD, consumed later by another agent that makes routing decisions without reading the PRD JSON directly.",
    "",
    "Input (as user message): the full current PRD as JSON.",
    "",
    "Output: a single verbose markdown summary covering every one of the seven sections (`vision`, `problem`, `targetUsers`, `goals`, `coreFeatures`, `outOfScope`, `openQuestions`). For each section:",
    "- State the section status (`empty`, `draft`, or `confirmed`).",
    "- If non-empty, summarize the content in 2–4 sentences. Preserve specific user-stated facts: names, numbers, concrete commitments, feature names, constraints.",
    "- If empty, state `Not yet started.`",
    "",
    "Cover every section even if empty. Order the sections as listed above. Do not add sections, drop sections, or rename them.",
    "",
    "Do not ask questions. Do not propose edits. Do not include meta-commentary about the summary itself or about the conversation. Output only the markdown summary.",
  ].join("\n");
}
```

### R7. `regenerateSummary`

`apps/server/src/summaryAgent.ts`:

```ts
import type { LlmClient } from "./llm";
import type { ModelConfig } from "./config";
import type { PRD } from "@prd-assist/shared";
import { buildSummaryPrompt } from "./prompts";

export async function regenerateSummary(opts: {
  llm: LlmClient;
  models: ModelConfig;
  prd: PRD;
}): Promise<string> { /* impl */ }
```

Behavior:
- Builds the system prompt from `buildSummaryPrompt()`.
- Builds the user message content as `"Current PRD:\n\n" + JSON.stringify(prd, null, 2)`.
- Calls `llm.chat({ model: models.summary.model, messages: [system, user], tools: undefined, signal: AbortSignal.timeout(models.summary.perCallTimeoutMs) })`.
- Returns `reply.content ?? ""`.
- Does not catch errors; the caller handles failure.

### R8. `runToolCallLoop` returns `prdTouched`

`apps/server/src/turn.ts`:

`LoopResult` gains `prdTouched: boolean`:

```ts
type LoopResult = { termination: Termination; wallStart: number; prdTouched: boolean };
```

`runToolCallLoop` maintains a local `let prdTouched = false` initialized at loop entry. Inside `dispatchToolCalls`, whenever the `mcp.callTool` result does NOT contain an `error` field AND the tool name is `"update_section"` or `"mark_confirmed"`, set `prdTouched = true`.

`dispatchToolCalls` accepts a third structured parameter: a mutable flag wrapper `prdTouchedRef: { value: boolean }`, or returns `prdTouched` via its Promise. Choose the first — less plumbing through the async generator.

Every `return` path in `runToolCallLoop` includes `prdTouched` in its `LoopResult`.

### R9. `handleTurn` post-turn summary hook

After `runToolCallLoop` returns, inside the `try` block of `handleTurn`, before the final `return reply`:

```ts
if (prdTouched) {
  try {
    const refreshed = store.getSession(sessionId);
    if (refreshed !== null) {
      const summary = await regenerateSummary({
        llm,
        models: config.models,
        prd: refreshed.prd,
      });
      store.persistSummary(sessionId, summary);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`summary regen failed: ${message}`);
  }
}
```

Failure to regenerate is swallowed and logged. The turn's reply and HTTP response are unaffected.

### R10. Test fixture updates

`apps/server/src/turn.test.helpers.ts` extends `SessionStore` fixtures returned by `makeStore` to include a `persistSummaryCalls: Array<{ sessionId: string; summary: string }>` array populated by `persistSummary`. `sessionGet` from `makeStore` returns `SessionWithSummary` (the existing Session plus `summary: null` by default; override via a new optional `summary?` on `makeStore`'s input).

Existing test files (`turn.test.ts`, `turn-limits.test.ts`, `turn-toolcalls.test.ts`, `routes.test.ts`) do not require changes beyond the fixture extension — their assertions about reply content, tool call behavior, and persistence all remain valid.

## Dependencies

No new npm packages. Everything builds on the existing `better-sqlite3`, `zod`, and internal modules.

## Impacted Modules

- `apps/server/src/db.ts` — add `schema_version` DDL, `runMigrations`, `SchemaVersionCorruptError`, `prd_summary` column.
- `apps/server/src/sessions.ts` — add `persistSummary`, extend `sessionGet` return type, export `SessionWithSummary`, extend `SessionRowSchema` with `prd_summary`, trim `listStmt` SELECT to skip the column.
- `apps/server/src/summaryAgent.ts` — new file.
- `apps/server/src/prompts/summary.ts` — replace stub body with actual prompt.
- `apps/server/src/turn.ts` — `runToolCallLoop` signature + return, `handleTurn` post-turn hook.
- `apps/server/src/turn.test.helpers.ts` — fixture support for `persistSummary`.
- New test files: `apps/server/src/db.test.ts`, `apps/server/src/sessions.test.ts`, `apps/server/src/summaryAgent.test.ts`, `apps/server/src/turn-summary.test.ts`.

## Migration

Forward-only. `schema_version` table tracks applied migrations. Version progresses `0 → 1` with `ALTER TABLE sessions ADD COLUMN prd_summary TEXT`. The migration is idempotent — re-running on an already-migrated DB is a no-op.

Rollback is not supported and out of scope. A developer wanting to revert would drop the DB or manually drop the column.

## Rejected Alternatives

- **Compare pre-turn and post-turn `prd_json` to detect changes** — rejected in favor of inspecting tool call names/results. Stringify comparison is O(PRD size) and adds an extra DB round trip to fetch the pre-turn state. Tool-call inspection is already in-memory and precise to what actually happened.
- **Fail the turn on summary regen failure** — rejected. The user's turn completed successfully; failing the reply because a bookkeeping task errored would punish the user for a background concern. Logged-and-continued lets the next successful PRD edit regenerate.
- **Synchronous `persistSummary` inside `update_section` / `mark_confirmed` MCP tool handlers** — rejected in the plan. Couples MCP dispatch to LLM generation and blocks edits on small-model latency. Post-turn hook in the server app keeps MCP a dumb CRUD surface.
- **Add `summary` to `@prd-assist/shared`'s `Session` type** — rejected. The plan's Directory Ownership table marks `packages/shared` as untouched by this project. Web does not consume the summary until S6 (and only maybe); local extension in `sessions.ts` keeps shared clean.
- **Off-the-shelf SQLite migration library** — rejected. One migration does not justify a dependency. A single `schema_version` row with a tiny list of migrations covers every case this project will reach through S6.
- **Incremental / diff-based summary updates** — rejected. Full regeneration from the current PRD is simpler and guaranteed correct. A 10KB PRD on `google/gemma-4-e4b` is well within the small model's context budget.
- **Background / async summary regeneration** (fire-and-forget, return reply immediately) — rejected. The plan's decision was synchronous regen before reply returns, so the next turn's Orchestrator sees a fresh summary. Async would introduce a race where Turn N+1's Orchestrator reads a stale summary from before Turn N's edits.

## Accepted Risks

- **Turn latency increases on PRD-touching turns.** One additional small-model call (~7.5B Gemma 4 on local GPU). Accepted: the plan's per-call timeout budget is 90 seconds, and Branch B turns already take multiple model calls; one more for summary regen is bounded and the user-visible outcome is unchanged.
- **Summary can become stale if regen throws and no PRD-touching turn follows soon.** Accepted: S3's Orchestrator is null-safe and falls back to raw PRD on null summary; a stale summary is not wrong, just older. Next successful PRD-touching turn refreshes it.
- **`DROP COLUMN` is only required in the migration-idempotency test, not in production.** Accepted: the test asserts migration correctness by simulating a pre-S2 DB. Production paths never drop `prd_summary`.
- **Summary content is free-form prose with no structural validation.** Accepted: the summary is consumed by the Orchestrator LLM, which tolerates unstructured text by design. Structural validation would require a schema the summary model is not prompted to produce.

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

### Scenario: Fresh database gets `prd_summary` column and `schema_version` row 1

- **Given**: A new SQLite path that does not exist.
- **When**: `openDatabase(path)` is called.
- **Then**: `PRAGMA table_info(sessions)` includes a row with `name = "prd_summary"` and `type = "TEXT"`. `SELECT version FROM schema_version WHERE id = 1` returns `1`. `SELECT COUNT(*) FROM schema_version` returns `1`.
- **Runnable target**: isolated package via a new test in `apps/server/src/db.test.ts`.

### Scenario: Pre-S2 database is migrated on first open

- **Given**: A SQLite file that contains a `sessions` table without `prd_summary` and no `schema_version` table (simulated by raw DDL in the test).
- **When**: `openDatabase(path)` is called.
- **Then**: After the call, `PRAGMA table_info(sessions)` includes `prd_summary TEXT`, and `schema_version.version` equals `1`. Existing row data in `sessions` is preserved; pre-existing rows have `prd_summary` set to `NULL`.
- **Runnable target**: isolated package via `apps/server/src/db.test.ts`.

### Scenario: Migration is idempotent across restarts

- **Given**: A SQLite file that has already been migrated to version 1.
- **When**: `openDatabase(path)` is called a second time.
- **Then**: `schema_version.version` remains `1`. No errors thrown. `PRAGMA table_info(sessions)` still lists `prd_summary`.
- **Runnable target**: isolated package via `apps/server/src/db.test.ts`.

### Scenario: Corrupt `schema_version` table aborts startup

- **Given**: A SQLite file with two rows in `schema_version`, violating the `CHECK (id = 1)` constraint (simulated by bypassing the check).
- **When**: `openDatabase(path)` is called.
- **Then**: A `SchemaVersionCorruptError` is thrown with message containing `"schema_version has 2 rows"`.
- **Runnable target**: isolated package via `apps/server/src/db.test.ts`.

### Scenario: `persistSummary` round-trips through `sessionGet`

- **Given**: A freshly created session (`summary` is `null`).
- **When**: `store.persistSummary(sessionId, "hello world")` is called, then `store.getSession(sessionId)` is called.
- **Then**: The returned `SessionWithSummary.summary` equals `"hello world"`. The session's `updatedAt` field is NOT changed by `persistSummary`.
- **Runnable target**: isolated package via `apps/server/src/sessions.test.ts`.

### Scenario: `regenerateSummary` calls the summary model with PRD-only input and returns its content

- **Given**: A mock `LlmClient` whose `chat` method returns `{ role: "assistant", content: "mocked summary" }`. A sample PRD with one draft section.
- **When**: `regenerateSummary({ llm, models: DEFAULT_MODEL_CONFIG, prd })` is called.
- **Then**: Returns `"mocked summary"`. `llm.chat` was called exactly once with `model === "google/gemma-4-e4b"`, with a system message equal to `buildSummaryPrompt()`, and a user message containing `"Current PRD:"` and `JSON.stringify(prd, null, 2)` and no conversation-message content.
- **Runnable target**: isolated package via `apps/server/src/summaryAgent.test.ts`.

### Scenario: Turn that edits PRD writes a summary

- **Given**: A session with an empty PRD. `handleTurn` processes a user message whose LLM reply includes a successful `update_section` tool call for `vision`. The mock summary agent returns `"new summary"`.
- **When**: The turn completes.
- **Then**: `store.persistSummary` was called exactly once with `(sessionId, "new summary")`. The HTTP reply matches the final LLM content. `store.persistAssistantMessage` was called.
- **Runnable target**: composed product via `apps/server/src/turn-summary.test.ts` exercising `handleTurn` with mocked LLM + MCP + store.

### Scenario: Turn that does not edit PRD does not write a summary

- **Given**: A session. `handleTurn` processes a user message whose LLM reply is plain content with no tool calls.
- **When**: The turn completes.
- **Then**: `store.persistSummary` was NOT called. The reply and assistant message persist normally.
- **Runnable target**: isolated package via `apps/server/src/turn-summary.test.ts`.

### Scenario: Summary agent throws — turn still succeeds

- **Given**: A session. `handleTurn` processes a turn with a successful `update_section` tool call. The mocked `regenerateSummary` throws `new Error("boom")`.
- **When**: The turn completes.
- **Then**: The turn returns the reply string normally. `store.persistAssistantMessage` ran. `store.persistSummary` was NOT called. `console.error` was called at least once with an argument that starts with `"summary regen failed:"`.
- **Runnable target**: isolated package via `apps/server/src/turn-summary.test.ts`.

## Adaptation Log

_Empty. Populated during work-mode if the spec needs updating._

## Implementation Slices

Single slice. The plumbing and agent land together because plumbing alone would be dead code (nothing to call `persistSummary` or the summary model).

### Slice 1: Summary storage, agent, and post-turn hook

- What: Everything in Scope → In Scope above. Migration framework + `prd_summary` column in `db.ts`; `persistSummary` and `SessionWithSummary` in `sessions.ts`; `buildSummaryPrompt` body in `prompts/summary.ts`; `summaryAgent.ts` with `regenerateSummary`; `runToolCallLoop` and `handleTurn` wired to track `prdTouched` and invoke the summary agent post-turn. Test files for all of the above.
- Verify: `pnpm typecheck && pnpm lint && pnpm test` exit 0. All new test scenarios pass. All pre-S2 tests continue to pass without assertion changes (fixture-level additions to `makeStore` are permitted).
- Outcome: After any PRD-editing turn, the `sessions` row has an up-to-date `prd_summary` column value. S3's Orchestrator slice can now consume `summary` via `sessionGet` in the next spec.

## Acceptance Criteria

- `rg "CREATE TABLE IF NOT EXISTS schema_version" apps/server/src/db.ts` returns one match.
- `rg "prd_summary TEXT" apps/server/src/db.ts` returns at least one match (the `CREATE TABLE` DDL; the `ALTER TABLE` migration may match too).
- `rg "runMigrations\|SchemaVersionCorruptError" apps/server/src/db.ts` returns at least two matches.
- `rg "persistSummary" apps/server/src/sessions.ts` returns at least two matches (interface declaration + implementation).
- `rg "export type SessionWithSummary" apps/server/src/sessions.ts` returns one match.
- `test -f apps/server/src/summaryAgent.ts && test -f apps/server/src/summaryAgent.test.ts && test -f apps/server/src/db.test.ts && test -f apps/server/src/sessions.test.ts && test -f apps/server/src/turn-summary.test.ts` exits 0.
- `rg "buildSummaryPrompt" apps/server/src/prompts/summary.ts | wc -l` ≥ 1 AND the function body in that file is NOT a simple `return "";`.
- `rg "prdTouched" apps/server/src/turn.ts` returns at least four matches (type declaration + initial assignment + dispatch-side update + return sites).
- `rg "summary regen failed" apps/server/src/turn.ts` returns one match.
- From the repo root, `pnpm typecheck` exits 0.
- From the repo root, `pnpm lint` exits 0 with zero warnings.
- From the repo root, `pnpm test` exits 0 with all suites passing and a higher test count than pre-S2 (baseline 66).
- Running a manual turn against a live LM Studio that causes an `update_section` call results in `SELECT prd_summary FROM sessions WHERE id = ?` returning non-null markdown text. Running a conversation-only turn results in no change to the `prd_summary` column.
