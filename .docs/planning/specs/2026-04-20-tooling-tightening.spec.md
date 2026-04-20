# Tooling Tightening (ESLint, Prettier, TypeScript)

## Project Status

refactor

## Intent

Tighten ESLint, Prettier, and TypeScript configuration across the pnpm monorepo so correctness bugs (floating promises, misused promises, non-exhaustive switches, unnecessary conditionals) fail at lint time, formatting is deterministic, and the half-built turbo `lint` task actually runs. The existing root-config pattern is preserved — this work fixes and hardens what is already there, it does not restructure the monorepo into shared config packages.

## Scope

### In Scope

- Add type-aware and correctness rules to root `.eslintrc.cjs`.
- Add a `react-hooks` override for `apps/web`.
- Add `no-console` relaxation override for `scripts/**` and `**/*.test.ts`.
- Set explicit Prettier opinions in root `.prettierrc`.
- Add `.prettierignore`.
- Add root `format` and `format:check` scripts.
- Run a one-time Prettier formatting sweep committed separately from the config change.
- Add per-package `lint` scripts to every workspace package (`apps/server`, `apps/mcp`, `apps/web`, `packages/shared`).
- Change the root `lint` script to run through Turbo.
- Consolidate duplicated TypeScript compiler options (`module`, `moduleResolution`, `noEmit`, `rootDir`) from per-package tsconfigs into `tsconfig.base.json`. `apps/web`'s `module: "ESNext"` override remains in its per-package tsconfig.
- Add stricter TypeScript options to `tsconfig.base.json`: `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, `isolatedModules`, `verbatimModuleSyntax`, `allowUnreachableCode: false`, `allowUnusedLabels: false`.
- Update root `tsconfig.json` to extend `tsconfig.base.json` instead of duplicating it.

### Out of Scope

- Migrating ESLint from 8.57 flat-legacy config to ESLint 9 flat config.
- Extracting shared configuration into workspace packages (`@prd-assist/eslint-config`, `@prd-assist/tsconfig`, `@prd-assist/prettier-config`).
- Adding `eslint-plugin-import` or `eslint-plugin-react` (the non-hooks plugin).
- Enabling `@typescript-eslint/strict-boolean-expressions`.
- Enabling `noPropertyAccessFromIndexSignature`.
- Adding CI wiring (GitHub Actions, pre-commit hooks, husky). Configuration only.
- Changing test framework configuration.
- Refactoring any application code beyond what the new rules require.

## Implementation Constraints

### Architecture

Monorepo shape is unchanged. Root-level `.eslintrc.cjs`, `.prettierrc`, and `tsconfig.base.json` remain the single sources of configuration. Per-package `tsconfig.json` files continue to extend `tsconfig.base.json`. Per-package `package.json` files gain a `lint` script but no per-package ESLint config file. The existing `turbo.json` `lint` task declaration becomes functional once per-package `lint` scripts exist.

### Boundaries

No runtime boundaries change. All modifications are to build-time tooling configuration and `package.json` script declarations. No application source code is modified except as required to pass new lint rules and TypeScript options.

### Testing Approach

Verification is static: `pnpm typecheck` and `pnpm lint` must both exit 0 at the end of every slice. No new tests are added. Existing tests must continue to pass. When a new lint rule fires on existing code, the fix is applied in the same slice that enables the rule — failing lint is never carried across slices.

### Naming

- `format` — the script that writes formatting changes in place.
- `format:check` — the script that fails if formatting is not already applied.
- `lint` — the per-package script that runs ESLint against that package's `src` with `--max-warnings=0`.

## Requirements

### ESLint Rules (root `.eslintrc.cjs`, applied to all TypeScript files)

Add the following rules at `error` severity unless otherwise specified:

- `@typescript-eslint/no-floating-promises`
- `@typescript-eslint/no-misused-promises`
- `@typescript-eslint/require-await`
- `@typescript-eslint/return-await`: `["error", "always"]`
- `@typescript-eslint/consistent-type-imports`
- `@typescript-eslint/no-unnecessary-condition`
- `@typescript-eslint/switch-exhaustiveness-check`
- `@typescript-eslint/no-explicit-any`
- `@typescript-eslint/no-non-null-assertion`
- `@typescript-eslint/prefer-nullish-coalescing`
- `@typescript-eslint/prefer-optional-chain`
- `eqeqeq`: `["error", "always"]`
- `no-console`: `["warn", { "allow": ["warn", "error"] }]`

Preserve the existing `@typescript-eslint/no-unused-vars` rule with its `argsIgnorePattern: "^_"` and `varsIgnorePattern: "^_"` options.

### ESLint Overrides

Root `.eslintrc.cjs` must include two `overrides` entries:

1. `files: ["apps/web/**/*.{ts,tsx}"]` — adds `eslint-plugin-react-hooks` plugin with `react-hooks/rules-of-hooks: "error"` and `react-hooks/exhaustive-deps: "warn"`.
2. `files: ["scripts/**/*.ts", "**/*.test.ts", "**/*.test.tsx"]` — sets `no-console: "off"`.

### ESLint Dependencies

Install `eslint-plugin-react-hooks` as a dev dependency at the repo root.

### Prettier Configuration (root `.prettierrc`)

```
{
  "printWidth": 100,
  "singleQuote": false,
  "trailingComma": "all",
  "semi": true,
  "arrowParens": "always"
}
```

### Prettier Ignore (root `.prettierignore`)

```
node_modules
dist
.turbo
pnpm-lock.yaml
```

### Root Scripts (root `package.json`)

Add:

- `"format": "prettier --write ."`
- `"format:check": "prettier --check ."`

Change existing root `lint` script from the direct `eslint` invocation to `"lint": "turbo lint && eslint scripts --max-warnings=0"`. Turbo lints each workspace package; the trailing `eslint scripts` pass lints the root `scripts/` directory, which is not a workspace package and therefore not reachable via turbo.

Change existing root `typecheck` script from `"turbo typecheck"` to `"turbo typecheck && tsc --noEmit -p tsconfig.json"`. Turbo typechecks each workspace package; the trailing `tsc` pass typechecks the root `tsconfig.json` (covering `scripts/`), which is not a workspace package.

### Per-Package Lint Scripts

Each of the following `package.json` files gains a `"lint": "eslint src --max-warnings=0"` script:

- `apps/server/package.json`
- `apps/mcp/package.json`
- `apps/web/package.json`
- `packages/shared/package.json`

### TypeScript Base Configuration (`tsconfig.base.json`)

The base must be the single source of shared compiler options. After the change, the file contains:

- Existing: `target: "ES2022"`, `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `allowImportingTsExtensions: false`, `resolveJsonModule: true`, `esModuleInterop: true`, `forceConsistentCasingInFileNames: true`, `skipLibCheck: true`.
- Added: `module: "ES2022"`, `moduleResolution: "bundler"`, `noEmit: true`, `rootDir: "${configDir}/src"`, `noImplicitReturns: true`, `noFallthroughCasesInSwitch: true`, `noImplicitOverride: true`, `isolatedModules: true`, `verbatimModuleSyntax: true`, `allowUnreachableCode: false`, `allowUnusedLabels: false`.

  `rootDir` uses the TypeScript 5.5+ `${configDir}` template so each extending per-package config resolves `rootDir` relative to its own location. A literal `"src"` in the base would resolve against the base's own directory (repo root), which is not a parent of any package `src/`.

