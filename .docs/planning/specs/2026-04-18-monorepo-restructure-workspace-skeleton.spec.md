# Monorepo Restructure — Workspace Skeleton

## Project Status
refactor

## Parent Reference
- Kind: plan
- Plan: `../plans/2026-04-18-monorepo-restructure.plan.md`
- Slice: workspace-skeleton
- Boundary: Root `package.json` `dependencies`, `devDependencies` (except the `turbo` addition), `scripts`, and `pnpm.onlyBuiltDependencies` are UNCHANGED. No application source moves. No directories created under `apps/` or `packages/`. Existing `src/` tree continues to run via unchanged legacy `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm typecheck`.
- Inherited constraints:
  - Shared Foundation (runtime, language, package manager, module system, workspace naming, directory structure, dev runner, test runner, shared-package consumption model) from plan
  - Migration Invariants apply — dev runs, build runs, tests pass, typecheck green, no orphaned processes at end of slice
  - Cross-system scenario "dev environment survives every slice boundary" applies to this slice's completion state

## Intent
Install monorepo plumbing — pnpm workspaces, Turborepo, a shared tsconfig base, Node version pin, and expanded `.gitignore` — without touching a line of application source. After this slice, the existing single-package dev workflow still works exactly as before, and the workspace layout is ready for subsequent slices to promote `packages/shared` and the three apps.

## Scope

