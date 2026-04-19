# Monorepo Restructure — MCP App

## Project Status
refactor

## Parent Reference
- Kind: plan
- Plan: `../plans/2026-04-18-monorepo-restructure.plan.md`
- Slice: mcp-app
- Inherited constraints: bundler resolution everywhere; source-direct shared consumption; Migration Invariants; Full Agentic git strategy.

## Intent
Promote `src/mcp/` to `apps/mcp/` as `@prd-assist/mcp`. Drop the duplicated `SectionSchema`/`PrdSchema` from `tools.ts` (consume `PrdSchema`/`SectionKeySchema`/`SectionStatusSchema` from `@prd-assist/shared/schemas`). Add a fail-fast schema-existence guard at MCP startup. Switch `apps/server`'s MCP launcher default from `MCP_LEGACY_ROOT` to a `require.resolve("@prd-assist/mcp/package.json")`-derived path. Remove `MCP_LEGACY_ROOT` from `apps/server/src/mcpClient.ts` and from `turbo.json` `passThroughEnv`. Strip MCP runtime deps from root.

## Scope

### In Scope
- Create `apps/mcp/{package.json, tsconfig.json, vitest.config.ts}`.
- `git mv src/mcp/* apps/mcp/src/`.
- `apps/mcp/src/tools.ts`: remove local `SectionSchema` + `PrdSchema`; import `PrdSchema` from `@prd-assist/shared/schemas`. Keep `PrdRowSchema` (DB row, persistence concern).
- `apps/mcp/src/validate.ts`: replace local definitions of `SectionKeySchema`/`SectionStatusSchema`/`SECTION_KEYS_ARRAY` with re-exports from `@prd-assist/shared/schemas` and `@prd-assist/shared`. (Keeping `validate.ts` as an indirection adds no value — delete the file and have `tools.ts`/`manifest.ts` import directly from shared.)
- `apps/mcp/src/index.ts`: add schema-existence guard. Before `server.connect`, run `SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'`. If empty, write `JSON.stringify({error: "schema_not_initialized", hint: "start apps/server first"})` to stderr and `process.exit(2)`.
- `apps/server/src/mcpClient.ts`: change default launcher to use `import.meta.resolve("@prd-assist/mcp/package.json")`, computing the sibling `src/index.ts` path. `MCP_COMMAND` still overrides. `MCP_LEGACY_ROOT` fallback deleted; if `MCP_COMMAND` is unset, use the resolved path.
- Update `apps/server/src/mcpClient.test.ts` if necessary for new resolution behavior.
- `turbo.json`: server `dev` task gets `dependsOn: ["@prd-assist/mcp#typecheck"]` and `passThroughEnv` loses `MCP_LEGACY_ROOT`.
- Root `package.json`: remove `@modelcontextprotocol/sdk`, `better-sqlite3`, `zod` from `dependencies`. Drop `MCP_LEGACY_ROOT=$PWD` prefix from `scripts.dev`.
- Root `tsconfig.json` `include` narrows further: only `src/web/...` and `scripts/...`.
- Update `src/mcp/dispatch.test.ts` cross-package import paths to `../../server/src/...` (one level deeper because the test moves).
- Delete `src/mcp/` directory.

### Out of Scope
- Touching `src/web/` (slice 5).
- The MCP `bin` field (`bin: { "prd-assist-mcp": "./dist/index.js" }`) — production-only path, not exercised in dev. Add it to `apps/mcp/package.json` for completeness but no slice work depends on it.
- DDL migration: `apps/server/src/db.ts` keeps owning DDL. The MCP guard only checks for table existence.

## Implementation Constraints

### Architecture
- MCP runs under `node --watch --import tsx/esm src/index.ts` in dev. Server spawns it via the same command in production, computed from the resolved `@prd-assist/mcp/package.json` path.
- Schema guard runs synchronously at startup before any MCP request handler is registered. If the table is missing, no transport binds, no handlers run.

### Boundaries
- `apps/mcp/tsconfig.json` mirrors `apps/server/tsconfig.json` shape: extends base, `module: ES2022`, `moduleResolution: bundler`, `noEmit: true`, `rootDir: src`, `types: ["node"]`.
- Server/MCP communication contract is unchanged — same tool names, same input/output JSON shapes.

## Requirements

### `apps/mcp/package.json`
```json
{
  "name": "@prd-assist/mcp",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": {
    "prd-assist-mcp": "./dist/index.js"
  },
  "scripts": {
    "dev": "node --watch --import tsx/esm src/index.ts",
    "build": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint --no-error-on-unmatched-pattern 'src/**/*.ts'"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "@prd-assist/shared": "workspace:*",
    "better-sqlite3": "^11.10.0",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@prd-assist/server": "workspace:*",
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^25.6.0",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3",
    "vitest": "^2.1.9"
  }
}
```
(`@prd-assist/server` as devDep gives `dispatch.test.ts` clean access to `openDatabase`/`createSessionStore` — see Adaptation note in slice 3.)

### `apps/mcp/src/index.ts` schema guard
```ts
const tableCheck = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"
).get();
if (tableCheck === undefined) {
  process.stderr.write(
    JSON.stringify({ error: "schema_not_initialized", hint: "start apps/server first" }) + "\n",
  );
  process.exit(2);
}
```
Runs after `openMcpDatabase` and before server registration.

### `apps/server/src/mcpClient.ts` resolution change
Default launcher (when `MCP_COMMAND` unset):
```ts
const resolved = import.meta.resolve("@prd-assist/mcp/package.json");
const mcpPkgPath = fileURLToPath(resolved);
const mcpEntry = path.join(path.dirname(mcpPkgPath), "src/index.ts");
return { command: "node", args: ["--import", "tsx/esm", mcpEntry] };
```
`MCP_LEGACY_ROOT` branch removed. Throwing branch only triggers if `import.meta.resolve` fails — which means @prd-assist/mcp is not installed.