### TypeScript Per-Package Configuration

After consolidation, each per-package `tsconfig.json` only declares options that differ from the base or that the base cannot express:

- `apps/server/tsconfig.json`: `extends: "../../tsconfig.base.json"`, `types: ["node"]`, `include: ["src"]`.
- `apps/mcp/tsconfig.json`: `extends: "../../tsconfig.base.json"`, `types: ["node"]`, `include: ["src"]`.
- `apps/web/tsconfig.json`: `extends: "../../tsconfig.base.json"`, `module: "ESNext"`, `jsx: "react-jsx"`, `types: ["vite/client"]`, `include: ["src"]`.
- `packages/shared/tsconfig.json`: `extends: "../../tsconfig.base.json"`, `include: ["src"]`.

### Root TypeScript Configuration (`tsconfig.json`)

Must extend `tsconfig.base.json`. Declares `rootDir: "${configDir}"`, `types: ["node"]`, and `include: ["scripts/**/*.ts"]`. `jsx` is removed — it does not apply to `scripts/`. The `rootDir` override resolves to the repo root because (a) the inherited base value `"${configDir}/src"` resolves to `<repo>/src` at the root config location, which does not exist, and (b) `scripts/doc-edit-check.ts` legitimately imports from `apps/server/src/*` (integration harness), so `rootDir` must span both directories — repo root is the common ancestor.