### In Scope
- Create `pnpm-workspace.yaml` with `apps/*` and `packages/*` globs
- Create `turbo.json` with pre-declared tasks (`dev`, `build`, `typecheck`, `test`, `lint`) that will activate as workspace packages ship
- Create `tsconfig.base.json` — extends of strict compiler settings from current root `tsconfig.json` minus `module`, `moduleResolution`, and `types`; those are per-package concerns
- Create `.nvmrc` pinning Node to `20.11`
- Add `turbo` to root `devDependencies` via `pnpm add -Dw turbo`
- Update root `.gitignore` to cover `data/`, `.turbo/`, `apps/*/dist/`, `packages/*/dist/`
- Untrack `data/` from git via `git rm --cached -r data/` (data sqlite is currently tracked; `.gitignore` alone won't remove it from the index)
- Verify all five Migration Invariants hold at end of slice

### Out of Scope
- Any change to `apps/` or `packages/` directories (they do not exist yet)
- Any change to existing root `package.json` scripts, dependencies, or devDependencies — other than the single `turbo` addition
- Deleting root `vite.config.ts`, `vitest.config.ts`, `postcss.config.js`, `tailwind.config.js`, `.eslintrc.cjs`, `.prettierrc`, or `tsconfig.json` — they remain until their owning slices ship
- Moving `scripts/doc-edit-check.ts`
- Changing `pnpm.onlyBuiltDependencies` (stays with `better-sqlite3` and `esbuild` until slice 4)
- Wiring any turbo task to an actual workspace package (no workspace packages exist yet in this slice)
- CI configuration
- Deleting any file inside `data/` from the working tree — only the git index is touched (`git rm --cached -r data/`). The actual sqlite file stays on disk; the dev server keeps using it

## Implementation Constraints

### Architecture
Plumbing-only slice. No source code writes, no source code reads. File additions are the entire deliverable. Legacy scripts at root remain authoritative — the existing `pnpm dev` is the developer's dev command at end of slice. Turbo is installed but no task runs against any package yet (no packages exist).

### Boundaries
- `turbo.json` `tasks` object pre-declares all five task names (`dev`, `build`, `typecheck`, `test`, `lint`) so later slices add workspace scripts without modifying task shape. Tasks that should not be cached in later slices have `cache: false` set now: `dev` (persistent), `test` (better-sqlite3 ABI not capturable as turbo input — see plan Accepted Risks).
- `tsconfig.base.json` does NOT set `module` or `moduleResolution`. Per-package tsconfigs set those (nodenext for server/mcp, bundler for web). Base sets only the strict compiler flags that apply universally.
- `.gitignore` entries are additive. Do not remove, reorder, or reformat existing entries.
- `.nvmrc` pins a version compatible with current `engines.node: ">=20.11"`.

### Testing Approach
No tests authored in this slice. Verification is structural: file existence, content match, command exit codes. The Migration Invariants check (running `pnpm dev` and hitting `/api/health`) acts as an integration smoke verification.

### Naming
- File paths are literal and case-sensitive: `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.nvmrc`, `.gitignore`.
- Package name prefix (for later slices): `@prd-assist/*`. Not introduced in this slice but pre-reserved by the `packages` glob in `pnpm-workspace.yaml`.

## Requirements

### `pnpm-workspace.yaml`
Exact contents:
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### `turbo.json`
Exact contents:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "dev": {
      "cache": false,
      "persistent": true
    },
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "typecheck": {
      "dependsOn": ["^typecheck"]
    },
    "test": {
      "cache": false,
      "dependsOn": ["^build"]
    },
    "lint": {}
  }
}
```

Notes pinned for the worker:
- `dev.cache: false` + `dev.persistent: true` — turbo requires these for long-running watchers
- `build.dependsOn: ["^build"]` — consumers wait on dependency builds when they eventually exist
- `test.cache: false` — addresses better-sqlite3 ABI cache-poisoning accepted risk from plan
- `test.dependsOn: ["^build"]` — safe even when no package has `build`, activates later
- `lint: {}` — no dependencies, no caching constraints

### `tsconfig.base.json`
Exact contents:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "allowImportingTsExtensions": false,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

Deliberately omitted from base (per-package owns these):
- `module`
- `moduleResolution`
- `jsx`
- `types`
- `lib`
- `noEmit`
- `outDir`
- `rootDir`
- `include` / `exclude`

Root `tsconfig.json` remains unchanged in this slice — it is the authoritative config until slice 5 deletes it.

### `.nvmrc`
Exact contents (no trailing characters other than newline):
```
20.11
```

### Root `.gitignore` update
Append the following lines to the existing `.gitignore`. Do not remove, reorder, or modify existing entries. Ensure each new entry is on its own line and the file ends with a newline.

```
data/
.turbo/
apps/*/dist/
packages/*/dist/
```

Current `.gitignore` at time of spec authoring is 43 bytes — worker must read it first and append, not overwrite.

### Root `package.json` — single change
Add `turbo` to `devDependencies` via `pnpm add -Dw turbo`. Accept whatever caret version pnpm resolves. No other changes — `scripts`, `dependencies`, `pnpm.onlyBuiltDependencies`, `engines`, and existing `devDependencies` are untouched.

## Rejected Alternatives
- **Empty `turbo.json` tasks object**: Rejected. Turbo 2.x accepts empty tasks but later slices would need to modify `turbo.json` shape repeatedly — pre-declaring the five tasks now means later slices only add workspace scripts, not schema changes.
- **Use `.node-version` instead of `.nvmrc`**: Rejected. Both files are supported by most version managers; `.nvmrc` matches the pnpm/Node.js community default and is unambiguous. If the user adopts a `.node-version`-only tool later, adding it is trivial.
- **Pin Node via `engines` only (no `.nvmrc`)**: Rejected. `engines` is a soft constraint pnpm warns on but doesn't enforce; `.nvmrc` signals intent to version-manager tooling (nvm, fnm, volta) and to CI. Plan Shared Foundation locked Node ≥ 20.11; `.nvmrc` makes the exact target version explicit.
- **Add `packageManager` field to root `package.json` pinning pnpm version**: Rejected as scope creep. `engines.pnpm: ">=9"` already documents the requirement. Adopt `packageManager` if and when a version mismatch causes real pain.
- **Move `scripts/doc-edit-check.ts` into a `tools/` workspace package**: Rejected. Plan locked script stays at root with `tsx` as root devDep. Adding a `tools/*` workspace glob now would add surface area this slice does not need.

## Accepted Risks
- **`turbo` transitive installs may trigger native-binary builds**: Turbo ships Rust binaries via npm optional deps. `pnpm install` may be slower on first install. Acceptable; no action.
- **Pre-declared tasks reference dependencies that don't exist yet**: `build.dependsOn: ["^build"]` and `test.dependsOn: ["^build"]` reference a task no package owns yet. Turbo treats unknown task references as no-ops when no package matches — verified by spec's verification commands. If turbo errors on empty topo, fallback is to remove `dependsOn` in this slice and re-add per-consumer in slices 2+.
- **`git rm --cached -r data/` removes sqlite from the index but the working file persists**: After commit, the sqlite file remains on disk and the dev server reads/writes it normally. New clones will not include the sqlite file — developers regenerate it on first dev run. Acceptable: the sqlite is dev/local state, not source of truth.

## Build Process

### Git Strategy
**Full HITL** — AI does not commit. After each slice passes gates, AI pauses and hands control to the user to commit manually before the next slice begins. Applies to slice 1 only. Slices 2–5 use **Full Agentic** (see Adaptation Log entry 2026-04-19 — git strategy changed to Full Agentic for slices 2–5).

Locked details:
- **Branch model:** Direct on `main`. No feature branches, no long-lived refactor branch.
- **PR model:** No PRs. User commits directly to `main` after each slice's gates pass.
- **Merge style:** Not applicable — no merges.
- **Commits per slice:** Exactly one commit per slice. Worker may produce many file changes during the slice; user squashes/stages all into a single commit at the slice boundary.
- **Tags:** None. Slices identified by commit SHA only.
- **Commit message convention:** Slice-numbered prefix. Format: `[slice-N] <imperative summary>`. Example for this slice: `[slice-1] add pnpm workspace and turbo skeleton`. The body (if any) explains the *why* if non-obvious; otherwise omit.

AI workflow at slice boundary:
1. Worker reports slice complete; verification commands have passed; gates have passed.
2. AI prints a one-line slice summary and the proposed commit message in the slice-numbered format.
3. AI prints the working-tree diff summary (`git status --short` equivalent) so user can see what will be staged.
4. AI hands control to user. AI does NOT run `git add`, `git commit`, or any git mutation command.
5. User reviews, stages, commits, and signals "next slice" before AI proceeds to slice 2.

### Verification Commands
Run from repo root. All must succeed at end of slice.

```bash
# Structural checks — files exist and contents match spec
test -f pnpm-workspace.yaml
test -f turbo.json
test -f tsconfig.base.json
test -f .nvmrc
grep -q "^data/$" .gitignore
grep -q "^\\.turbo/$" .gitignore
grep -q "^apps/\\*/dist/$" .gitignore
grep -q "^packages/\\*/dist/$" .gitignore

