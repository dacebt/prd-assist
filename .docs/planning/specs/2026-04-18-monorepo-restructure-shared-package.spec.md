# Monorepo Restructure — Shared Package

## Project Status

refactor

## Parent Reference

- Kind: plan
- Plan: `../plans/2026-04-18-monorepo-restructure.plan.md`
- Slice: shared-package
- Inherited constraints: Shared Foundation (source-direct consumption, no `composite`, nodenext for server/mcp, `@prd-assist/*` naming), Migration Invariants (dev/build/test/typecheck/no-orphans at slice boundary), Cross-system scenario "dev environment survives every slice boundary".

## Intent

Promote `src/shared/` to `packages/shared/` as the `@prd-assist/shared` workspace package. Publish `./` and `./schemas` exports. Flip all type imports in consumers (`src/server/*`, `src/mcp/*`, `src/web/*`) from `../shared/...` to `@prd-assist/shared`. Delete `src/shared/`. Do NOT consolidate duplicated zod schemas in consumers this slice — that's per-consumer work in slices 3, 4, 5.

## Scope

### In Scope

- Create `packages/shared/package.json` with `name: "@prd-assist/shared"`, `exports` map for `.` and `./schemas`, `zod` dep, typecheck/build/test scripts.
- Create `packages/shared/tsconfig.json` extending `tsconfig.base.json` with `module: nodenext`, `moduleResolution: nodenext`, `noEmit: true`.
- Create `packages/shared/src/types.ts` (copy of `src/shared/types.ts`).
- Create `packages/shared/src/sections.ts` (copy of `src/shared/sections.ts` with added `SECTION_KEYS_ARRAY` export — the typed tuple literal currently in `src/mcp/validate.ts:5-13`).
- Create `packages/shared/src/schemas.ts` exporting `SectionStatusSchema`, `SectionKeySchema`, `SectionSchema`, `PrdSchema`, `ChatMessageSchema`, `SessionSchema`, `SessionSummarySchema`, `SessionListSchema`.
- Create `packages/shared/src/index.ts` barrel re-exporting `./types` + `./sections`.
- Add `"@prd-assist/shared": "workspace:*"` to root `package.json` `dependencies`.
- Run `pnpm install` to create the workspace symlink.
- Flip all `../shared/...` and `../../shared/...` imports (18 occurrences across 16 files) to `@prd-assist/shared`.
- Delete `src/shared/types.ts`, `src/shared/sections.ts`, and the now-empty `src/shared/` directory.

### Out of Scope

- Removing duplicated `SectionSchema`/`PrdSchema`/`ChatMessageSchema` zod blocks from `src/server/sessions.ts`, `src/mcp/tools.ts`, `src/web/src/api.ts` — they stay duplicated until their owning slice.
- Removing duplicated `SectionKeySchema`/`SectionStatusSchema`/`SECTION_KEYS_ARRAY` from `src/mcp/validate.ts` — stays until slice 4 (mcp-app).
- Creating `apps/` directories — slices 3–5.
- Any turbo task wiring or shared-package consumption via turbo — slice 3+.

## Implementation Constraints

### Architecture

Source-direct per plan Shared Foundation. `exports` points at `src/*.ts` files. No `composite`, no project `references`, no `dist/` emit required. Consumers resolve via pnpm symlink through `node_modules/@prd-assist/shared` → `packages/shared/`.

### Boundaries

- Import specifier in all consumers: `@prd-assist/shared` (bare, no `.js` suffix — package exports control resolution).
- Within `packages/shared/src/`, relative imports retain `.js` suffix (nodenext requires it).
- `packages/shared/package.json` declares `"type": "module"`.
- No runtime deps except `zod` (needed by schemas.ts).
- DevDeps: `typescript`, `@types/node` (not needed — no node APIs). Actually just `typescript`.

### Testing Approach

No new tests authored. Existing tests (`src/mcp/tools.test.ts`, `src/server/*.test.ts`, `src/web/src/hooks/polling.test.ts`) flip their imports alongside production code. Continued green on `pnpm test` is the signal.