### Formatting Sweep

A single Prettier write pass across the repository is executed after the Prettier config is applied. This sweep is committed in its own commit, separate from the config commit, with a message identifying it as a formatting-only change.

## Invariants

- `pnpm typecheck` exits 0 at the end of every slice.
- `pnpm lint` exits 0 at the end of every slice.
- `pnpm test` exits 0 at the end of every slice.
- No runtime behavior of any application changes. No file under `apps/*/src/**` or `packages/*/src/**` changes except as required by the new lint rules and TypeScript options.
- The monorepo continues to use a single root ESLint config, a single root Prettier config, and a single TypeScript base config.

## Boundaries

Changing:

- `.eslintrc.cjs`
- `.prettierrc`
- `.prettierignore` (new file)
- `tsconfig.base.json`
- `tsconfig.json`
- `apps/server/tsconfig.json`
- `apps/mcp/tsconfig.json`
- `apps/web/tsconfig.json`
- `packages/shared/tsconfig.json`
- `package.json` (root)
- `apps/server/package.json`
- `apps/mcp/package.json`
- `apps/web/package.json`
- `packages/shared/package.json`
- Source files under `apps/*/src/**`, `packages/*/src/**`, and `scripts/**` only where required to satisfy new lint rules or TypeScript options.

Not changing:

- `turbo.json` — already declares a `lint` task that will start functioning once per-package scripts exist.
- `pnpm-workspace.yaml`.
- `vitest.config.ts` files.
- `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`.
- Any CI configuration.
- Any runtime source that does not violate the new rules.

## Rejected Alternatives

- **Extract shared config packages (`@prd-assist/eslint-config`, `@prd-assist/tsconfig`, `@prd-assist/prettier-config`)**: Adds three config packages to a four-package workspace. The current root-config-with-extends pattern already works at this scale; extracting adds publish/version ceremony without solving a real problem.
- **Migrate to ESLint 9 flat config**: Requires simultaneously upgrading `@typescript-eslint` v7 → v8 and rewriting the config format. Separate project; out of scope for tightening existing rules.
- **Enable `@typescript-eslint/strict-boolean-expressions`**: High friction on existing idiomatic TypeScript (e.g. `if (value)` on optional strings). `no-unnecessary-condition` catches the real bugs without forcing broad rewrites.
- **Enable `noPropertyAccessFromIndexSignature`**: Conflicts with record-typed access patterns already used in the codebase.
- **Add `eslint-plugin-import`**: Bundler handles resolution. The import-order rules are stylistic and Prettier plus `consistent-type-imports` cover the enforceable wins.
- **Add `eslint-plugin-react` (non-hooks)**: The project uses the new JSX transform; the rules this plugin provides are either obsolete under the new transform or stylistic.
- **Per-package ESLint configs**: Root-only config with file-pattern overrides is sufficient at this scale and keeps a single source of truth.

## Accepted Risks