### `turbo.json` updates
- `dev.passThroughEnv`: drop `MCP_LEGACY_ROOT`.
- Add `@prd-assist/server` `dev` overrides via root `turbo.json` (turbo allows per-package task overrides via `tasks: { "@prd-assist/server#dev": { dependsOn: [...] } }`).

### Root `package.json`
- `dependencies`: remove `@modelcontextprotocol/sdk`, `better-sqlite3`, `zod`.
- `scripts.dev`: drop `MCP_LEGACY_ROOT=$PWD ` prefix.

## Rejected Alternatives
- **Keep `validate.ts` as a re-export indirection**: rejected — adds a file that exists only to forward symbols. Direct imports are clearer.
- **Inline DDL into MCP for self-bootstrapping**: rejected by plan — server owns DDL, MCP fails fast.

## Accepted Risks
- **`import.meta.resolve` returns a `file:` URL synchronously since Node 20.6 (without `--experimental-import-meta-resolve`)**: required behavior. Verify on first dev run.
- **Schema guard does not detect column drift**: only checks the `sessions` table exists. Plan accepted-risk.

## Build Process

### Git Strategy
**Full Agentic**. Commit `[slice-4] <imperative>` direct to `main`.

### Verification Commands
```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm lint
test ! -d src/mcp
test -f apps/mcp/package.json
test -f apps/mcp/src/index.ts
```
Plus dev smoke: `pnpm dev` (no `MCP_LEGACY_ROOT` needed); `/api/health` 200; `POST /api/sessions` 201; SIGINT clean.

Plus schema-guard direct test: `SQLITE_PATH=/tmp/empty.sqlite node --import tsx/esm apps/mcp/src/index.ts` — should write JSON error to stderr and exit 2 within 1s. (Manual verification.)

## Verification Scenarios

### Scenario: dev runs without MCP_LEGACY_ROOT
- **Given**: Slice 4 shipped.
- **When**: `pnpm dev` from repo root with no env vars set.
- **Then**: Server resolves MCP via `import.meta.resolve("@prd-assist/mcp/package.json")`, spawns node --import tsx/esm with the resolved path, MCP child connects, /api/health 200.

### Scenario: MCP fails fast on uninitialized DB
- **Given**: Slice 4 shipped; sqlite path with no `sessions` table.
- **When**: `apps/mcp` is launched directly.
- **Then**: stderr contains structured JSON `{"error": "schema_not_initialized", "hint": "start apps/server first"}`; process exits 2 within 1s.

### Scenario: tests still 94/94
- **Given**: Slice 4 shipped.
- **When**: `pnpm test`.
- **Then**: 94 tests pass (parity with pre-slice-1).

## Adaptation Log

### 2026-04-19 — `validate.ts` kept as re-export file
- Original plan option was to delete `validate.ts`. Kept it as a two-line re-export so `validate.test.ts` keeps its import path (`./validate`) and the re-export layer is obvious to future readers.

### 2026-04-19 — `dispatch.test.ts` seeds locally instead of importing from apps/server
- **Conflict:** Cross-package relative import (`../../server/src/db`) broke `rootDir` constraint in `apps/mcp/tsconfig.json`. Options were: loosen rootDir, add `@prd-assist/server` as devDep (creates workspace cycle — server now imports mcp at runtime), or seed locally.
- **Change:** `dispatch.test.ts` opens a `:memory:` sqlite, runs the sessions-table DDL inline, inserts a row directly. No cross-package reach.

### 2026-04-19 — `bin` field dropped from `apps/mcp/package.json`
- **Conflict:** `bin: { "prd-assist-mcp": "./dist/index.js" }` caused `pnpm install` warnings because `./dist/index.js` doesn't exist (no build step). Field was aspirational; no dev or runtime code uses it.
- **Change:** Removed. If a production deploy path is ever added it can reintroduce the field alongside a real build output.

### 2026-04-19 — `apps/server` gains `@prd-assist/mcp` as a dependency
- **Why:** `import.meta.resolve("@prd-assist/mcp/package.json")` needs `@prd-assist/mcp` in server's declared deps for pnpm to symlink it into `apps/server/node_modules`.
- **Cycle note:** No actual cycle — apps/mcp does NOT depend on apps/server (dispatch.test.ts now seeds locally). Dependency is unidirectional: server → mcp (runtime path resolution) and shared is a leaf.

### 2026-04-19 — Root retains `zod`
- `zod` stays in root `dependencies` because `src/web/src/api.ts` still imports it. Moves out when slice 5 ships.

## Implementation Slices

### Slice 4: mcp-app-promoted
- What: per Scope.
- Verify: per Verification Commands and Scenarios.
- Outcome: `apps/mcp` is the canonical MCP. Server resolves MCP at runtime via `import.meta.resolve`. Root no longer carries MCP runtime deps. Legacy `src/mcp/` and `MCP_LEGACY_ROOT` are gone.

## Acceptance Criteria
- All Verification Commands exit 0.
- `src/mcp/` does not exist.
- `apps/mcp/package.json` includes `bin`, deps per Requirements.
- `apps/server/src/mcpClient.ts` does NOT contain `MCP_LEGACY_ROOT`.
- `turbo.json` `dev.passThroughEnv` does NOT contain `MCP_LEGACY_ROOT`.
- Root `package.json` `dependencies` does NOT contain `@modelcontextprotocol/sdk`, `better-sqlite3`, `zod`.
- Root `scripts.dev` does NOT contain `MCP_LEGACY_ROOT`.
- Schema guard verified manually.
- Manual dev smoke: /api/health 200, SIGINT clean.
