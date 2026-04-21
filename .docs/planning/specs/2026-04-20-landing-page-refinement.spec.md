# Landing page refinement

## Project Status
feature

## Intent

Refine the `/` landing page with delete-session capability, richer per-row information, a centered bounded-width container, and a brief elevator-pitch helper text. UI-and-one-endpoint scope: adds `DELETE /api/sessions/:id`, expands `SessionSummary` with derived counts, and rebuilds the landing presentation. No changes to session page, chat, PRD, theme, or MCP.

## Scope

### In Scope

- New server route: `DELETE /api/sessions/:id` (idempotent, returns 204).
- Expand `SessionSummary` (shared + server-computed): add `createdAt`, `exchangeCount`, `sectionsConfirmed`.
- Landing page (`SessionListPage`): centered bounded-width column, elevator-pitch helper text, independent list scroll.
- Landing row (`SessionList` → `SessionRow`): show title, created/updated timestamps, exchange count, confirmed-section progress.
- Landing row delete affordance: hover-reveal (and focus-within) trash icon, inline two-step confirm, silent refetch on success.
- Client `api.ts`: add `deleteSession(id)`.
- Unit test coverage for new server route and for the derivation of `exchangeCount`/`sectionsConfirmed`.

### Out of Scope

- Session page (`/sessions/:id`), chat, PRD pane, theme toggle.
- Any MCP or LLM changes.
- Rename, duplicate, archive, bulk-delete, or multi-select row operations.
- Undo / restore after delete. Delete is permanent.
- Pagination, infinite scroll, server-side sort, filter, or search on the session list.
- Server-side PRD completion percentage beyond the single integer `sectionsConfirmed` (0..7).
- Mobile / narrow-viewport redesign. Landing inherits the existing desktop-first policy.
- Changes to the `POST /api/sessions` or `GET /api/sessions/:id` response shapes.

## Implementation Constraints

### Architecture

- Dependency direction: `packages/shared` → `apps/server` and `apps/web`. `shared` defines types and zod schemas; server consumes them to shape responses; client consumes them to validate responses at the boundary.
- Server core (`apps/server/src/sessions.ts`) owns persistence and derived-field computation (`exchangeCount`, `sectionsConfirmed`). HTTP routes (`apps/server/src/routes/sessions.ts`) are a thin boundary that calls into the store and maps store results to HTTP responses.
- Client data layer (`apps/web/src/api.ts`) is the only place in `apps/web` that calls `fetch`. UI components call `api.ts` functions — they never call `fetch` directly.
- Persistence layer: SQLite via `better-sqlite3`. Sessions are a single row per session (`prd_json`, `messages_json` columns). Delete is a single `DELETE FROM sessions WHERE id = ?`. No cascade logic needed beyond that row — PRD and messages are colocated in the same row by current design.

### Boundaries

- External inputs in scope:
  - `DELETE /api/sessions/:id` — `id` parameter validated against the existing `IdParamSchema` (same validator used by `GET /api/sessions/:id`). Invalid id → 400 with the existing validator error shape. Unknown id is not an error (idempotent — see below).
  - `GET /api/sessions` response shape — the expanded `SessionSummary` is validated client-side by zod (`SessionListSchema`) on receipt. An invalid server response throws at the boundary, surfaced to the UI as a fetch error.
- Delete response policy: idempotent. `DELETE /api/sessions/:id` returns `204 No Content` whether the row existed or not. Client treats any `2xx` as success. The client never surfaces "session already deleted" as a user-visible error.
- Client-side request errors on delete (network failure, 5xx) surface inline in the row as a structured error state (message + retry).

### Testing Approach

- Server: unit-test the `SessionStore` delete operation and the `exchangeCount` / `sectionsConfirmed` derivation in `apps/server/src/sessions.test.ts`. Extend `apps/server/src/routes.test.ts` (or the existing sessions-route test file) to cover `DELETE /api/sessions/:id` — 204 on existing id, 204 on unknown id (idempotent), 400 on invalid id.
- Shared: no new tests — type + schema changes are covered by consumers.
- Client: no new unit tests. `deleteSession` is a thin fetch wrapper — type check + manual verification is sufficient.
- UI: no new unit tests. Component behavior is verified via the Verification Scenarios during the final manual walkthrough.

### Naming