# Turbo installed and invokable
pnpm turbo --version

# Migration Invariants — all must hold
pnpm install                           # resolves, no errors
pnpm typecheck                         # legacy tsconfig still passes
pnpm test                              # all existing tests pass
pnpm build                             # legacy build still produces dist/
# pnpm dev                             # manual — must launch, serve web UI, and respond 200 on GET /api/health
```

For `pnpm dev`: orchestrator runs `pnpm dev` in background, polls `http://127.0.0.1:5174/api/health` every 500ms up to 10s, asserts 200 + `{"ok": true}`, then sends SIGINT and confirms no orphaned MCP child process via `pgrep -f "src/mcp/index.ts"` returning empty after 2s.

### Work Process

This is the canonical implementation workflow for EBT work mode. It is embedded here so any agent picking up this spec has the full workflow without needing to load ebt-work-mode separately.

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

### Scenario: skeleton installed, legacy dev still runs
- **Given**: A clean checkout at HEAD before slice 1. Working tree clean. `pnpm install` has been run.
- **When**: Slice 1 is implemented per this spec. `pnpm install` runs again. `pnpm dev` is launched from repo root.
- **Then**: `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, and `.nvmrc` exist at repo root with exact contents specified in Requirements. `.gitignore` contains the four new lines. `pnpm turbo --version` exits 0. `pnpm dev` launches both server (`tsx watch src/server/index.ts`) and web (`vite`) within 10 seconds. `GET http://127.0.0.1:5174/api/health` returns HTTP 200 with body `{"ok": true}`. Server responds to a `POST /api/sessions` with 201. After SIGINT, `pgrep -f "src/mcp/index.ts"` returns empty within 2 seconds.

### Scenario: turbo recognizes workspace
- **Given**: Slice 1 is implemented.
- **When**: From repo root, run `pnpm turbo run typecheck`.
- **Then**: Turbo exits 0. Output indicates "no tasks to run" or "0 successful" — no workspace package owns a `typecheck` task yet, so turbo finds nothing to execute. No error about malformed `turbo.json` or missing workspace globs.