## Requirements

### `packages/shared/package.json`

```json
{
  "name": "@prd-assist/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": { "types": "./src/index.ts", "default": "./src/index.ts" },
    "./schemas": { "types": "./src/schemas.ts", "default": "./src/schemas.ts" }
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint --no-error-on-unmatched-pattern 'src/**/*.ts'"
  },
  "dependencies": {
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "typescript": "^5.9.3"
  }
}
```

### `packages/shared/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "noEmit": true,
    "rootDir": "src"
  },
  "include": ["src"]
}
```

### `packages/shared/src/types.ts`

Verbatim copy of current `src/shared/types.ts`.

### `packages/shared/src/sections.ts`

Verbatim copy of current `src/shared/sections.ts`, plus append:

```ts
export const SECTION_KEYS_ARRAY = SECTION_KEYS as unknown as [
  "vision",
  "problem",
  "targetUsers",
  "goals",
  "coreFeatures",
  "outOfScope",
  "openQuestions",
];
```

### `packages/shared/src/schemas.ts`

Wire schemas. Exact shapes mirror the current duplicates in `src/server/sessions.ts`, `src/mcp/tools.ts`, `src/web/src/api.ts`:

- `SectionStatusSchema = z.enum(["empty", "draft", "confirmed"])`
- `SectionKeySchema = z.enum(SECTION_KEYS_ARRAY)`
- `SectionSchema = z.object({ content, updatedAt, status: SectionStatusSchema })`
- `PrdSchema = z.object` with all seven section keys
- `ChatMessageSchema = z.discriminatedUnion("role", [user, assistant])`
- `SessionSchema = z.object` with id, title, createdAt, updatedAt, messages, prd
- `SessionSummarySchema = z.object` with id, title, updatedAt
- `SessionListSchema = z.array(SessionSummarySchema)`

### `packages/shared/src/index.ts`

```ts
export * from "./types.js";
export * from "./sections.js";
```

(Schemas live behind the `./schemas` subpath — not in the barrel.)

### Root `package.json` update

Add `"@prd-assist/shared": "workspace:*"` to `dependencies`, keep alphabetical order.

### Import flips

All 18 `../shared/...` and `../../shared/...` relative imports (16 files) change to `@prd-assist/shared`. Listing captured at spec-authoring time:

- `src/mcp/tools.ts`, `src/mcp/tools.test.ts`, `src/mcp/validate.ts`
- `src/server/sessions.ts`, `src/server/sessions.test.ts`, `src/server/turn.test.ts`
- `src/web/src/api.ts`, `src/web/src/pages/SessionPage.tsx`, `src/web/src/hooks/useSessionPolling.ts`, `src/web/src/hooks/polling.ts`, `src/web/src/hooks/polling.test.ts`
- `src/web/src/components/PrdPane.tsx`, `src/web/src/components/SectionBlock.tsx`, `src/web/src/components/ChatPane.tsx`, `src/web/src/components/SessionList.tsx`

## Rejected Alternatives

- **Emit `dist/` from shared via `tsc -b`**: Rejected by plan Shared Foundation. Source-direct avoids dev staleness and stale-build bugs entirely.
- **Keep duplicated zod in consumers, never consolidate**: Rejected. Consolidation happens per-consumer slice; this slice creates the canonical home so consolidation becomes a one-liner later.

## Accepted Risks

- **Schemas.ts created but unused**: All three consumer slices still use their own zod duplicates. Shared's `schemas.ts` is dead-code-ish until slices 3/4/5 flip to it. Acceptable: avoids cross-consumer churn in one slice.
- **Type-only imports pull runtime barrel**: `import type { ... } from "@prd-assist/shared"` compiles to nothing, but JS runtime resolution still hits the barrel file through tsconfig `isolatedModules`. No perf concern at this size.

## Build Process

### Git Strategy

**Full Agentic** — AI commits after this slice passes gates; no pause. Commit format `[slice-2] <imperative>`. Direct on `main`, no PR.

### Verification Commands

```bash
pnpm install
pnpm typecheck
pnpm vitest run
pnpm build
pnpm lint
test ! -d src/shared  # legacy dir gone
test -f packages/shared/package.json
test -f packages/shared/src/index.ts
test -f packages/shared/src/schemas.ts
node -e "require.resolve('@prd-assist/shared/package.json', { paths: ['.'] })"
```

Plus manual `pnpm dev` smoke: server reachable, `GET /api/health` 200, SIGINT clean.

### Work Process

Work proceeds under the lifecycle defined in `skills/spec-creator/references/work-process.md`. Gate triggers: code-quality always; spec-check at first slice milestone; system-coherence after behavior-changing slices (this slice is structural, skip).

## Verification Scenarios

### Scenario: legacy dev still runs after flip

- **Given**: Slice 2 complete.
- **When**: `pnpm install && pnpm dev` from repo root.
- **Then**: Web + server launch; `/api/health` returns 200; SIGINT leaves no orphans. Existing `src/server/*`, `src/mcp/*`, `src/web/src/*` resolve `@prd-assist/shared` through the workspace symlink.

### Scenario: shared is the only home for shared types

- **Given**: Slice 2 complete.
- **When**: `grep -r "../shared/" src` and `grep -r "../../shared/" src`.
- **Then**: No matches. All consumers go through `@prd-assist/shared`.

### Scenario: test suite still passes

- **Given**: Slice 2 complete.
- **When**: `pnpm vitest run`.
- **Then**: 94 tests pass (parity with pre-slice count).

## Adaptation Log

### 2026-04-19 — `moduleResolution: bundler` instead of `nodenext`; project-wide `.js` strip

- **Conflict:** Spec Requirements call for `module: nodenext, moduleResolution: nodenext` on `packages/shared/tsconfig.json`. Mid-slice user direction: drop `.js` extensions from all source imports project-wide.
- **Change:** `packages/shared/tsconfig.json` uses `module: ES2022, moduleResolution: bundler`. Internal shared imports are extensionless (`./types`, `./sections`). A separate sweep stripped `.js` from every relative import in `src/**/*.{ts,tsx}` and `scripts/doc-edit-check.ts` (101 occurrences across 39 files; SDK subpath imports preserved). Plan Shared Foundation updated to lock bundler resolution for all packages.
- **Affects:** This slice (shared tsconfig + sweep). Slices 3–5 will declare bundler in their per-app tsconfigs.

## Implementation Slices

### Slice 2: shared-package-promoted

- What: Create `packages/shared/{package.json, tsconfig.json, src/{index.ts, types.ts, sections.ts, schemas.ts}}`. Add `@prd-assist/shared: workspace:*` to root deps. `pnpm install`. Flip 18 imports. Delete `src/shared/`.
- Verify: All Verification Commands exit 0. `pnpm vitest run` 94/94. Manual `pnpm dev` smoke passes. All three Verification Scenarios hold.
- Outcome: `@prd-assist/shared` is the canonical home for shared types and wire schemas. Consumers still duplicate zod but import types from shared. `src/shared/` gone.

## Acceptance Criteria

- `packages/shared/package.json`, `tsconfig.json`, `src/{index.ts,types.ts,sections.ts,schemas.ts}` exist with contents per Requirements.
- `packages/shared/src/types.ts` is byte-identical to the pre-slice `src/shared/types.ts`.
- `packages/shared/src/sections.ts` matches pre-slice `src/shared/sections.ts` plus the appended `SECTION_KEYS_ARRAY` export.
- Root `package.json` `dependencies` contains `"@prd-assist/shared": "workspace:*"`.
- `src/shared/` directory does not exist.
- No remaining `../shared/` or `../../shared/` imports anywhere under `src/`.
- `pnpm typecheck`, `pnpm vitest run`, `pnpm build`, `pnpm lint` each exit 0.
- Migration Invariants hold: `pnpm dev` launches and `/api/health` returns 200.