- **Formatting sweep diff is large**: A one-time Prettier sweep across the repo produces a large churn diff. Mitigated by committing it separately from the config change so the diff is easy to read and review.
- **`verbatimModuleSyntax` and `isolatedModules` may flag existing non-type imports**: Slice 3's `consistent-type-imports` autofix runs before Slice 4 enables `verbatimModuleSyntax`, so the type-only imports are rewritten first. Residual failures are fixed in Slice 4 as part of landing it green.
- **`no-unnecessary-condition` may flag guards that were deliberately defensive**: Any genuine false positives are fixed by removing the unnecessary guard, not by disabling the rule.
- **New ESLint rules may require touching application source**: Fixes are applied in the same slice that enables the rule, keeping the slice green before the next one starts.

## Build Process

### Git Strategy

**Full Agentic** — AI commits after every slice that passes gates; runs through all slices without stopping for user review.

See `skills/spec-creator/references/git-strategies.md` for the four canonical strategies and their digraphs.

### Verification Commands

```
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

`pnpm format:check` applies only from Slice 1 onward (after the Prettier config exists and the formatting sweep has landed).

### Work Process

## Agent Roles

- **Orchestrator** (main session) — runs the workflow, manages agents, makes judgment calls on gate results and rival feedback.
- **Worker** (`worker`) — persistent across slices. Implements each slice. Carries context for consistency.
- **Code-quality-gate** (`code-quality-gate`) — disposable, single-use. Checks mechanical correctness, strictness, conventions, and integration seam soundness at component boundaries.
- **Spec-check-gate** (`spec-check-gate`) — disposable, single-use. Verifies implementation against spec requirements and checks whether code structure can achieve the Verification Scenarios.
- **System-coherence** (`system-coherence`) — persistent. Walks critical user scenarios across accumulated slices; surfaces broken handoffs, competing ownership, missing scenario steps, and operational surface gaps the walk exercises.
- **Rival** (`rival-work`) — persistent. Reads the spec and watches for broken assumptions. Delivers challenges at decision points.

---

## Tracking Work

**One todo per slice. Not one todo per gate.** The slice lifecycle below is the work of completing a slice — it is not a checklist to track. Do not create separate todos for "run verification commands," "run code-quality-gate," "run spec-check," "rival checkpoint," "commit." That is ceremony noise that makes a routine slice look like seven items.

If you use a todo tool, the structure is:

- `Slice 1: <name>`
- `Slice 2: <name>`
- `Slice N: <name>`

Mark a slice in_progress when you start it and completed when its commit lands. The gates, rival checkpoints, and verification commands all happen between those two transitions — they are how you complete the slice, not separate trackable steps.

---

## Slice Lifecycle

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

## Gate Triggering Rules

**Code-quality-gate:** always, after every slice.

**System-coherence check:** after every behavior-changing slice. May skip for pure internal refactors confirmed by existing type checks or tests.

**Spec-check-gate:** at milestones only:

- After the first slice (early drift detection)
- After any slice that changes the public interface or observable behavior
- After the final slice (full spec alignment check)
- When the rival raises concerns about drift

---

## Gate Failure Protocol

1. Read the full gate output — understand every finding.
2. Send findings to the worker with instructions to fix.
3. Spawn a **new** gate agent and re-check. Never reuse the same gate instance.
4. If the same issue persists across two fix attempts, investigate root cause before another attempt.

---

## Escalation Rules

**Unverified risk escalation:** Track unverified risks across worker slice reports. If the same unverified risk (same category, same reason) appears in 3 or more consecutive slice reports, stop and escalate to the user. Present the risk, explain what verification requires, and offer three choices: (a) arrange the needed environment, (b) accept the risk explicitly, or (c) adapt the verification approach.

**Deferred coherence escalation:** If system-coherence re-raises a previously deferred concern, escalate to the user immediately — no second deferral. Cross-reference incoming concerns against the deferred ledger even if the "Previously deferred" field is absent.

---

## Rival Checkpoint Timing

Call `rival-work` at:

- After the first slice (is direction matching the spec?)
- When implementation surprises you (something harder or different than expected)
- When scope wants to grow (are we still building what was specced?)
- Before the final gate pass (last chance to surface blind spots)

Rival output is challenges, not decisions. Weigh it, decide, proceed.

---

## Spec Adaptation Protocol

When the worker, rival, or system-coherence agent surfaces a conflict between the spec and reality:

1. **Surface the conflict** — state what the spec assumed and what reality shows.
2. **Spawn `set-based`** (on-demand) to explore adaptation options. Scope it to the specific conflict.
3. **Challenge with `rival-work`** — share options, get pushback.
4. **Decide** — if one option is clearly better, take it. If the decision requires a user priority judgment (risk tolerance, timeline, preferences), present the tradeoff and deciding factor to the user.
5. **Update the spec** — modify affected sections, add an entry to the Adaptation Log (what changed, why, which slices are affected). The Adaptation Log is not optional.
6. **Continue** — next slice proceeds against the updated spec.

---

## Completion Criteria

Work mode is complete when:

- All slices are implemented
- A final `spec-check-gate` runs against the full spec and passes
- All verification commands from the Verification Commands section run and pass
- All triggered gates were run (or skipped with explicit reason recorded)

Report completion with: what was built, what was verified, what Verification Scenarios were proven, and what adaptations were made to the spec during implementation.

## Verification Scenarios

### Scenario: Root lint delegates through Turbo

- **Given**: The repository with the spec fully applied.
- **When**: The developer runs `pnpm lint` from the repo root.
- **Then**: Turbo invokes each workspace package's `lint` script (`apps/server`, `apps/mcp`, `apps/web`, `packages/shared`), each script runs `eslint src --max-warnings=0`, and the overall command exits 0 with no lint errors.
- **Runnable target**: composed product — `pnpm lint`.

### Scenario: Formatting is enforceable

- **Given**: The repository with the spec fully applied.
- **When**: The developer runs `pnpm format:check`.
- **Then**: The command exits 0 because the formatting sweep already normalized the repo.
- **Runnable target**: composed product — `pnpm format:check`.

### Scenario: Floating promises are rejected

- **Given**: A temporary TypeScript file placed under `apps/server/src/` that calls an `async` function without `await`, without `void`, and without `.catch`.
- **When**: `pnpm lint` runs.
- **Then**: ESLint reports a `@typescript-eslint/no-floating-promises` error on that call and exits non-zero. (The temporary file is removed after verification.)
- **Runnable target**: composed product — `pnpm lint`.

### Scenario: Non-exhaustive switches are rejected

- **Given**: A temporary TypeScript file placed under `apps/server/src/` that `switch`es on a discriminated union and omits one member with no `default` branch.
- **When**: `pnpm lint` runs.
- **Then**: ESLint reports a `@typescript-eslint/switch-exhaustiveness-check` error on that switch and exits non-zero. (The temporary file is removed after verification.)
- **Runnable target**: composed product — `pnpm lint`.

### Scenario: React hooks rule applies only to web

- **Given**: A temporary `.tsx` file placed under `apps/web/src/` that calls a hook conditionally (e.g., inside an `if`).
- **When**: `pnpm lint` runs.
- **Then**: ESLint reports a `react-hooks/rules-of-hooks` error and exits non-zero. The same file placed under `apps/server/src/` (with `.tsx` renamed to `.ts` and hooks removed) triggers no `react-hooks` error. (Temporary files are removed after verification.)
- **Runnable target**: composed product — `pnpm lint`.

### Scenario: TypeScript base strictness is inherited

- **Given**: A temporary TypeScript file placed under `apps/server/src/` that has a function declared to return a value but falls through one branch without returning, or a `switch` that falls through one case without `break`.
- **When**: `pnpm typecheck` runs.
- **Then**: `tsc` reports the corresponding error (`noImplicitReturns` or `noFallthroughCasesInSwitch`) and exits non-zero. (Temporary files are removed after verification.)
- **Runnable target**: composed product — `pnpm typecheck`.

### Scenario: Runtime behavior is unchanged

- **Given**: The repository with the spec fully applied.
- **When**: `pnpm test` runs.
- **Then**: All existing tests pass with no test changes required beyond mechanical adjustments (e.g., `import` → `import type`) forced by the new rules. The command exits 0.
- **Runnable target**: composed product — `pnpm test`.

## Adaptation Log

### 2026-04-20 — Post-Slice-4: mechanize system-rules §6 (scope miss)

- **Trigger**: After Slice 4 completion, user surfaced that the spec's framing was "tighten defaults" when the actual intent was "turn agent discipline from system-rules into tool-enforced rules." The rule set shipped catches async bugs and type laundering but misses the concrete discipline from system-rules §6 Strictness: file size cap (300 lines), function size cap, complexity cap, unsafe-cast bans, `unknown` escape-hatch coverage.
- **Conflict with spec**: The original Rejected Alternatives section includes entries explaining why `strict-boolean-expressions` and `noPropertyAccessFromIndexSignature` were cut for churn reasons. Those rejections stand. But size/complexity/unsafe-cast rules were never considered at all — they were invisible to the spec because the spec wasn't derived from system-rules in the first place.
- **Decision**: Add to `.eslintrc.cjs` top-level rules: `max-lines: 300` (skipBlank, skipComments), `max-lines-per-function: 50` (skipBlank, skipComments, IIFEs), `complexity: 10`, `@typescript-eslint/consistent-type-assertions` (banning object-literal `as` casts), and the `no-unsafe-*` family (`no-unsafe-argument`, `no-unsafe-assignment`, `no-unsafe-call`, `no-unsafe-member-access`, `no-unsafe-return`). Add override relaxation: `max-lines-per-function: off` for `scripts/**`, `**/*.test.ts`, `**/*.test.tsx` (test `describe` blocks and script main bodies legitimately exceed 50 lines).
- **Deferred**: Architecture/boundary enforcement (`eslint-plugin-boundaries` or `no-restricted-imports` matching system-rules §7 dependency direction) requires a per-package allow-list design pass and is out of scope for this adaptation. Tracked as a follow-up.
- **Process deviation acknowledged**: The adaptation is landing as a config-only commit that will leave `pnpm lint` failing. This deviates from system-rules §8 "never accumulate failing states." User explicitly accepted this tradeoff — the fallout from `max-lines` / `no-unsafe-*` is expected to touch a non-trivial surface of application code, and a single post-config commit gives a clear baseline for working through violations as separate focused commits.
- **Spec sections updated**: Rejected Alternatives (size/complexity rules no longer rejected).
- **Slices affected**: New work. A post-adaptation "fix lint fallout" set of commits follows.

### 2026-04-20 — Slice 4 final: root tsconfig rootDir override + typecheck pipeline coverage

- **Trigger**: Rival final checkpoint flagged that the root `tsconfig.json`, after extending base, inherits `rootDir: "${configDir}/src"` which resolves to `<repo>/src` at the root location. Directly invoking `tsc -p tsconfig.json` fails with TS6059 on `scripts/doc-edit-check.ts`. The verification pipeline (`pnpm typecheck` → `turbo typecheck`) only reaches workspace packages, so the broken root config was silent.
- **Conflict with spec**: Original Slice 4 wording required root tsconfig to declare only `types` and `include`. That leaves the inherited broken `rootDir`. It also leaves `scripts/` typechecking unexercised by any verification command — a coverage gap that parallels Slice 2's `scripts/` lint gap.
- **Decision**: (a) Root `tsconfig.json` adds a `rootDir: "${configDir}"` override (repo root). First attempt used `"${configDir}/scripts"` but that broke `scripts/doc-edit-check.ts`'s legitimate imports from `apps/server/src/*` (integration harness). Repo root is the common ancestor that spans both. (b) Root `typecheck` script extended to `"turbo typecheck && tsc --noEmit -p tsconfig.json"`, mirroring Slice 2's lint pattern so the regression can't re-occur silently.
- **Alternatives considered**: (a) Remove `rootDir` from base entirely — weakens the per-package scope guard for workspace packages. (b) Leave the root tsconfig broken and skip adding typecheck coverage — violates spec intent of tightening correctness. (c) `rootDir: "${configDir}/scripts"` — rejected empirically; script legitimately imports across package boundaries.
- **Spec sections updated**: Requirements §Root TypeScript Configuration, Requirements §Root Scripts.
- **Slices affected**: Slice 4 only.

### 2026-04-20 — Slice 4: `rootDir` must use `${configDir}` template

- **Trigger**: Worker implementing Slice 4 found that placing `rootDir: "src"` in `tsconfig.base.json` resolves to `<repo>/src` (relative to the base's own location), which is not a parent of any package's `src/`. `pnpm typecheck` fails with TS6059 across every package.
- **Conflict with spec**: Original spec wording `rootDir: "src"` in base, omitted from per-package configs, is functionally broken under TypeScript's `rootDir` resolution semantics.
- **Decision**: Use `rootDir: "${configDir}/src"` in base. TS 5.5+ `${configDir}` template resolves against the extending config's directory at each per-package config, giving each package a correct `rootDir: <pkg>/src` while keeping the declaration in the base only. Project uses TypeScript 5.9.3; the feature is stable.
- **Alternatives considered**: (a) Drop `rootDir` from base entirely — simpler but weakens the per-package source-scope guard; `include: ["src"]` alone does not prevent cross-package relative imports. (b) Declare `rootDir: "src"` in both base and every per-package config — contradicts "per-package only declares what differs from base."
- **Spec sections updated**: Requirements §TypeScript Base Configuration.
- **Slices affected**: Slice 4 only.

### 2026-04-20 — Slice 2: preserve `scripts/` lint coverage

- **Trigger**: Worker implementing Slice 2 surfaced that `turbo lint` only reaches workspace packages (`apps/*`, `packages/*`). The pre-slice root lint invocation explicitly included `'scripts/**/*.ts'`; replacing it with plain `turbo lint` silently dropped coverage of `scripts/doc-edit-check.ts`.
- **Conflict with spec**: Slice 3 adds a `no-console` override for `scripts/**/*.ts`, which presumes `scripts/` is still linted. The original Slice 2 wording would have broken that presumption.
- **Decision**: Change the root `lint` script to `"turbo lint && eslint scripts --max-warnings=0"`. Turbo runs per-package lint in parallel; the trailing eslint pass lints the non-workspace `scripts/` directory. Clear winner — minimal change, preserves coverage, keeps turbo parallelism for workspace code.
- **Alternatives considered**: (a) Promote `scripts/` to a workspace package — over-engineered for one file. (b) Silently drop `scripts/` coverage — contradicts Slice 3 design.
- **Spec sections updated**: Requirements §Root Scripts.
- **Slices affected**: Slice 2 only. Slice 3's `scripts/**` override remains valid.