- `exchangeCount` — integer count of messages with `role === "user"` in the session. "Exchange" = one user turn (the assistant reply is implied but not double-counted). User-facing copy: `"N exchanges"` (plural form always — English pluralization is out of scope; `"1 exchanges"` is acceptable for this internal tool).
- `sectionsConfirmed` — integer count of PRD sections whose `status === "confirmed"`. User-facing copy: `"X/7 confirmed"` (denominator comes from `SECTION_KEYS.length`; hardcoding `7` in UI copy is acceptable and matches the existing PRD section count).
- `createdAt`, `updatedAt` — ISO-8601 strings (already the server's format).
- UI row timestamp copy: `"created <relative> · updated <relative>"`, using the existing `relativeTime` helper.
- Delete confirmation copy: `"Delete session?"` followed by two buttons `"Delete"` (destructive) and `"Cancel"`. The session title is not echoed in the confirm — the row itself provides context because the confirm UI replaces only the row's controls, not the row's title line.

## Requirements

### R1. Shared type + schema expansion

`packages/shared/src/types.ts` — `SessionSummary` becomes:

```ts
export type SessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  exchangeCount: number;
  sectionsConfirmed: number;
};
```

`packages/shared/src/schemas.ts` — `SessionSummarySchema` is updated to match, using `z.string()` for timestamps and `z.number().int().nonnegative()` for the two counts.

All fields are required. No optionality — older clients do not exist in this app (single deployment, no external consumers of this schema).

### R2. Server — session list derivation

`apps/server/src/sessions.ts`:

- `sessionList` changes the backing SQL to select `id, title, created_at, updated_at, messages_json, prd_json` (not just the summary columns — the derivations need the two JSON blobs).
- For each row, parse `messages_json` with the existing `MessagesSchema`, count items with `role === "user"`, assign to `exchangeCount`.
- Parse `prd_json` with the existing `PrdSchema`, count sections with `status === "confirmed"` (iterate `SECTION_KEYS`), assign to `sectionsConfirmed`.
- Return the expanded `SessionSummary` shape.
- The existing `SessionSummaryRowSchema` is replaced or extended to match the new column selection.

Performance: this adds JSON parse work proportional to the session count on each `GET /api/sessions`. For this app's expected scale (tens to low hundreds of sessions), the overhead is acceptable — no caching, no denormalized columns.

### R3. Server — delete route

`apps/server/src/sessions.ts` — `SessionStore` gains:

```ts
deleteSession(id: string): void;
```

Implementation: `DELETE FROM sessions WHERE id = ?`. No error if zero rows affected. The prepared statement is created in the same initialization path as the existing statements.

`apps/server/src/routes/sessions.ts` — add:

```ts
app.delete("/api/sessions/:id", (c) => {
  const parsed = parseParam(c, IdParamSchema);
  if (!parsed.ok) return parsed.response;
  deps.store.deleteSession(parsed.data.id);
  return c.body(null, 204);
});
```

Route is always 204 on success regardless of row existence. 400 only on param validation failure (delegated to `parseParam` + `IdParamSchema`).

### R4. Client — `deleteSession` API function

`apps/web/src/api.ts`:

```ts
export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`delete session failed: ${res.status}`);
}
```

No response body to parse. Errors surface as thrown `Error` instances — consistent with `fetchSessions`, `createSession`, `fetchSession`.

### R5. Landing layout

`apps/web/src/pages/SessionListPage.tsx`:

- Page remains `flex h-screen flex-col` with the existing top header (`prd-assist` title + `ThemeToggle`).
- The header row stays full-width.
- Below the header: a centered bounded-width column wrapping the elevator-pitch helper text, the `New session` button row, and the session list.
  - Column: `mx-auto w-full max-w-3xl px-6 py-6 flex flex-col gap-6 flex-1 min-h-0 overflow-hidden`.
  - `flex-1 min-h-0 overflow-hidden` allows the nested list to own its own scroll.
- Helper text block (new): plain paragraph, no chrome, muted color. Copy:
  > *prd-assist helps you write product requirements documents by conversation. Each session is a chat that drafts a PRD — vision, problem, users, goals, features, scope, and open questions — as you talk through it.*
  - Rendered as a `<p>` with `text-sm text-gray-600 dark:text-gray-400 leading-relaxed`.
- New session button row: unchanged component (`<NewSessionButton />`), wrapped in a flex container so the button aligns right: `flex justify-end`.
- Session list wrapper: takes the remaining vertical space and scrolls internally — `<main className="flex-1 min-h-0 overflow-y-auto rounded border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">`. The bordered panel visually contains the list.

The existing `border-b` chrome between header / new-session / list areas in the current landing is removed — replaced by the panel border around the list.

### R6. Session row richer labels

`apps/web/src/components/SessionList.tsx` — `SessionRow` updated to render three text lines inside each `<Link>`:

1. **Title line**: existing — `s.title || "(untitled)"`, truncated, same typography classes as today.
2. **Metadata line (new)**: `<id-suffix> · created <relativeTime(createdAt)> · updated <relativeTime(updatedAt)>`.
3. **Progress line (new)**: `<exchangeCount> exchanges · <sectionsConfirmed>/7 confirmed`.

Lines 2 and 3 use the existing muted subtitle typography: `text-xs text-gray-400 dark:text-gray-500`. No icons in the subtitle — text only, `·` as separator. The id-suffix remains `s.id.slice(-8)`.

The row's outer `<Link>` layout becomes:
```tsx
<Link to={`/sessions/${s.id}`} className="group relative block px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
  <p className="truncate pr-10 text-sm font-medium text-gray-800 dark:text-gray-100">{s.title || "(untitled)"}</p>
  <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{s.id.slice(-8)} · created {relativeTime(s.createdAt)} · updated {relativeTime(s.updatedAt)}</p>
  <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{s.exchangeCount} exchanges · {s.sectionsConfirmed}/7 confirmed</p>
  {/* delete affordance lives here — see R7 */}
</Link>
```

`pr-10` reserves space on the right for the delete trash icon so the title never collides with it.

### R7. Delete affordance — hover-reveal, inline two-step confirm

- The delete affordance lives at the right side of the row, absolutely positioned inside the row container (which becomes `relative`).
- **Idle state**: a trash icon button. Hidden visually by default (`opacity-0`), revealed via `group-hover:opacity-100` OR when the row has focus within (`group-focus-within:opacity-100`). The button itself remains in the tab order at all times so keyboard users can reach it — its visible state is decoupled from its tab-stop state.
  - Button: `type="button"`, `aria-label="Delete session"`, styled as a small icon button with a red-tinted hover state.
  - The trash icon is an inline SVG, consistent with the existing `ThemeToggle` inline-SVG pattern.
- **Click trash**: the row's right-side region (where the icon was) is **replaced** with an inline confirm cluster; the row's title / subtitle text remains visible. The `<Link>` navigation is suppressed during confirm:
  - The `<Link>` element is swapped to a plain `<div>` for the row during `pendingDelete === s.id`, so the entire row no longer navigates on click. On cancel or success, it reverts.
  - Confirm cluster layout (right side): `[Delete] [Cancel]` — two small buttons, `[Delete]` red-tinted, `[Cancel]` muted. Both keyboard-focusable; Esc triggers Cancel while the confirm is open.
- **Click Delete** (confirm): disables both buttons, text switches to `"Deleting…"` on the delete button, calls `api.deleteSession(s.id)`. On success: `SessionList.load("refresh")` (silent — does not flash the loading state; uses the existing `mode` parameter added in the prior refactor). On failure: confirm cluster switches to an error state — small red text (`"Delete failed: <message>"`) and a `[Retry]` button that re-attempts, plus a `[Cancel]` button.
- **Click Cancel**: returns the row to idle.
- Only one row at a time may be in confirm / deleting / error state. Clicking trash on a second row while another is pending auto-cancels the first. State lives in `SessionList` as `pendingDelete: { id: string; phase: "confirm" | "deleting" | "error"; message?: string } | null`.

Rationale for the absolutely-positioned trash: the row's primary interaction is navigation via `<Link>`. Nesting a `<button>` inside an `<a>` / `<Link>` is invalid HTML. The absolute-positioned button sits in the row's visual layout but is a sibling of the `<Link>` in the DOM — the row's outer container becomes a `<li class="relative group">` holding both.

Final row shape:

```tsx
<li className="relative group">
  {pendingDelete?.id === s.id ? (
    <div className="block px-6 py-4 bg-gray-50 dark:bg-gray-800">
      {/* title + subtitles, non-navigating */}
      {/* right-side confirm cluster absolutely positioned */}
    </div>
  ) : (
    <Link to={`/sessions/${s.id}`} className="...">
      {/* title + subtitles */}
    </Link>
  )}
  {/* trash / confirm / error cluster — absolutely positioned, right-center */}
</li>
```

### R8. Silent refetch on delete success

Reuses the `load("refresh")` mode added to `SessionList` during the prior layout refactor. After `deleteSession` resolves successfully, call `load("refresh")`. The `loaded` state stays visible during the refetch; the deleted row disappears on receipt of the new list.

Race condition: the user deletes row A, immediately deletes row B before the first refetch resolves. Both deletes fire; the in-flight `load("refresh")` from A's success is superseded by the one from B's success. Last-write-wins is acceptable — both rows will be gone from the server and the final `load("refresh")` produces the correct list.

## Dependencies

| Package | Version | Runtime/Dev | Justification |
|---------|---------|-------------|---------------|
| (none)  |         |             | No new dependencies. |

## Impacted Modules

- `packages/shared/src/types.ts` — expand `SessionSummary` with three new fields.
- `packages/shared/src/schemas.ts` — expand `SessionSummarySchema` to match.
- `apps/server/src/sessions.ts` — update `sessionList` to compute derived fields; add `deleteSession` to store; extend `SessionStore` interface and prepared statements.
- `apps/server/src/routes/sessions.ts` — add `app.delete("/api/sessions/:id", …)`.
- `apps/server/src/sessions.test.ts` — cover derivation and delete.
- `apps/server/src/routes.test.ts` (or the existing route test file for sessions) — cover the new DELETE route.
- `apps/web/src/api.ts` — add `deleteSession`.
- `apps/web/src/pages/SessionListPage.tsx` — restructure to centered max-width column + helper text + panel wrapper.
- `apps/web/src/components/SessionList.tsx` — row label expansion, delete state machine, trash affordance, inline confirm / deleting / error states, silent refetch on success.

No other files change.

## Migration

Not applicable. No database schema change (existing `sessions` table already has the `created_at` column used by `createdAt`). No data migration. No client-side storage migration.

## Rejected Alternatives

- **Modal dialog for delete confirmation** — rejected: introduces a focus-trap / overlay component this app does not have, for a single destructive action. Inline two-step confirm fits the existing minimal-chrome style.
- **Browser `window.confirm()`** — rejected: inconsistent with the app's dark-mode-aware styling, and cannot show "Deleting…" progress or inline retry on failure.
- **Delete icon always visible** — rejected: adds visual noise on every row for an action the user takes rarely. Hover-reveal plus focus-within preserves a11y without constant visual presence.
- **Soft delete / archive** — rejected: out of scope; user explicitly wanted permanent delete with cascade (the row already cascades trivially since PRD + messages are colocated in a single SQLite row).
- **`X/7 started` (non-empty sections) or dual `confirmed + drafted` display** — rejected: user selected `X/7 confirmed` as the progress signal; `confirmed` reflects user-intent approval, which is the strongest completion signal.
- **Denormalized `exchange_count` / `sections_confirmed` columns in SQLite** — rejected: current scale does not justify the schema migration; on-the-fly derivation in `sessionList` is simple and correct. Revisit if the list becomes slow.
- **Separate `/api/sessions/:id/delete` POST endpoint** — rejected: REST `DELETE` method is semantically correct and fits existing route conventions.
- **Returning 404 on delete of unknown id** — rejected: the client treats unknown-id as success anyway (concurrent delete from another tab is a normal condition). Idempotent `204` keeps the client simpler and matches common REST practice for DELETE.
- **Optimistic local removal on delete** — rejected: user explicitly chose silent refetch. Adds state reconciliation complexity for a tiny perceived-latency win on an infrequent action.
- **Row-replacement confirm with title echoed ("Delete 'My Session'?")** — rejected: the row itself remains visible during confirm, so the title is already in view. Echoing it again is noise.

## Accepted Risks

- **Permanent delete with no undo**. A user who clicks Delete (after clicking the trash, which is the two-step requirement) cannot recover the session. Accepted: explicit two-step confirm mitigates accidental clicks; the user did not want undo in scope.
- **`sessionList` JSON-parses every row on each call**. Proportional to session count. Accepted at current scale. Will surface as a performance risk if the session count grows past low hundreds; the mitigation (denormalized columns) is deferred.
- **Race between delete and in-flight `GET /api/sessions`**. The prior list fetch can land after the delete completes, showing the deleted row briefly. The subsequent silent refetch corrects it. Accepted — the flash is under one network round-trip and the final state is correct.
- **Invalid HTML risk if delete button is ever nested inside `<Link>`**. Accepted as a constraint: the spec explicitly puts the delete button as a sibling of `<Link>`, absolutely positioned in the `<li>`. Any implementation deviation is a bug.
- **Hover-only reveal on touch devices**. Touch users see no trash icon until focus lands on the row (via tap). Accepted: the app is desktop-first and this scenario is out of scope per the existing narrow-viewport policy.
- **`"1 exchanges"` reads awkwardly**. Accepted as a tradeoff against adding a pluralization helper. Internal tool; not user-facing at scale.

## Build Process

### Git Strategy

**Full Agentic** — orchestrator commits after each slice that passes gates; runs through all slices without pausing for user review.

### Verification Commands

Run after every slice:

```
pnpm --filter @prd-assist/shared typecheck
pnpm --filter @prd-assist/server typecheck
pnpm --filter @prd-assist/server lint
pnpm --filter @prd-assist/server test
pnpm --filter @prd-assist/web typecheck
pnpm --filter @prd-assist/web lint
pnpm --filter @prd-assist/web test
pnpm --filter @prd-assist/web build
```

For non-web slices, running the `web` block is still required — it verifies the consuming types continue to compile against the updated shared schema.

### Work Process

#### Agent Roles

- **Orchestrator** (main session) — runs the workflow, manages agents, makes judgment calls on gate results and rival feedback.
- **Worker** (`worker`) — persistent across slices. Implements each slice. Carries context for consistency.
- **Code-quality-gate** (`code-quality-gate`) — disposable, single-use. Checks mechanical correctness, strictness, conventions, and integration seam soundness at component boundaries.
- **Spec-check-gate** (`spec-check-gate`) — disposable, single-use. Verifies implementation against spec requirements and checks whether code structure can achieve the Verification Scenarios.
- **System-coherence** (`system-coherence`) — persistent. Walks critical user scenarios across accumulated slices; surfaces broken handoffs, competing ownership, missing scenario steps, and operational surface gaps the walk exercises.
- **Rival** (`rival-work`) — persistent. Reads the spec and watches for broken assumptions. Delivers challenges at decision points.

#### Tracking Work

**One todo per slice. Not one todo per gate.** The slice lifecycle below is the work of completing a slice — it is not a checklist to track. Do not create separate todos for "run verification commands," "run code-quality-gate," "run spec-check," "rival checkpoint," "commit." That is ceremony noise that makes a routine slice look like seven items.

If you use a todo tool, the structure is:
- `Slice 1: <name>`
- `Slice 2: <name>`
- `Slice N: <name>`

Mark a slice in_progress when you start it and completed when its commit lands. The gates, rival checkpoints, and verification commands all happen between those two transitions — they are how you complete the slice, not separate trackable steps.

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

#### Gate Triggering Rules

**Code-quality-gate:** always, after every slice.

**System-coherence check:** after every behavior-changing slice. May skip for pure internal refactors confirmed by existing type checks or tests.

**Spec-check-gate:** at milestones only:
- After the first slice (early drift detection)
- After any slice that changes the public interface or observable behavior
- After the final slice (full spec alignment check)
- When the rival raises concerns about drift

#### Gate Failure Protocol

1. Read the full gate output — understand every finding.
2. Send findings to the worker with instructions to fix.
3. Spawn a **new** gate agent and re-check. Never reuse the same gate instance.
4. If the same issue persists across two fix attempts, investigate root cause before another attempt.

#### Escalation Rules

**Unverified risk escalation:** Track unverified risks across worker slice reports. If the same unverified risk (same category, same reason) appears in 3 or more consecutive slice reports, stop and escalate to the user. Present the risk, explain what verification requires, and offer three choices: (a) arrange the needed environment, (b) accept the risk explicitly, or (c) adapt the verification approach.

**Deferred coherence escalation:** If system-coherence re-raises a previously deferred concern, escalate to the user immediately — no second deferral. Cross-reference incoming concerns against the deferred ledger even if the "Previously deferred" field is absent.

#### Rival Checkpoint Timing

Call `rival-work` at:
- After the first slice (is direction matching the spec?)
- When implementation surprises you (something harder or different than expected)
- When scope wants to grow (are we still building what was specced?)
- Before the final gate pass (last chance to surface blind spots)

Rival output is challenges, not decisions. Weigh it, decide, proceed.

#### Spec Adaptation Protocol

When the worker, rival, or system-coherence agent surfaces a conflict between the spec and reality:

1. **Surface the conflict** — state what the spec assumed and what reality shows.
2. **Spawn `set-based`** (on-demand) to explore adaptation options. Scope it to the specific conflict.
3. **Challenge with `rival-work`** — share options, get pushback.
4. **Decide** — if one option is clearly better, take it. If the decision requires a user priority judgment (risk tolerance, timeline, preferences), present the tradeoff and deciding factor to the user.
5. **Update the spec** — modify affected sections, add an entry to the Adaptation Log (what changed, why, which slices are affected). The Adaptation Log is not optional.
6. **Continue** — next slice proceeds against the updated spec.

#### Completion Criteria

Work mode is complete when:
- All slices are implemented
- A final `spec-check-gate` runs against the full spec and passes
- All verification commands from the Verification Commands section run and pass
- All triggered gates were run (or skipped with explicit reason recorded)

Report completion with: what was built, what was verified, what Verification Scenarios were proven, and what adaptations were made to the spec during implementation.

## Verification Scenarios

### Scenario: Landing page structure — centered column, helper text, panel-bordered list

- **Given**: A running dev stack (`pnpm --filter @prd-assist/server dev` and `pnpm --filter @prd-assist/web dev`) with at least one session in storage.
- **When**: The user visits `http://localhost:5173/` in a desktop-width browser window (≥ 768px wide).
- **Then**: The page shows a full-width top header (`prd-assist` title + theme toggle). Below the header, a centered column no wider than `max-w-3xl` (768px) contains: (1) a helper-text paragraph with the elevator-pitch copy, (2) a right-aligned "New session" button, (3) a bordered/rounded panel containing the session list that fills the remaining vertical space. The outer page does not scroll; only the panel's internal list region scrolls when the list exceeds its bounds.
- **Runnable target**: composed product (`pnpm --filter @prd-assist/web dev` + `pnpm --filter @prd-assist/server dev`).

### Scenario: Session row shows expanded metadata

- **Given**: A session exists with 3 user messages sent and 2 PRD sections with `status === "confirmed"`, created 2 hours ago and last updated 10 minutes ago.
- **When**: The user visits `/`.
- **Then**: The row for that session shows three lines: title on line 1; `<8-char id suffix> · created 2h ago · updated 10m ago` on line 2; `3 exchanges · 2/7 confirmed` on line 3.
- **Runnable target**: composed product.

### Scenario: Hover reveals trash icon; keyboard focus reveals trash icon

- **Given**: The landing page is rendered with at least one session row.
- **When**: The user moves the mouse pointer over the row.
- **Then**: A trash icon button appears at the right edge of the row. The trash button is reachable via keyboard Tab even before hover, and focusing it via keyboard also reveals the icon visually.
- **Runnable target**: composed product.

### Scenario: Click trash → inline confirm cluster appears; row link is disabled

- **Given**: A landing page row is hovered, trash visible.
- **When**: The user clicks the trash icon.
- **Then**: The row's right side swaps to a `[Delete]` (red-tinted) button and a `[Cancel]` button. The row's title and metadata lines remain visible. Clicking anywhere on the row area does not navigate to the session. The `[Delete]` button has keyboard focus; pressing Escape cancels.
- **Runnable target**: composed product.

### Scenario: Cancel restores row idle state

- **Given**: A row is in the confirm state from the prior scenario.
- **When**: The user clicks `[Cancel]` (or presses Escape).
- **Then**: The row returns to idle: trash icon hidden (until hover/focus), `<Link>` navigation restored.
- **Runnable target**: composed product.

### Scenario: Delete succeeds; list refetches silently; row disappears without loading flash

- **Given**: A row is in the confirm state; the server has the session row in its database.
- **When**: The user clicks `[Delete]`.
- **Then**: The `[Delete]` button text changes to `"Deleting…"` and both confirm buttons disable. The client POSTs nothing; instead it issues `DELETE /api/sessions/:id` and receives `204 No Content`. The list refetches via `load("refresh")` — the existing `loaded` render state stays visible throughout (no "Loading sessions…" flash). The deleted row is absent from the next render.
- **Runnable target**: composed product.

### Scenario: Delete of unknown id is idempotent

- **Given**: A running server with no session `does-not-exist-id` in storage.
- **When**: A client issues `DELETE /api/sessions/does-not-exist-id`.
- **Then**: The server responds `204 No Content`. No error is returned. The session table is unchanged.
- **Runnable target**: composed product (`curl -X DELETE http://localhost:8787/api/sessions/does-not-exist-id -i` shows `HTTP/1.1 204`).

### Scenario: Delete fails on network error; inline error and retry

- **Given**: A row is in the deleting state; the network drops the DELETE request (simulate by stopping the server mid-flight, or use devtools offline mode).
- **When**: The fetch call rejects.
- **Then**: The confirm cluster swaps to an error state: red text `"Delete failed: <message>"`, a `[Retry]` button, and a `[Cancel]` button. Retry re-issues the DELETE. Cancel returns the row to idle.
- **Runnable target**: composed product (with manual network interruption).

### Scenario: Only one row can be in a delete state at a time

- **Given**: Row A is in confirm state.
- **When**: The user clicks the trash icon on row B.
- **Then**: Row A returns to idle, and row B enters confirm state. No two rows simultaneously show the confirm cluster.
- **Runnable target**: composed product.

### Scenario: Server derives `exchangeCount` correctly

- **Given**: A session with a `messages_json` containing 4 items — roles in order `user`, `assistant`, `user`, `assistant`.
- **When**: `GET /api/sessions` is called.
- **Then**: The returned summary for that session has `exchangeCount === 2`.
- **Runnable target**: isolated package (`pnpm --filter @prd-assist/server test`).

### Scenario: Server derives `sectionsConfirmed` correctly

- **Given**: A session whose PRD has 3 sections with `status === "confirmed"`, 2 with `status === "draft"`, 2 with `status === "empty"`.
- **When**: `GET /api/sessions` is called.
- **Then**: The returned summary for that session has `sectionsConfirmed === 3`.
- **Runnable target**: isolated package (`pnpm --filter @prd-assist/server test`).

### Scenario: Client schema validation rejects malformed server response

- **Given**: A server response for `GET /api/sessions` that is missing the new `exchangeCount` field on any row.
- **When**: The client calls `fetchSessions()`.
- **Then**: The `SessionListSchema.parse` throws; `SessionList` renders the error state with the zod error message and a Retry button.
- **Runnable target**: composed product (with a temporarily-broken server).

## Adaptation Log

(empty)

## Implementation Slices

### Slice 1: Expand `SessionSummary` shape across shared, server, and server tests

- What: R1 + R2. Update `packages/shared/src/types.ts` and `schemas.ts`. Update `apps/server/src/sessions.ts` (`sessionList` + `SessionSummaryRowSchema` or equivalent) to select and derive `createdAt`, `exchangeCount`, `sectionsConfirmed`. Update `apps/server/src/sessions.test.ts` to cover the derivation (two scenarios: `exchangeCount` and `sectionsConfirmed`). Existing web UI does not yet read the new fields — zod schema on the client validates the expanded shape, so no UI change; typecheck must remain green.
- Verify: `pnpm --filter @prd-assist/shared typecheck && pnpm --filter @prd-assist/server typecheck && pnpm --filter @prd-assist/server lint && pnpm --filter @prd-assist/server test && pnpm --filter @prd-assist/web typecheck && pnpm --filter @prd-assist/web lint && pnpm --filter @prd-assist/web test && pnpm --filter @prd-assist/web build` all pass.
- Outcome: `GET /api/sessions` returns the expanded summary fields end-to-end. Client compiles against the new schema.

### Slice 2: Add `DELETE /api/sessions/:id` route + `deleteSession` on the store + client `deleteSession`

- What: R3 + R4. Extend `SessionStore` interface in `apps/server/src/sessions.ts` with `deleteSession(id)`; implement using a new prepared statement. Add `app.delete("/api/sessions/:id", …)` in `apps/server/src/routes/sessions.ts`. Extend server tests (`sessions.test.ts` for store delete; `routes.test.ts` or the sessions-route test file for the HTTP route covering existing id, unknown id, invalid id). Add `deleteSession` to `apps/web/src/api.ts`.
- Verify: full verification-commands block passes. Additionally, `curl -X DELETE http://localhost:<server-port>/api/sessions/does-not-exist-id -i` returns `HTTP/1.1 204` (manual check during development).
- Outcome: a client can delete a session via the new endpoint. UI does not yet expose it.

### Slice 3: Landing layout — centered column, helper text, panel-bordered list

- What: R5. Restructure `apps/web/src/pages/SessionListPage.tsx`. Header unchanged. Add centered bounded-width flex column containing helper text paragraph, right-aligned new-session button, and bordered/rounded panel wrapping `<SessionList />`. The panel owns the scroll. Remove the old between-section `border-b` rules.
- Verify: full verification-commands block passes. Manual: visit `/`, confirm centered column at `max-w-3xl`, helper copy present, list scrolls inside its panel (shrink the window or add many sessions to test).
- Outcome: landing page has its new shape; rows still show only the old metadata.

### Slice 4: Session row — expanded metadata lines

- What: R6. Update `SessionList` → `SessionRow` to render the three-line layout: title, id-suffix + created + updated, `N exchanges · X/7 confirmed`. Use the new `SessionSummary` fields from slice 1. `pr-10` reserved for the trash affordance added in slice 5 but no trash yet.
- Verify: full verification-commands block passes. Manual: visit `/`, confirm each row shows three lines with correct values derived from a known test session.
- Outcome: users see richer per-row context on the landing.

### Slice 5: Delete affordance — hover-reveal trash, inline two-step confirm, silent refetch on success, inline error on failure

- What: R7 + R8. Add trash icon button absolutely positioned in each `<li>` (sibling of `<Link>`). Idle visibility via `group-hover` / `group-focus-within`. `pendingDelete` state in `SessionList`. Clicking trash suppresses the `<Link>` for that row (swap to `<div>`) and shows `[Delete] / [Cancel]` on the right. Delete click → deleting state (disabled buttons, `"Deleting…"` text) → `api.deleteSession` → on success `load("refresh")`, on failure swap to error state with `[Retry] / [Cancel]`. Esc cancels while confirm is open. Clicking trash on another row while one is pending auto-cancels the first.
- Verify: full verification-commands block passes. Manual: walk every scenario from Verification Scenarios section (hover reveal, keyboard tab, click trash, cancel, delete succeeds with silent refetch, delete with server stopped shows inline error + retry, two rows can't confirm simultaneously).
- Outcome: complete delete UX on the landing.

### Slice 6: Final verification

- What: Run the full verification-commands block a final time; run a manual dev-server walkthrough covering every Verification Scenario above. No new code unless the walkthrough surfaces a defect — defects are handled via adaptation protocol per the Work Process section.
- Verify: all Verification Scenarios pass. Full verification-commands block passes.
- Outcome: landing page refinement is shippable.

## Acceptance Criteria

- `grep -n 'exchangeCount\|sectionsConfirmed\|createdAt' packages/shared/src/types.ts` shows all three fields present on `SessionSummary`.
- `grep -n 'exchangeCount\|sectionsConfirmed\|createdAt' packages/shared/src/schemas.ts` shows all three fields present on `SessionSummarySchema`.
- `grep -n 'app.delete' apps/server/src/routes/sessions.ts` matches a `DELETE /api/sessions/:id` route handler.
- `grep -n 'deleteSession' apps/server/src/sessions.ts` matches a `deleteSession` method on `SessionStore`.
- `grep -n 'deleteSession' apps/web/src/api.ts` matches an exported `deleteSession` function.
- `curl -i -X DELETE http://localhost:<server-port>/api/sessions/<existing-id>` returns `HTTP/1.1 204` and the session is gone from `GET /api/sessions`.
- `curl -i -X DELETE http://localhost:<server-port>/api/sessions/nonexistent-id` returns `HTTP/1.1 204`.
- `pnpm --filter @prd-assist/server test` passes, including new assertions for `exchangeCount`, `sectionsConfirmed`, and `deleteSession`.
- `pnpm --filter @prd-assist/web typecheck && pnpm --filter @prd-assist/web lint && pnpm --filter @prd-assist/web test && pnpm --filter @prd-assist/web build` all pass.
- Visiting `/` in a browser shows the helper-text paragraph with the elevator-pitch copy, the session list inside a bordered/rounded panel constrained to `max-w-3xl`, and per-row metadata lines matching R6. The outer page does not scroll; only the list panel scrolls internally.
- Hovering a row reveals a trash button; tabbing into the row reveals the trash button without hover; clicking it swaps the row right-side to `[Delete] / [Cancel]`; Delete performs the request and the row disappears after a silent refetch; Cancel returns the row to idle; an induced delete failure shows the inline error + retry state.
