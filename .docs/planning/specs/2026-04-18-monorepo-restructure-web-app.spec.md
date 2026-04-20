# Monorepo Restructure — Web App

## Project Status

refactor

## Parent Reference

- Kind: plan
- Plan: `../plans/2026-04-18-monorepo-restructure.plan.md`
- Slice: web-app
- Inherited constraints: bundler resolution; source-direct shared consumption; Migration Invariants; Full Agentic git strategy.

## Intent

Promote `src/web/` to `apps/web/` as `@prd-assist/web`. Drop duplicated `Session*` zod schemas from `api.ts` (use shared). Move root vite/tailwind/postcss configs to the package. Collapse root scripts to plain turbo. Remove all web/build runtime + dev deps from root. Delete legacy `src/`. Repo becomes pure monorepo: `apps/{server,mcp,web}` + `packages/shared`.

## Scope

### In Scope

- Create `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/postcss.config.js`, `apps/web/tailwind.config.js`, `apps/web/vitest.config.ts`.
- `git mv src/web/index.html apps/web/index.html`.
- `git mv src/web/src/* apps/web/src/`.
- `apps/web/src/api.ts`: drop local `SectionSchema`, `PrdSchema`, `ChatMessageSchema`, `SessionSchema`, `SessionSummarySchema`, `SessionListSchema`, `SectionStatusSchema`. Import from `@prd-assist/shared/schemas`. Keep `CreateSessionResponseSchema`, `SendMessageResponseSchema`, `ErrorResponseSchema` (route-specific transport schemas, web-local).
- `apps/web/vite.config.ts`: `root` is the package directory (default), `outDir: dist`, `proxy /api → http://127.0.0.1:5174`.
- `apps/web/tailwind.config.js`: `content: ["./index.html", "./src/**/*.{ts,tsx}"]`.
- Root `package.json` script collapse:
  - `dev`: `turbo dev`
  - `build`: `turbo build`
  - `typecheck`: `turbo typecheck`
  - `test`: `turbo test`
  - `lint`: `turbo lint`
  - `doc-edit-check`: keep `tsx scripts/doc-edit-check.ts`.
- Root `package.json` strip deps + devDeps that no longer have a root consumer: `react`, `react-dom`, `react-markdown`, `react-router-dom`, `remark-gfm`, `zod` (deps); `@vitejs/plugin-react`, `autoprefixer`, `concurrently`, `postcss`, `tailwindcss`, `vite`, `vitest`, `@types/react`, `@types/react-dom` (devDeps). Keep `tsx` (for `scripts/doc-edit-check.ts`), `turbo`, `typescript`, `eslint`, `@typescript-eslint/*`, `prettier`, `@types/node`. Remove `pnpm.onlyBuiltDependencies` (apps/server already migrated; nothing at root needs natives).
- Wait: `pnpm.onlyBuiltDependencies` lives at workspace root because pnpm only honors it there. Even though no root code uses better-sqlite3, the apps under `apps/` do. Keep the field.
- Add a root `eslint` `lint` task that doesn't double-run apps' ESLint: root's `lint` script becomes `turbo lint`; the legacy `eslint --no-error-on-unmatched-pattern 'src/**/*.{ts,tsx}' 'scripts/**/*.ts'` invocation drops the `src/**/*` glob (src/ is gone) and keeps only `scripts/**/*.ts`. Move the script into a `lint:scripts` entry, then `lint` becomes `turbo lint && eslint scripts/**/*.ts` — or simpler: make scripts a workspace? Out of scope. Pragmatic: leave a `lint` script that's `turbo lint && eslint scripts/**/*.ts`.
- Root `tsconfig.json` `include` narrows to `["scripts/**/*.ts"]`. (Or delete the file entirely since nothing else at root needs typecheck — but `pnpm doc-edit-check` runs scripts/doc-edit-check.ts via tsx and the root tsconfig governs its IDE typing.) Keep the file, narrow includes.
- Update `scripts/doc-edit-check.ts` if any `../src/web/...` paths exist (they don't — script imports from `apps/server/src/...` and `@prd-assist/shared`).
- Delete root `vite.config.ts`, `vitest.config.ts`, `postcss.config.js`, `tailwind.config.js`.
- Delete `src/` directory.

### Out of Scope

- Routing changes, component changes — pure restructure.
- Any change to `apps/server` or `apps/mcp`.
- Adding `jsdom` env: existing `polling.test.ts` uses `vi.useFakeTimers()` and pure functions — no DOM access.

## Implementation Constraints

### Architecture

- `apps/web/vite.config.ts` keeps the same `react()` plugin and `/api` proxy as root.
- `apps/web/tsconfig.json`: extends base, `module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`, `noEmit: true`. No `composite`, no `references`.

### Boundaries

- `apps/web/index.html` references `/src/main.tsx` (relative to vite root).
- Vite root is `apps/web/` (the default — no explicit `root` setting needed if cwd is the package).

## Requirements

### `apps/web/package.json`

```json
{
  "name": "@prd-assist/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "lint": "eslint --no-error-on-unmatched-pattern 'src/**/*.{ts,tsx}'"
  },
  "dependencies": {
    "@prd-assist/shared": "workspace:*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-markdown": "^9.1.0",
    "react-router-dom": "^6.30.3",
    "remark-gfm": "^4.0.1",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "@vitejs/plugin-react": "^4.7.0",
    "autoprefixer": "^10.5.0",
    "postcss": "^8.5.10",
    "tailwindcss": "^3.4.19",
    "typescript": "^5.9.3",
    "vite": "^5.4.21",
    "vitest": "^2.1.9"
  }
}
```

### `apps/web/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "noEmit": true,
    "rootDir": "src",
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

### `apps/web/vite.config.ts`

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:5174",
    },
  },
});
```

### `apps/web/tailwind.config.js`

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: { extend: {} },
  plugins: [],
};
```

