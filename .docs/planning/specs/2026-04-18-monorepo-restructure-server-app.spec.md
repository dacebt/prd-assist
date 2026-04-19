# Monorepo Restructure — Server App

## Project Status
refactor

## Parent Reference
- Kind: plan
- Plan: `../plans/2026-04-18-monorepo-restructure.plan.md`
- Slice: server-app
- Inherited constraints: Shared Foundation (bundler resolution, `@prd-assist/*` naming, source-direct shared consumption), Migration Invariants, cross-system scenario "dev environment survives every slice boundary", Git Strategy = Full Agentic.

## Intent
Promote `src/server/` to `apps/server/` as `@prd-assist/server`. Restructure routes into per-group modules, extract validation + error middleware + turn config, swap MCP launcher to env-driven (`MCP_COMMAND`/`MCP_ARGS` with `MCP_LEGACY_ROOT` fallback), wire SIGTERM cleanup with 3000ms MCP-close timeout, drop `transport.onclose → process.exit(1)`, consume wire schemas from `@prd-assist/shared/schemas`, run dev via `node --watch --import tsx/esm`. Strip server runtime deps from root.

## Scope

### In Scope
- Create `apps/server/{package.json, tsconfig.json, vitest.config.ts, src/}`.
- Move all of `src/server/*` into `apps/server/src/`.
- Restructure `routes.ts` into `routes/{index.ts, health.ts, sessions.ts, messages.ts}`. `index.ts` exports `registerRoutes(app, deps)` as a thin facade calling each per-group `register`.
- Create `apps/server/src/config.ts` exporting `TurnConfig` (`maxIterations`, `perCallTimeoutMs`, `wallClockMs`); `model` injected from `RouteDeps` at registration time.
- Create `apps/server/src/middleware/validate.ts` exporting `withValidation(schema)` and `withParam(schema)` for body/param parsing.
- Create `apps/server/src/middleware/errors.ts` exporting `mapErrorToResponse(c, err)` for `SessionBusyError` / `SessionNotFoundError` / generic 500 mapping.
- In `apps/server/src/sessions.ts`: drop the duplicated `SectionSchema`, `PrdSchema`, `ChatMessageSchema`, `MessagesSchema` (well — keep `MessagesSchema` since it's `z.array(ChatMessageSchema)` and ChatMessage is now from shared, so re-derive it locally in one line). Keep `SessionRowSchema` and `SessionSummaryRowSchema` (DB row shapes).
- Replace `mcpClient.ts` launcher with env-driven resolution:
  - Read `MCP_COMMAND` (and `MCP_ARGS`, space-delimited).
  - If `MCP_COMMAND` unset, fall back to `node --import tsx/esm <MCP_LEGACY_ROOT>/src/mcp/index.ts`.
  - If neither env var is set, throw with a clear error.
  - Forward `SQLITE_PATH` to child env when given.
- Remove `transport.onclose → process.exit(1)`. Replace with `console.error` log only; SIGTERM-driven shutdown owns clean exit.
- SIGTERM handler in `apps/server/src/index.ts`: on signal, call the `close` returned from `startServer` with a 3000ms timeout for `mcp.close()`. Hard exit (`process.exit(1)`) only if timeout fires.
- `apps/server/package.json`: declare deps and dev script `node --watch --import tsx/esm src/index.ts`. Move `pnpm.onlyBuiltDependencies: ["better-sqlite3"]` here.
- Root `package.json`:
  - Remove deps `hono`, `@hono/node-server`, `better-sqlite3`, `openai`, `@modelcontextprotocol/sdk`. Keep `zod` (still used by src/mcp + src/web).
  - Keep devDeps `tsx`, `vite`, `vitest`, `concurrently`, `@types/better-sqlite3`, `@types/node` (still needed for src/mcp dev, src/web build, scripts/, and src/mcp tests).
  - Change `scripts.dev` to `MCP_LEGACY_ROOT=$PWD concurrently -n apps,web -c cyan,magenta "turbo dev --filter=@prd-assist/server" "vite"`.
  - Change `scripts.typecheck` to `tsc --noEmit && turbo typecheck` (root tsc covers src/mcp + src/web + scripts; turbo covers apps + packages).
  - Change `scripts.test` to `vitest run && turbo test`.
  - Change `scripts.build` to `turbo build && vite build`.
  - Keep `scripts.lint` covering `src/` and `scripts/`; turbo lint runs apps + packages.
  - Remove `pnpm.onlyBuiltDependencies` (it migrated to apps/server; nothing at root needs builds anymore — `better-sqlite3` lives in src/mcp still, but wait — that DOES need it. Re-evaluate at implementation time; if src/mcp still needs it, keep at root until slice 4).
- Delete `src/server/` directory at end.

### Out of Scope
- Touching `src/mcp/` or `src/web/`. They still run from root.
- Any change to MCP DDL ownership (still in `apps/server/src/db.ts`).
- Removing the `MCP_LEGACY_ROOT` fallback (slice 4 deletes it atomically with the mcp move).
- Building anything: `apps/server` `build` is `tsc --noEmit` (parity-only), no emit.

## Implementation Constraints

### Architecture
- Routes split: each per-group module owns its inline request/param zod schemas. Wire schemas (Section, Prd, ChatMessage, Session*) come from `@prd-assist/shared/schemas`.
- `withValidation`/`withParam` use Hono's typed Variables generic so `c.get("body")` / `c.get("param")` are typed at the handler.
- `mapErrorToResponse` returns a `Response`-compatible JSON; handler calls `return mapErrorToResponse(c, err)`.

### Boundaries
- `apps/server/tsconfig.json`: `extends "../../tsconfig.base.json"`, `module: ES2022`, `moduleResolution: bundler`, `noEmit: true`, `rootDir: src`. NO composite, NO references.
- `apps/server/vitest.config.ts`: minimal; node env; include `src/**/*.test.ts`.
- `routes.test.ts` continues to call top-level `registerRoutes` — per-group registrars are internal.

### Naming
- Package name: `@prd-assist/server`.
- Group route files: `routes/health.ts`, `routes/sessions.ts`, `routes/messages.ts`. Each exports `register(app, deps)`.
- Middleware: `middleware/validate.ts`, `middleware/errors.ts`.

## Requirements

### `apps/server/package.json`
```json
{
  "name": "@prd-assist/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch --import tsx/esm src/index.ts",
    "build": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint --no-error-on-unmatched-pattern 'src/**/*.ts'"
  },
  "dependencies": {
    "@hono/node-server": "^1.19.14",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "@prd-assist/shared": "workspace:*",
    "better-sqlite3": "^11.10.0",
    "hono": "^4.12.14",
    "openai": "^4.104.0",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^25.6.0",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3",
    "vitest": "^2.1.9"
  },
  "pnpm": {
    "onlyBuiltDependencies": ["better-sqlite3"]
  }
}
```

### `apps/server/tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ES2022",
    "moduleResolution": "bundler",
    "noEmit": true,
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

### `apps/server/vitest.config.ts`
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

### `mcpClient.ts` env-driven launcher
Pseudocode:
```
const cmd = process.env.MCP_COMMAND;
const args = process.env.MCP_ARGS?.split(" ").filter(Boolean) ?? [];
let command: string, finalArgs: string[];
if (cmd) { command = cmd; finalArgs = args; }
else if (process.env.MCP_LEGACY_ROOT) {
  command = "node";
  finalArgs = ["--import", "tsx/esm", `${process.env.MCP_LEGACY_ROOT}/src/mcp/index.ts`];
} else {
  throw new Error("MCP launch unconfigured: set MCP_COMMAND or MCP_LEGACY_ROOT");
}
```
Remove `transport.onclose → process.exit(1)`. Keep `console.error("mcp_child_exited")` log.

### Root `package.json` script changes
- `dev`: `MCP_LEGACY_ROOT=$PWD concurrently -n apps,web -c cyan,magenta "turbo dev --filter=@prd-assist/server" "vite"`
- `typecheck`: `tsc --noEmit && turbo typecheck`
- `test`: `vitest run && turbo test`
- `build`: `turbo build && vite build`
- `lint`: unchanged

## Rejected Alternatives
- **Keep `routes.ts` flat**: rejected — plan locks the route-group split.
- **Inject `TurnConfig` per-route instead of in `RouteDeps`**: rejected — single config, single owner, no per-route divergence.
- **Hardcode `MCP_LEGACY_ROOT` in apps/server's dev script**: rejected — root knows where the repo lives, app shouldn't.
- **Drop `pnpm.onlyBuiltDependencies` at root immediately**: deferred — `src/mcp` still uses `better-sqlite3` at root until slice 4. Keep the root entry; apps/server gets its own.

## Accepted Risks
- **Hybrid root scripts feel awkward**: `tsc --noEmit && turbo typecheck` runs two TypeScript invocations. Acceptable until slice 5 collapses to plain `turbo`.
- **`MCP_LEGACY_ROOT=$PWD` shell-dependent**: `$PWD` works under bash/zsh which is what pnpm uses on macOS/Linux. If a contributor runs on a shell where `$PWD` is undefined, dev breaks. Acceptable for one-slice intermediate state.
- **`node --watch` + `tsx/esm` loader**: per plan accepted-risks, may need fuller `--import tsx` form if a CJS dep surprises us. Verify with first dev run.

## Build Process

### Git Strategy
**Full Agentic**. Commit format `[slice-3] <imperative>`. Direct on `main`, no PR.

### Verification Commands
```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm lint
test ! -d src/server
test -f apps/server/package.json
test -f apps/server/src/index.ts
test -f apps/server/src/routes/index.ts
test -f apps/server/src/routes/health.ts
test -f apps/server/src/routes/sessions.ts
test -f apps/server/src/routes/messages.ts
test -f apps/server/src/middleware/validate.ts
test -f apps/server/src/middleware/errors.ts
test -f apps/server/src/config.ts
```

Plus manual `pnpm dev`: server reachable on :5174, `/api/health` 200, `POST /api/sessions` 201, SIGINT clean (no orphaned MCP).

## Verification Scenarios

### Scenario: turbo dev runs apps/server
- **Given**: Slice 3 shipped.
- **When**: `pnpm dev` from repo root.
- **Then**: `concurrently` launches `turbo dev --filter=@prd-assist/server` and `vite`. Server reaches READY within 10s. `/api/health` 200. `POST /api/sessions` 201. SIGINT cleans, no orphan MCP child.

### Scenario: server SIGTERM cleans MCP within 3s
- **Given**: Slice 3 shipped, `pnpm dev` running.
- **When**: SIGTERM the server process.
- **Then**: Server invokes mcp.close() with 3000ms cap; MCP child exits within timeout window; server exits 0 within ~3.5s.

### Scenario: tests still pass
- **Given**: Slice 3 shipped.
- **When**: `pnpm test`.
- **Then**: Vitest run (root tests for src/mcp + src/web + apps/server) passes 94 tests at minimum (parity).

## Adaptation Log

### 2026-04-19 — Root retains `better-sqlite3` and `@modelcontextprotocol/sdk`
- **Conflict:** Plan slice-3 row says "remove `better-sqlite3`, `@modelcontextprotocol/sdk` from root deps" but the same row also says "root keeps `better-sqlite3` for src/mcp" — internal contradiction.
- **Change:** Removed `hono`, `@hono/node-server`, `openai` from root deps. Kept `better-sqlite3`, `@modelcontextprotocol/sdk`, `zod` at root because src/mcp still imports them. They leave root in slice 4 alongside the mcp move.

### 2026-04-19 — `turbo.json` `dev.passThroughEnv` added
- **Conflict:** `MCP_LEGACY_ROOT=$PWD pnpm dev` propagated through concurrently but turbo 2.x strips env vars from task processes by default. Server crashed: `MCP launch unconfigured`.
- **Change:** Added `passThroughEnv: ["MCP_LEGACY_ROOT", "MCP_COMMAND", "MCP_ARGS", "SQLITE_PATH", "LM_STUDIO_BASE_URL", "LM_STUDIO_MODEL"]` to `turbo.json`'s `dev` task. Slice 4 will narrow this list when MCP_LEGACY_ROOT goes away.

### 2026-04-19 — `apps/server/pnpm.onlyBuiltDependencies` removed
- **Conflict:** pnpm warns when this field appears on a workspace-member package — it only takes effect at workspace root.
- **Change:** Removed the field from `apps/server/package.json`. Root `pnpm.onlyBuiltDependencies` already lists `better-sqlite3`.

### 2026-04-19 — `src/mcp/dispatch.test.ts` imports flipped to `apps/server/src/...`
- **Conflict:** Test imports `openDatabase`/`createSessionStore` from src/server, which no longer exists.
- **Change:** Imports now reach into `../../apps/server/src/db` and `../../apps/server/src/sessions`. Cross-package reach-in is ugly but transient — slice 4 moves this test under apps/mcp and the imports become package-clean.

### 2026-04-19 — `packages/shared` test script gets `--passWithNoTests`
- **Conflict:** `vitest run` exits 1 when no test files exist; turbo flags the failure even though shared has no tests.
- **Change:** `packages/shared/package.json` `test` is `vitest run --passWithNoTests`. Reverts naturally if shared tests are added later.

## Implementation Slices

### Slice 3: server-app-promoted
- What: Create apps/server scaffolding; move src/server/* into apps/server/src/; restructure routes into per-group files; extract config + middleware; env-driven MCP launcher; SIGTERM handler; consume @prd-assist/shared/schemas in sessions.ts; root deps trimmed; root scripts updated; src/server/ deleted.
- Verify: All Verification Commands exit 0; manual dev smoke passes; all three Verification Scenarios hold.
- Outcome: `apps/server` is the canonical home for the server. Routes live in route-group modules. MCP client is env-driven. Root no longer carries server runtime deps.

## Acceptance Criteria
- All files in Verification Commands exist; src/server/ does not.
- `apps/server/package.json` declares the deps + scripts per Requirements.
- Root `package.json` removes `hono`, `@hono/node-server`, `better-sqlite3`, `openai`, `@modelcontextprotocol/sdk` from `dependencies`.
- Root `package.json` `scripts.dev` invokes `turbo dev --filter=@prd-assist/server` (not `tsx watch`).
- `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm lint` all exit 0.
- Manual `pnpm dev`: GET /api/health → 200 within 10s; SIGINT leaves no orphan MCP child within 3s.
- No `import` in `apps/server/src/sessions.ts` defines `SectionSchema` or `PrdSchema` locally — both come from `@prd-assist/shared/schemas`.
- `apps/server/src/mcpClient.ts` does NOT contain `process.exit(1)` in `transport.onclose`.