## Implementation Slices

```digraph
slice_1 -> slice_2
slice_2 -> slice_3
slice_3 -> slice_4
```

### Slice 1: Prettier configuration and formatting sweep

- What: Create `.prettierignore`. Replace empty `.prettierrc` with the opinions defined in Requirements. Add `format` and `format:check` scripts to root `package.json`. Run `pnpm format` once to apply formatting across the repo. The config change and the formatting sweep land as two separate commits in this slice — config commit first, sweep commit second.
- Verify: `pnpm format:check` exits 0 and `pnpm typecheck && pnpm test` exits 0.
- Outcome: Formatting is deterministic and enforceable from the repo root.

### Slice 2: Per-package lint scripts and root lint via Turbo

- What: Add `"lint": "eslint src --max-warnings=0"` to each of `apps/server/package.json`, `apps/mcp/package.json`, `apps/web/package.json`, `packages/shared/package.json`. Change the root `package.json` `lint` script to `"lint": "turbo lint"`. No ESLint rule changes in this slice.
- Verify: `pnpm lint` exits 0 and `pnpm typecheck && pnpm test` exits 0. Running `pnpm lint` shows Turbo invoking the `lint` task in each workspace package.
- Outcome: The existing `turbo.json` `lint` task starts running per-package, with caching and parallelism.