### `apps/web/postcss.config.js`

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

### `apps/web/vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

## Rejected Alternatives

- **Add jsdom**: rejected. No tests touch DOM.

## Accepted Risks

- **Root `lint` script juggles two invocations**: one turbo run + one direct eslint for `scripts/`. Acceptable until `scripts/` becomes a workspace package (out of scope).

## Build Process

### Git Strategy

**Full Agentic**. Commit `[slice-5] <imperative>` direct to `main`.

### Verification Commands

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm lint
test ! -d src
test -f apps/web/package.json
test -f apps/web/index.html
test -f apps/web/src/main.tsx
test -f apps/web/vite.config.ts
test ! -f vite.config.ts
test ! -f vitest.config.ts
test ! -f tailwind.config.js
test ! -f postcss.config.js
```

Plus dev smoke: `pnpm dev` → web on :5173, `/api/health` 200, POST /api/sessions 201, SIGINT clean.

## Verification Scenarios

### Scenario: pure monorepo runs

- **Given**: Slice 5 shipped.
- **When**: `pnpm install && pnpm dev` from a clean checkout.
- **Then**: Three task streams (web, server, mcp) launch via turbo; web at :5173 reachable; server at :5174 reachable; tests, build, typecheck, lint all green.

### Scenario: shared schemas are the only Session schema home

- **Given**: Slice 5 shipped.
- **When**: `grep -r "z.object" apps/web/src/api.ts`.
- **Then**: No top-level `SessionSchema = z.object(...)` definitions. Sessions/SessionList/SessionSummary/Section/Prd/ChatMessage all imported from `@prd-assist/shared/schemas`.

### Scenario: legacy paths gone

- **Given**: Slice 5 shipped.
- **When**: `ls src 2>&1`, `ls vite.config.ts 2>&1`, `ls vitest.config.ts 2>&1`.
- **Then**: All produce "No such file or directory".

## Adaptation Log

### 2026-04-19 — Per-package `lint` scripts dropped; root runs eslint over the whole tree

- **Conflict:** Apps don't list `eslint` as a devDep. `turbo lint` invoked each app's `lint` which couldn't find the binary. Adding eslint to every app would multiply lockfile entries and require keeping plugin versions in sync.
- **Change:** Removed `lint` scripts from `apps/{server,mcp,web}/package.json`. Root `lint` is now `eslint --no-error-on-unmatched-pattern 'apps/*/src/**/*.{ts,tsx}' 'packages/*/src/**/*.ts' 'scripts/**/*.ts'`. Single eslint config, single plugin set, single source of truth.

### 2026-04-19 — Per-package `lint` and `test` scripts dropped from `packages/shared`

- **Why:** Shared has no test files and no eslint dep. The 4 source files are gated by typecheck + every consumer's compilation. Drop dead scripts.

### 2026-04-19 — `eslint` `parserOptions.project` widened to glob all workspace tsconfigs

- **Conflict:** Root tsconfig now only includes `scripts/**/*.ts`. Eslint with `parserOptions.project: "./tsconfig.json"` couldn't parse `apps/*/src/**` files.
- **Change:** `parserOptions.project: ["./tsconfig.json", "./apps/*/tsconfig.json", "./packages/*/tsconfig.json"]`. Added `tsconfigRootDir: __dirname` for stable resolution.

### 2026-04-19 — Root `dev` script filters to server + web only

- **Conflict:** Plain `turbo dev` ran apps/mcp's dev as a standalone process. MCP is meant to be SPAWNED by apps/server, not launched independently — the standalone run failed because the cwd-relative `./data/prd-assist.sqlite` doesn't exist relative to apps/mcp.
- **Change:** Root `dev` is `turbo dev --filter=@prd-assist/server --filter=@prd-assist/web`. Server spawns MCP as a child as designed. apps/mcp keeps its `dev` script for direct invocation/debugging.

### 2026-04-19 — Root retains `@prd-assist/shared` dependency

- `scripts/doc-edit-check.ts` imports `PRD` from `@prd-assist/shared`. Root keeps shared as a dep until scripts becomes its own workspace package (out of scope).

## Implementation Slices

### Slice 5: web-app-promoted

- What: per Scope.
- Verify: Verification Commands + Scenarios.
- Outcome: Repo is `apps/{server,mcp,web} + packages/shared` with no `src/`. Root has tooling deps only. `pnpm dev` is `turbo dev`.

## Acceptance Criteria

- All Verification Commands exit 0.
- `src/` does not exist.
- `apps/web/package.json` per Requirements.
- `apps/web/src/api.ts` does not contain `Session*Schema = z.object(...)` definitions; imports from `@prd-assist/shared/schemas`.
- Root `package.json` `dependencies` contains only `@prd-assist/shared`.
- Root `package.json` `scripts.dev` is `turbo dev` (no `concurrently`, no `vite`).
- Manual dev smoke passes.