### Scenario: existing workflows unaffected
- **Given**: Slice 1 is implemented.
- **When**: Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm lint` sequentially.
- **Then**: Each command exits 0. `pnpm test` runs the existing `src/**/*.test.ts` tests and all pass. `pnpm build` produces `dist/` via the legacy `tsc -p tsconfig.json && vite build` script.

## Adaptation Log

### 2026-04-19 — Git strategy changed to Full Agentic for slices 2–5
- **Conflict:** Spec locked Full HITL for all 5 slices. After slice 1 shipped under Full HITL (commit `99a0bfa`), user directed switch to **Full Agentic** for the remainder.
- **Change:** Git Strategy section now scopes Full HITL to slice 1 only. Slices 2–5 will be authored as separate specs declaring **Full Agentic** — AI commits after every slice that passes gates, no pause for user review between slices. Commit message convention `[slice-N] <imperative>` and direct-on-`main`, no-PR, one-commit-per-slice locks remain in force.
- **Affects:** All future slices in the monorepo-restructure plan.

### 2026-04-19 — `packageManager` field added to root `package.json`
- **Conflict:** Spec rejected adding `packageManager` as scope creep. Reality: turbo 2.9.6 fails with `Could not resolve workspaces. Missing 'packageManager' field in package.json` and refuses to run any task — meaning the spec's "turbo recognizes workspace" verification scenario cannot pass without it.
- **Change:** Added `"packageManager": "pnpm@10.33.0"` to root `package.json` (matches the pnpm version currently in use). Acceptance criterion that diffs `package.json` to "only an added `turbo` line" is updated to also allow the `packageManager` line.
- **Affects:** Slice 1 only. Subsequent slices benefit (corepack-driven pnpm version pinning) at no cost.

### 2026-04-19 — `git rm --cached -r data/` removed from slice
- **Conflict:** Spec assumed `data/` was tracked. Reality: existing `.gitignore` already contains `data` (matches both file and dir), and `git ls-files data/` returns empty — nothing is tracked to untrack.
- **Change:** Removed `git rm --cached -r data/` from In Scope and Slice 1 What/Verify. Removed the related Accepted Risk. Removed the `git ls-files data/` acceptance criterion (already satisfied at HEAD). Kept the `data/` `.gitignore` addition (redundant with existing `data` but harmless and explicit per spec).
- **Affects:** Slice 1 only.

## Implementation Slices

### Slice 1: skeleton-installed
- What: Create `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.nvmrc` with exact contents from Requirements. Append four lines to `.gitignore`. Run `pnpm add -Dw turbo`. Run `git rm --cached -r data/` to untrack the data directory (working tree files persist). Re-run `pnpm install`. No source files touched.
- Verify: Run all commands from Verification Commands section in order; all must exit 0 (or produce the explicit expected output for the manual `pnpm dev` check). All three Verification Scenarios pass. `git ls-files data/` returns empty.
- Outcome: Repo is a pnpm workspace. Turbo is installed and recognizes the workspace layout. `data/` no longer tracked. No `apps/*` or `packages/*` packages exist yet, so turbo has nothing to orchestrate — but the plumbing is in place for slice 2 to add `packages/shared` without any further skeleton work. Legacy `pnpm dev` behaves identically to pre-slice.

## Acceptance Criteria
- `pnpm-workspace.yaml` exists with content byte-identical to Requirements spec, verified by `diff <(cat pnpm-workspace.yaml) <(printf 'packages:\n  - '\\''apps/*'\\''\n  - '\\''packages/*'\\''\n')` exiting 0.
- `turbo.json` exists; `pnpm turbo --version` exits 0; `pnpm turbo run typecheck` exits 0 with no task execution (no workspace packages own typecheck yet).
- `tsconfig.base.json` exists with content byte-identical to Requirements spec. Does NOT contain `module`, `moduleResolution`, `jsx`, `types`, `lib`, `noEmit`, `outDir`, `rootDir`, `include`, or `exclude` keys — verified by `node -e "const c=require('./tsconfig.base.json').compilerOptions; const forbidden=['module','moduleResolution','jsx','types','lib','noEmit','outDir','rootDir']; process.exit(forbidden.some(k=>k in c)?1:0)"` exiting 0.
- `.nvmrc` contains exactly `20.11\n`.
- `.gitignore` contains lines `data/`, `.turbo/`, `apps/*/dist/`, `packages/*/dist/`; all original pre-slice lines remain present and in original order.
- Root `package.json` `devDependencies` contains `turbo`. `scripts`, `dependencies`, `pnpm.onlyBuiltDependencies`, `engines`, and all other existing `devDependencies` entries are byte-identical to pre-slice — verified by `git diff HEAD~1 -- package.json` showing only an added `turbo` line in `devDependencies` (and corresponding `pnpm-lock.yaml` churn).
- `pnpm install` exits 0 on the final state.
- `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm lint` each exit 0 on the final state.
- `pnpm dev` launches the server and web, `GET /api/health` returns 200, and `Ctrl-C` leaves zero orphaned MCP child processes after 2 seconds — verified manually by orchestrator before slice commit.
- No files exist under `apps/` or `packages/` (the directories themselves do not exist either).
- No files were modified under `src/`.
- `git ls-files data/` returns empty (data directory untracked).
- The `data/` working-tree directory and its contents (e.g., `data/prd-assist.sqlite` if present) remain on disk untouched — only the git index changed.