### Slice 3: ESLint rule additions

- What: Add the rules defined in Requirements to root `.eslintrc.cjs`. Add both overrides (web react-hooks; scripts+tests no-console relaxation). Install `eslint-plugin-react-hooks` as a root dev dependency. Run `pnpm lint --fix` to apply autofixes (including `consistent-type-imports` rewrites). Fix any remaining violations by hand within this slice.
- Verify: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check` all exit 0.
- Outcome: Type-aware correctness rules reject floating promises, misused promises, non-exhaustive switches, unnecessary conditionals, explicit `any`, non-null assertions, and stylistic regressions. Web has hooks rules; scripts and tests permit `console`.

### Slice 4: TypeScript base tightening

- What: Edit `tsconfig.base.json` to add the options defined in Requirements and to host the shared `module`, `moduleResolution`, `noEmit`, `rootDir` values. Edit each per-package `tsconfig.json` to remove options now provided by the base, leaving only per-package overrides. Edit root `tsconfig.json` to extend `tsconfig.base.json` and remove duplicated options and the `jsx` setting. Fix any source-level fallout from `verbatimModuleSyntax`, `isolatedModules`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, `allowUnreachableCode: false`, `allowUnusedLabels: false` within this slice.
- Verify: `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check` all exit 0.
- Outcome: A single base tsconfig defines all shared compiler options. Per-package tsconfigs contain only true overrides. Stricter TypeScript flags are active across the monorepo.

## Acceptance Criteria

- `.prettierrc` contains exactly the JSON object defined in Requirements — verified by reading the file.
- `.prettierignore` exists at the repo root and contains `node_modules`, `dist`, `.turbo`, and `pnpm-lock.yaml` — verified by reading the file.
- Root `package.json` `scripts` object contains `format`, `format:check`, and `lint: "turbo lint"` — verified by reading the file.
- Each of `apps/server/package.json`, `apps/mcp/package.json`, `apps/web/package.json`, `packages/shared/package.json` contains `"lint": "eslint src --max-warnings=0"` — verified by reading each file.
- Root `.eslintrc.cjs` declares every rule listed in Requirements and both overrides described in Requirements — verified by reading the file.
- `eslint-plugin-react-hooks` appears in root `package.json` `devDependencies` — verified by reading the file.
- `tsconfig.base.json` contains every compiler option listed in Requirements — verified by reading the file.
- `apps/server/tsconfig.json`, `apps/mcp/tsconfig.json`, `apps/web/tsconfig.json`, `packages/shared/tsconfig.json` no longer declare `module`, `moduleResolution`, `noEmit`, or `rootDir` except where they intentionally override the base (only `apps/web/tsconfig.json`'s `module: "ESNext"` remains) — verified by reading each file.
- Root `tsconfig.json` extends `tsconfig.base.json` and does not declare `jsx` — verified by reading the file.
- `pnpm typecheck` exits 0 — verified by running the command.
- `pnpm lint` exits 0 — verified by running the command.
- `pnpm test` exits 0 — verified by running the command.
- `pnpm format:check` exits 0 — verified by running the command.
- No file under `apps/*/src/**` or `packages/*/src/**` changes except as required by the new lint rules and TypeScript options — verified by reviewing the final diff for each slice.
