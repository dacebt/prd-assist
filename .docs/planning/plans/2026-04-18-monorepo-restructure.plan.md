# Monorepo Restructure — Plan

## Project Status
refactor

## Intent
Convert the single-package `prd-assist` repo into a Turborepo + pnpm workspaces monorepo with three apps (`server`, `web`, `mcp`) and one shared package, while restructuring the server's flat-route layout into route-group modules with centralized validation, error mapping, and config. No feature work; no library swaps.

## Scope

### In Scope
- Promote `src/shared/` to `packages/shared` and add wire-format zod schemas to kill triplication in `src/server/sessions.ts`, `src/mcp/tools.ts`, `src/web/src/api.ts`
- Move `src/server/` → `apps/server/` with own `package.json`, `tsconfig.json`, `vitest.config.ts`
- Move `src/mcp/` → `apps/mcp/` with own `package.json` exposing a `bin` entry
- Move `src/web/` → `apps/web/` with own `package.json`, relocated `vite.config.ts`, `postcss.config.js`, `tailwind.config.js`
- Restructure `src/server/routes.ts` into per-route-group modules under `apps/server/src/routes/`
- Extract a central `TurnConfig` object (currently inline literals at `src/server/routes.ts:43-46`) and a `withValidation` middleware factory
- Replace the hardcoded `process.cwd()`-anchored MCP launcher in `src/server/mcpClient.ts:32-33` with env-var driven invocation of the `apps/mcp` package `bin`
- Add a SIGTERM handler in `apps/server` that calls `mcp.close()` before exit
- Replace `tsx watch` with `node --watch --import tsx/esm` per app, orchestrated via `turbo dev`
- Per-package `tsconfig.json` files inheriting from `tsconfig.base.json`; server and mcp use `nodenext` module resolution, web uses `bundler`
- Move `pnpm.onlyBuiltDependencies` to the package.jsons that own the native deps
- `data/` stays at repo root, path driven by existing `SQLITE_PATH` env var, added to `.gitignore`

### Out of Scope
- Any HTTP framework swap (Hono stays)
- Any MCP architectural change (remains a stdio child process spawned by server)
- Migration framework for SQLite schema (server keeps owning DDL; MCP fails fast on missing table)
- Backwards compatibility shims for old import paths
- Code cleanup beyond what restructuring routes.ts requires
- CI configuration (none exists today)
- Publishing packages to npm

## Shared Foundation
- Runtime: Node.js ≥ 20.11
- Language: TypeScript 5.9.x, strict mode, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`
- Package manager: pnpm ≥ 9, workspaces via `pnpm-workspace.yaml`
- Monorepo orchestrator: Turborepo (`turbo.json` at root)
- Module system: ESM throughout (`"type": "module"` in every package.json)
- Module resolution: `moduleResolution: "bundler"`, `module: "ES2022"` for every package. Adopted slice 2 by user direction so source is free of `.js` extensions on relative imports. `tsx` (dev), Vite (web), and `tsc --noEmit` (typecheck) all resolve extensionless imports natively; no package emits compiled JS that Node's native ESM resolver would consume, so the original `nodenext` choice bought nothing and cost noise.
- Workspace package naming: `@prd-assist/<name>` (`@prd-assist/server`, `@prd-assist/web`, `@prd-assist/mcp`, `@prd-assist/shared`)
- Workspace dependency syntax: `"@prd-assist/shared": "workspace:*"`
- Directory structure:
  ```
  prd-assist/
  ├── apps/
  │   ├── server/
  │   ├── web/
  │   └── mcp/
  ├── packages/
  │   └── shared/
  ├── data/                         # gitignored, runtime sqlite location
  ├── .docs/
  ├── package.json                  # workspace root, dev tooling only
  ├── pnpm-workspace.yaml
  ├── turbo.json
  ├── tsconfig.base.json
  ├── .eslintrc.cjs
  └── .prettierrc
  ```
- Dev runner: `node --watch --import tsx/esm src/index.ts` (per-app `dev` script, orchestrated by `turbo dev`). No `nodemon`, no bare `tsx watch`.
- Test runner: `vitest`, per-package `vitest.config.ts`, no workspace-level vitest config
- Shared package consumption model: source-direct. `packages/shared/package.json` `exports` field points at `./src/*.ts` for both `types` and `default` conditions. Consumers (server, mcp, web) resolve `@prd-assist/shared` to the live source files via pnpm's symlinked `node_modules`. tsx (server, mcp) and Vite (web) both compile TypeScript on import. NO `composite: true`, NO `tsc -b` build dependency for consumers in dev or production builds. `packages/shared` keeps a `build` script for sanity-check parity, but no consumer's `dev`, `build`, `test`, or `typecheck` task depends on it.

## Migration Invariants

These hold at every slice boundary — the moment any slice's spec is marked complete, all of these must be true. A slice that breaks any invariant is incomplete regardless of test or typecheck status.

- **Dev runs.** `pnpm dev` from the repo root launches a working development environment that serves the web UI and a functional server. The exact mechanism evolves per slice (see per-slice "Root state at end of slice" notes), but the invariant is unconditional.
- **Build runs.** `pnpm build` (or its turbo equivalent once introduced) produces all currently-migrated app outputs without error. Pre-migration code paths continue to build via whatever script previously built them.
- **Tests pass.** All tests that passed before the slice still pass after the slice. No `.skip`, no commented-out tests, no `--bail` masking failures.
- **Typecheck is green for both worlds.** `tsc --noEmit` (or per-package equivalent) succeeds against both the migrated tree AND the still-legacy tree, with no `// @ts-ignore` added during migration.
- **No orphaned processes.** Killing the dev orchestrator (`Ctrl-C` on `pnpm dev`) leaves zero MCP child processes alive after 2 seconds. This must be true at every slice boundary, including slices that don't touch MCP code.

## System Architecture

```digraph
// Slice dependency graph — arrow direction: dependent -> dependency
shared_package -> workspace_skeleton
server_app -> workspace_skeleton
server_app -> shared_package [label="imports types + wire schemas"]
mcp_app -> workspace_skeleton
mcp_app -> shared_package [label="imports types + wire schemas"]
mcp_app -> server_app [label="DDL precondition: server initializes sessions table"]
web_app -> workspace_skeleton
web_app -> shared_package [label="imports types + wire schemas"]

// Runtime dependency (not slice dependency) — server spawns mcp as child process
server_app -> mcp_app [label="runtime: spawns via package bin"]
```

- **workspace_skeleton**: Owns `pnpm-workspace.yaml`, root `package.json`, `turbo.json`, `tsconfig.base.json`, root `.gitignore` and tool configs (`.eslintrc.cjs`, `.prettierrc`). Does NOT own any application source. Foundation for everything else.
- **shared_package**: Owns `packages/shared` — types (`Session`, `SessionSummary`, `PRD`, `Section`, `SectionKey`, `ChatMessage`) and wire-format zod schemas. Does NOT own DB-row parsing schemas, HTTP transport, or React. Built before any app slice can use it.
- **server_app**: Owns `apps/server` — Hono HTTP routes, session store, LLM client, MCP client, mutex, turn loop, SQLite DDL. Does NOT own MCP tool implementations, React, or wire-format type definitions. Depends on `shared_package` for types and request/response schemas.
- **mcp_app**: Owns `apps/mcp` — MCP stdio server, tool implementations, MCP-side DB reader. Does NOT own DDL, HTTP routes, or session lifecycle. Depends on `shared_package` for types and on `server_app` initializing the SQLite schema before MCP performs reads.
- **web_app**: Owns `apps/web` — React UI, Vite build, Tailwind, react-router, API client. Does NOT own any server-side code. Depends on `shared_package` for types and response schemas.

## Shared Contracts

```digraph
// Contract ownership — arrow direction: owner -> consumer
shared_package -> server_app [label="defines DomainTypes, WireSchemas"]
shared_package -> mcp_app [label="defines DomainTypes"]
shared_package -> web_app [label="defines DomainTypes, WireSchemas"]
server_app -> mcp_app [label="defines SqliteSchema (DDL), McpLaunchProtocol"]
server_app -> web_app [label="defines HttpApi (URL paths + payload shapes via WireSchemas)"]
```

### DomainTypes
- **Owner**: `shared_package`
- **Consumers**: `server_app`, `mcp_app`, `web_app`
- **Shape**: TypeScript type definitions exported from `@prd-assist/shared`:
  - `SectionKey = "vision" | "problem" | "targetUsers" | "goals" | "coreFeatures" | "outOfScope" | "openQuestions"` (preserve current 7-key tuple from `src/shared/sections.ts`)
  - `SectionStatus = "empty" | "draft" | "confirmed"`
  - `Section = { content: string; updatedAt: string; status: SectionStatus }`
  - `PRD = Record<SectionKey, Section>` (concrete object literal, not mapped — preserve current PrdSchema field order)
  - `ChatMessage = { role: "user"; content: string; at: string } | { role: "assistant"; content: string; at: string }` (discriminated union)
  - `Session = { id: string; title: string; createdAt: string; updatedAt: string; messages: ChatMessage[]; prd: PRD }`
  - `SessionSummary = { id: string; title: string; updatedAt: string }`
- **Invariants**:
  - All timestamps are ISO 8601 strings
  - `SECTION_KEYS` exported as `readonly [...]` tuple in the order above
  - Empty `Session.title` is the literal empty string `""`, not `null` or `undefined`

### WireSchemas
- **Owner**: `shared_package`
- **Consumers**: `server_app` (request validation, response construction), `web_app` (response validation), `mcp_app` (DB-row parsing — see SqliteSchema for the DB-side variant)
- **Shape**: Zod schemas exported from `@prd-assist/shared/schemas`:
  - `SectionSchema`, `SectionStatusSchema`, `SectionKeySchema`, `PrdSchema`, `ChatMessageSchema`, `SessionSchema`, `SessionSummarySchema`, `SessionListSchema`
  - Each schema's parsed output type is the corresponding `DomainTypes` type
- **Invariants**:
  - Schemas are the single source of truth for validation; consumers do not re-declare equivalents
  - DB-row parsing schemas (`SessionRowSchema`, `PrdRowSchema` for raw `prd_json` strings) remain owned by their consuming slice (`server_app` and `mcp_app`) and are NOT moved to shared — they are persistence concerns, not wire concerns
  - `SectionStatusSchema` enum order: `["empty", "draft", "confirmed"]`

### HttpApi
- **Owner**: `server_app`
- **Consumers**: `web_app`
- **Shape**: REST endpoints, payloads validated against `WireSchemas`:
  - `GET /api/health` → `{ ok: true }`
  - `GET /api/sessions` → `SessionSummary[]` (validated by `SessionListSchema`)
  - `POST /api/sessions` → `{ id: string }`, status 201
  - `GET /api/sessions/:id` → `Session` (validated by `SessionSchema`); 404 `{ error: "session_not_found" }`
  - `POST /api/sessions/:id/messages` body `{ text: string }` (1–10000 chars after trim), 64KB max; → `{ reply: string }`; 409 `{ error: "session_busy" }`; 404 `{ error: "session_not_found" }`; 413 `{ error: "payload_too_large" }`; 400 `{ error: "invalid_request", details: [...] }`
- **Invariants**:
  - URL paths and HTTP status codes are stable — preserved exactly from current `src/server/routes.ts`
  - Error response shape: `{ error: string, message?: string, details?: unknown }`
  - Vite dev proxy in `apps/web` targets `http://127.0.0.1:5174` (current server port)

### McpLaunchProtocol
- **Owner**: `server_app`
- **Consumers**: `mcp_app`
- **Shape**: Server spawns MCP via stdio using these env vars (replaces `process.cwd()`-anchored hardcoded paths in `src/server/mcpClient.ts:32-33`):
  - `MCP_COMMAND` — executable path; default resolves to `apps/mcp` package's `bin` entry via `require.resolve("@prd-assist/mcp/package.json")` + reading `bin` field
  - `MCP_ARGS` — optional space-separated args; default empty
  - `SQLITE_PATH` — absolute path to sqlite file, passed through to MCP child env (existing behavior preserved)
- **Invariants**:
  - `apps/mcp/package.json` declares `"bin": { "prd-assist-mcp": "./dist/index.js" }` for future production deploys, but the dev path does NOT exercise the bin. Dev launch resolves `require.resolve("@prd-assist/mcp/package.json")` + computes sibling `src/index.ts` and spawns `node --import tsx/esm <that path>`. Source-direct throughout dev.
  - Server's SIGTERM handler calls `mcp.close()` with a 3000ms timeout before exit; `mcp.close()` sends stdin EOF + SIGTERM + SIGKILL to the child (existing `StdioClientTransport.close()` behavior)
  - Server's `transport.onclose` handler does NOT call `process.exit(1)` (current behavior at `src/server/mcpClient.ts:46-49` is incompatible with `node --watch` restart cycles) — it logs and lets the SIGTERM-driven shutdown path handle exit

### SqliteSchema
- **Owner**: `server_app`
- **Consumers**: `mcp_app`
- **Shape**: Single `sessions` table (preserved from `src/server/db.ts:8-18`):
  ```sql
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    messages_json TEXT NOT NULL DEFAULT '[]',
    prd_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_updated_at_idx ON sessions(updated_at DESC);
  ```
- **Invariants**:
  - `apps/server` runs DDL on startup (`openDatabase` keeps current pragmas: `journal_mode=WAL`, `foreign_keys=ON`, `synchronous=NORMAL`)
  - `apps/mcp` does NOT run DDL. On startup, MCP queries `sqlite_master` for the `sessions` table; if missing, MCP exits with a non-zero status and a structured stderr error `{ error: "schema_not_initialized", hint: "start apps/server first" }` instead of silently failing on every tool call
  - Both apps open the file in WAL mode; only one writer is intended at a time (server owns lifecycle, MCP writes only inside tool dispatch under the server-held mutex)

## Slice Manifest

### workspace-skeleton
- Domain: Add monorepo plumbing without touching a line of application source. Creates `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `turbo.json` (task definitions for `dev`, `build`, `typecheck`, `test`, `lint` — initially with empty or minimal task configs since no workspace packages exist yet), `tsconfig.base.json` (no `moduleResolution` set — per-package tsconfigs override), `.nvmrc` (pins Node 20.11+). Adds `turbo` to root `devDependencies`. Updates root `.gitignore` to include `data/`, `.turbo/`, `apps/*/dist`, `packages/*/dist` (`node_modules`, `dist` already present).
- Boundary: Root `package.json` `dependencies`, `devDependencies` (minus the turbo addition), `scripts`, and `pnpm.onlyBuiltDependencies` are UNCHANGED. NO app deps stripped from root, NO legacy scripts removed, NO existing config files deleted. Existing `src/` tree continues to run via unchanged legacy `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm typecheck`. NO directories created under `apps/` or `packages/`.
- Dependencies: none
- Root state at end of slice: identical to pre-slice except (a) `turbo` added to devDeps, (b) `turbo.json` + `pnpm-workspace.yaml` + `tsconfig.base.json` + `.nvmrc` present, (c) `.gitignore` expanded. Legacy `pnpm dev` still the developer's dev command.
- Key questions:
  - Exact `turbo.json` shape before any packages exist — does turbo accept an empty `tasks` object, or should each task be pre-declared with `cache: false` placeholders? Spec must verify by running `turbo run --help` post-setup.
  - `scripts/doc-edit-check.ts` location: LOCKED — stays at repo root, run via root `package.json` `doc-edit-check` script (which keeps `tsx` available at root until slice 4). Not a workspace package.
- Spec path: `.docs/planning/specs/2026-04-18-monorepo-restructure-workspace-skeleton.spec.md`

### shared-package
- Domain: Create `packages/shared/{package.json, tsconfig.json, src/}`. Move `src/shared/types.ts` and `src/shared/sections.ts` into `packages/shared/src/`. Add `packages/shared/src/schemas.ts` containing the WireSchemas (`SectionSchema`, `SectionStatusSchema`, `SectionKeySchema`, `PrdSchema`, `ChatMessageSchema`, `SessionSchema`, `SessionSummarySchema`, `SessionListSchema`) — exact shapes drawn from current duplicated definitions in `src/server/sessions.ts:6-27`, `src/mcp/tools.ts:13-27`, `src/web/src/api.ts:4-43`. `package.json` `exports` field:
  ```json
  "exports": {
    ".": { "types": "./src/index.ts", "default": "./src/index.ts" },
    "./schemas": { "types": "./src/schemas.ts", "default": "./src/schemas.ts" }
  }
  ```
  (Source-direct per Shared Foundation — no `dist/` output required for consumers.) `tsconfig.json` extends `tsconfig.base.json`, sets `moduleResolution: nodenext`, `module: nodenext`. NO `composite: true`. `scripts`: `typecheck` (`tsc --noEmit`), `test` (vitest, if any shared tests exist), `build` (`tsc --noEmit` — parity-only; no emit required). Replace relative imports in `src/server/sessions.ts`, `src/mcp/tools.ts`, `src/mcp/validate.ts`, `src/web/src/api.ts`, `src/web/src/components/*.tsx` that reference `../shared/...` or `../../shared/...` with `@prd-assist/shared`. Do NOT remove the duplicated zod schemas from consumer files in this slice; only flip the TYPE imports. Zod-schema consolidation happens in each consumer's slice.
- Boundary: Legacy `src/shared/` directory is deleted at end of this slice (all relative imports flipped to `@prd-assist/shared`). Consumer zod schemas remain duplicated; the zod consolidation is per-consumer-slice. App package.jsons do not exist yet — root `package.json` adds `"@prd-assist/shared": "workspace:*"` to `dependencies` so existing `src/server/*`, `src/mcp/*`, `src/web/*` can resolve the import under legacy scripts.
- Dependencies: workspace-skeleton
- Root state at end of slice: root `package.json` gains `@prd-assist/shared: workspace:*` in `dependencies`. `src/shared/` deleted. Legacy `pnpm dev` still works — tsx resolves `@prd-assist/shared` through pnpm's `node_modules` symlink to `packages/shared/src/index.ts`.
- Key questions:
  - Are the three current `SectionSchema` definitions actually byte-identical, or are there subtle differences (e.g., `SectionStatusSchema` defined inline in `src/mcp/tools.ts:17` vs via `src/mcp/validate.ts` enum)? Spec must diff `src/server/sessions.ts:6-20`, `src/mcp/tools.ts:13-27`, `src/web/src/api.ts:4-43` literally and document each delta before consolidating into one schema set.
  - `SECTION_KEYS_ARRAY` (`src/mcp/validate.ts:4-12` — readonly tuple for zod enum construction) — move to shared or keep MCP-local? Shared is the right home since `SECTION_KEYS` already lives there; unifying avoids duplicate truth.
  - Which files import from `../shared/` or `../../shared/`? Spec must grep exhaustively before starting — missing one leaves a broken legacy path when `src/shared/` is deleted.
- Spec path: `.docs/planning/specs/2026-04-18-monorepo-restructure-shared-package.spec.md`

### server-app
- Domain: `apps/server/{package.json, tsconfig.json, vitest.config.ts, src/}`. Move `src/server/*` into `apps/server/src/`. Atomic with the move:
  - Flip imports from `../shared/...` to `@prd-assist/shared` (types) and `@prd-assist/shared/schemas` (zod)
  - Remove duplicated zod schemas from `apps/server/src/sessions.ts` (keep `SessionRowSchema` and `MessagesSchema` — those are persistence concerns, not wire concerns)
  - Restructure `routes.ts` into route-group modules under `apps/server/src/routes/{health.ts, sessions.ts, messages.ts}`. Each module exports a `register(app, deps)` function. Top-level `registerRoutes` becomes a thin facade that calls each registrar in order.
  - Extract `TurnConfig` (currently inline literals at `src/server/routes.ts:43-46` — `maxIterations: 12`, `perCallTimeoutMs: 90_000`, `wallClockMs: 300_000`) into `apps/server/src/config.ts`. `RouteDeps` and `TurnDeps` consume from this single object.
  - Extract `withValidation(schema)` middleware factory into `apps/server/src/middleware/validate.ts` — replaces the three inline `safeParse` blocks
  - Extract `mapErrorToResponse(err)` into `apps/server/src/middleware/errors.ts` — centralizes the `SessionBusyError` / `SessionNotFoundError` mapping currently inlined in the messages route
  - Add SIGTERM handler in `apps/server/src/index.ts` that calls the `close` returned from `startServer`, which in turn calls `mcp.close()` and `db.close()` before exit
  - Replace `mcpClient.ts` launcher: read `MCP_COMMAND` and `MCP_ARGS` env vars. If `MCP_COMMAND` unset, fall back to the `MCP_LEGACY_ROOT` path (see Boundary). If both unset, throw with a clear error — no silent `process.cwd()` guessing.
  - Remove `transport.onclose → process.exit(1)` (replace with `console.error` log; let SIGTERM-driven shutdown handle clean exit)
  - `package.json` declares `dependencies`: `hono`, `@hono/node-server`, `better-sqlite3`, `openai`, `@modelcontextprotocol/sdk`, `zod`, `@prd-assist/shared@workspace:*`. `devDependencies`: `tsx`, `vitest`, `@types/better-sqlite3`, `@types/node`, `typescript`. `pnpm.onlyBuiltDependencies: ["better-sqlite3"]`. `bin`-less. `scripts`: `dev` (`node --watch --import tsx/esm src/index.ts`), `build` (`tsc --noEmit`), `typecheck` (`tsc --noEmit`), `test` (`vitest`), `lint` (`eslint src`). Note: loader form is `--import tsx/esm`; if spec discovers a CJS-only dep in the tree that requires the full `--require tsx/dist/preflight.cjs --import tsx/dist/loader.mjs` form (see Accepted Risks), spec escalates.
  - `tsconfig.json`: extends `tsconfig.base.json`; `moduleResolution: nodenext`, `module: nodenext`. NO `composite`, NO project `references` (per Shared Foundation source-direct model). Shared is resolved through `node_modules` symlink to its `exports` entries.
  - `vitest.config.ts`: `include: ["src/**/*.test.ts"]`, `environment: node`. Test factory updates: `routes.test.ts` `buildApp()` continues to call top-level `registerRoutes` facade — per-group registrars are an internal concern not exposed to tests.
- Boundary: Does NOT touch `src/mcp/` (still-legacy) or `src/web/` (still-legacy). LOCKED: during this slice's active lifetime and until slice 4 ships, `MCP_COMMAND` defaults to a documented fallback that invokes `node --import tsx/esm <repo-root>/src/mcp/index.ts` with cwd set to repo root. Fallback is gated on an env var `MCP_LEGACY_ROOT=<repo-root-abs-path>` so the resolution logic is explicit, not cwd-dependent. Fallback is deleted in slice 4 atomically with the mcp move.
- Dependencies: workspace-skeleton, shared-package
- Root state at end of slice: root `package.json` removes server runtime deps (`hono`, `@hono/node-server`, `better-sqlite3`, `openai`, `@modelcontextprotocol/sdk` — `zod` stays because `src/mcp/` and `src/web/` still use it). Root `scripts.dev` changes from `concurrently -n server,web -c cyan,magenta "tsx watch src/server/index.ts" "vite"` to `concurrently -n server,web -c cyan,magenta "turbo dev --filter=@prd-assist/server" "vite"`. Root keeps `tsx`, `vite`, `vitest`, `concurrently`, and `better-sqlite3` in devDeps/deps (needed for still-legacy `src/mcp/` dev runs, `src/web/` Vite, and `scripts/doc-edit-check.ts`). Root `pnpm.onlyBuiltDependencies` keeps `better-sqlite3` until slice 4. Legacy `src/server/` directory deleted at end of this slice.
- Key questions:
  - SIGTERM handler force-kill timeout: specify milliseconds (recommend 3000ms based on `StdioClientTransport.close()`'s SIGTERM→SIGKILL escalation already being internal to the MCP SDK — server's handler only needs to prevent the shutdown from hanging indefinitely if `mcp.close()` itself throws).
  - Routes split layout: each route group's request schemas live INLINE in its own file under `apps/server/src/routes/` (fewer files, colocation with handler). WireSchemas from `@prd-assist/shared/schemas` are used for response validation only. Request body/param schemas are server-local since they're transport concerns (e.g., `PostMessageBodySchema`'s trim/length rules).
  - `withValidation` middleware typing: typed Hono `c.get("validated")` with a per-route context variable. Spec locks the exact Hono context extension pattern.
  - Existing `console.log(\`turn ${sessionId.slice(0, 8)}...\`)` observability at `src/server/turn.ts:211-213` stays unchanged — observability is out of scope for this restructure.
  - Where does the `apps/server` `dev` script get its `MCP_LEGACY_ROOT` env value? Options: hardcoded in `apps/server/package.json`'s `dev` script, or set at the root `scripts.dev` orchestrator level. Spec must pick one and justify.
- Spec path: `.docs/planning/specs/2026-04-18-monorepo-restructure-server-app.spec.md`

### mcp-app
- Domain: `apps/mcp/{package.json, tsconfig.json, vitest.config.ts, src/}`. Move `src/mcp/*` into `apps/mcp/src/`. Atomic with the move:
  - Flip imports from `../shared/...` to `@prd-assist/shared`
  - Remove duplicated zod schemas in `apps/mcp/src/tools.ts` (keep `PrdRowSchema` — persistence concern)
  - Add schema-existence guard in `apps/mcp/src/index.ts`: query `sqlite_master`; if `sessions` table missing, write `{ "error": "schema_not_initialized", "hint": "start apps/server first" }` to stderr and `process.exit(2)`
  - `package.json` declares `bin: { "prd-assist-mcp": "./dist/index.js" }` (production-only; dev path does not use bin). `dependencies`: `@modelcontextprotocol/sdk`, `better-sqlite3`, `zod`, `@prd-assist/shared@workspace:*`. `devDependencies`: `tsx`, `vitest`, `@types/better-sqlite3`, `@types/node`, `typescript`. `pnpm.onlyBuiltDependencies: ["better-sqlite3"]`. `scripts`: `dev` (`node --watch --import tsx/esm src/index.ts`), `build` (`tsc --noEmit`), `typecheck` (`tsc --noEmit`), `test` (`vitest`), `lint` (`eslint src`).
  - `tsconfig.json`: same shape as server — extends base, `moduleResolution: nodenext`, `module: nodenext`. NO `composite`, NO project `references`.
  - Update `apps/server/src/mcpClient.ts` (cross-slice surgical edit): default `MCP_COMMAND` resolution uses `require.resolve("@prd-assist/mcp/package.json")` + computes sibling `src/index.ts` path; server spawns `node --import tsx/esm <path>` directly. Delete the `MCP_LEGACY_ROOT` fallback introduced in slice 3.
  - Update `turbo.json` `dev` task: `@prd-assist/server`'s `dev` declares `dependsOn: ["@prd-assist/mcp#typecheck"]` (not `#build`) — source-direct consumption means no MCP build is required, but typecheck ensures MCP code is at least valid before server attempts to spawn it.
- Boundary: Does NOT touch routes, sessions, or web source. DDL stays in `apps/server/src/db.ts`; this slice only adds the fail-fast guard in `apps/mcp/src/index.ts`. Surgical cross-slice edits limited to: `apps/server/src/mcpClient.ts` (remove `MCP_LEGACY_ROOT` fallback, switch to `require.resolve` default) and `turbo.json` (wire task dependency or dev-bin path).
- Dependencies: workspace-skeleton, shared-package, server-app
- Root state at end of slice: root `package.json` removes MCP runtime deps that are no longer used at root — `@modelcontextprotocol/sdk` (if still present), and `better-sqlite3` can finally leave root since `src/mcp/` is gone. `pnpm.onlyBuiltDependencies` removed from root. Root `scripts.dev` becomes `concurrently -n apps,web -c cyan,magenta "turbo dev --filter=@prd-assist/server --filter=@prd-assist/mcp" "vite"` — still a hybrid because `src/web/` has not moved. Legacy `src/mcp/` directory deleted. `MCP_LEGACY_ROOT` env var and its fallback path are deleted from `apps/server/src/mcpClient.ts` in this same slice — no orphan code.
- Key questions:
  - Dev launch model LOCKED: `apps/server`'s MCP client spawns `apps/mcp` via `node --import tsx/esm <resolved-path>/src/index.ts` (source-direct; no MCP build required for hot reload). The resolved path comes from `require.resolve("@prd-assist/mcp/package.json")` + computing the sibling `src/index.ts`. Production build model: `apps/mcp` `bin` entry points at `./dist/index.js` for future deploys; production path is NOT exercised in dev.
  - Does the server SIGTERM handler wait for MCP child exit confirmation, or fire-and-forget after invoking `mcp.close()`? LOCKED: wait up to 3000ms for close to resolve, then proceed with server shutdown; SDK's internal SIGKILL escalation handles any child that refuses to exit.
  - Schema-existence guard test strategy LOCKED: vitest spawns the MCP entrypoint as a subprocess via `node:child_process.spawn` against a fresh in-memory-backed file (`:memory:` is per-process so use a tempfile), asserts structured JSON on stderr and exit code 2 within a 2-second timeout.
  - Turbo pipeline: `@prd-assist/server`'s `dev` task declares `dependsOn: ["@prd-assist/mcp#typecheck"]` (not `#build`, since consumption is source-direct). This keeps server-dev fast while ensuring MCP code at least typechecks before server attempts to spawn it.
- Spec path: `.docs/planning/specs/2026-04-18-monorepo-restructure-mcp-app.spec.md`

### web-app
- Domain: `apps/web/{package.json, tsconfig.json, vite.config.ts, postcss.config.js, tailwind.config.js, index.html, src/}`. Move `src/web/*` into `apps/web/src/` (the `src/web/index.html` and existing `src/web/src/` collapse: `apps/web/index.html` at app root, `apps/web/src/` for TS/TSX). Atomic with the move:
  - Flip imports from `../../shared/...` to `@prd-assist/shared` (types) and `@prd-assist/shared/schemas` (zod)
  - Remove duplicated zod schemas in `apps/web/src/api.ts` (use `SessionSchema`, `SessionListSchema`, `SessionSummarySchema` from shared)
  - `package.json` declares `dependencies`: `react`, `react-dom`, `react-router-dom`, `react-markdown`, `remark-gfm`, `zod`, `@prd-assist/shared@workspace:*`. `devDependencies`: `vite`, `@vitejs/plugin-react`, `vitest`, `tailwindcss`, `postcss`, `autoprefixer`, `@types/react`, `@types/react-dom`, `typescript`, `jsdom` (if web tests need it — see Key questions). `scripts`: `dev` (`vite`), `build` (`vite build`), `preview` (`vite preview`), `typecheck` (`tsc --noEmit`), `test` (`vitest`), `lint` (`eslint src`).
  - `tsconfig.json`: extends `tsconfig.base.json`; `moduleResolution: bundler`, `jsx: react-jsx`, `module: ESNext`. NO `composite`, NO project `references` (source-direct shared consumption).
  - `vite.config.ts`: `root` is the `apps/web` directory, `outDir: dist`, proxy `/api → http://127.0.0.1:5174`.
  - At end of this slice: delete the `src/` tree (if any legacy content remains), delete root `vite.config.ts`, `vitest.config.ts`, `postcss.config.js`, `tailwind.config.js`, collapse root `scripts.dev` from the hybrid `concurrently` form to plain `turbo dev`.
- Boundary: Does NOT touch server or mcp source. Touches root `package.json` only to: (a) remove web/build runtime deps (`react`, `react-dom`, `react-router-dom`, `react-markdown`, `remark-gfm`), (b) remove web/build devDeps (`vite`, `@vitejs/plugin-react`, `tailwindcss`, `postcss`, `autoprefixer`, `@types/react`, `@types/react-dom`, `vitest`, `concurrently`), (c) collapse `scripts.dev` to `turbo dev`, `scripts.build` to `turbo build`, `scripts.test` to `turbo test`, `scripts.typecheck` to `turbo typecheck`, `scripts.lint` to `turbo lint`, `scripts.doc-edit-check` stays (invokes `tsx scripts/doc-edit-check.ts` — `tsx` remains a root devDep to support this and any future root-level scripts). Deletes root `vite.config.ts`, `vitest.config.ts`, `postcss.config.js`, `tailwind.config.js`.
- Dependencies: workspace-skeleton, shared-package. (INDEPENDENT of mcp-app — can ship before or after slice 4; ordering in the manifest is suggestion, not constraint.)
- Root state at end of slice: root `package.json` has no app runtime deps. `devDependencies` are only `turbo`, `typescript`, `eslint`, `@typescript-eslint/*`, `prettier`, `tsx` (for `scripts/`). Legacy `src/` tree fully deleted. `pnpm dev` is now `turbo dev`. `zod` is finally removed from root (lived there for shared via hoisting; each app now declares zod as its own dep).
- Key questions:
  - Does `src/web/src/hooks/polling.test.ts` need `environment: jsdom` (DOM APIs) or `environment: node` (current root default)? Spec must inspect the test before locking `apps/web/vitest.config.ts`. If any web test touches DOM/browser globals, add `jsdom`.
  - Tailwind content paths: `apps/web/tailwind.config.js` `content` array updates from `["./src/web/**/*.{ts,tsx,html}"]`-style to `["./index.html", "./src/**/*.{ts,tsx}"]` (paths relative to `apps/web/` root).
  - `apps/web/src/vite-env.d.ts` copies verbatim unless a monorepo-specific import.meta.env augmentation is needed — none currently exists.
- Spec path: `.docs/planning/specs/2026-04-18-monorepo-restructure-web-app.spec.md`

## Cross-System Verification Scenarios

### Scenario: full PRD-update turn end-to-end under turbo dev
- **Given**: All five slices shipped. Repo root has run `pnpm install` and `turbo build`. `turbo dev` is running and stable; web is reachable, server is reachable, MCP child has been spawned by server.
- **When**: A user opens a session in the web UI and posts a message that requires the LLM to call `update_section` on the MCP server (e.g., "set the vision to X").
- **Then**: The web client receives a 200 response with the assistant reply text. `GET /api/sessions/:id` returns a `Session` whose `prd.vision` reflects the updated content with `status: "draft"` and a fresh `updatedAt`. No errors in any of the three `turbo dev` log streams. The `Session` round-trips through `SessionSchema` validation in the web client.

### Scenario: dev restart preserves MCP integrity
- **Given**: All five slices shipped. `turbo dev` is running. A session has been created and contains at least one message.
- **When**: A developer edits `apps/server/src/turn.ts`, triggering `node --watch` to SIGTERM the server process. The new server process starts.
- **Then**: The old MCP child process exits cleanly (no orphaned process visible in `ps` after 2 seconds). The new server spawns a fresh MCP child. The next message posted to the existing session succeeds. The SQLite WAL has no second writer at any point during the restart window. The server's `transport.onclose` handler logs the disconnection but does NOT call `process.exit`.

### Scenario: MCP cannot start without server-initialized schema
- **Given**: All five slices shipped. A fresh sqlite path with no `sessions` table.
- **When**: A developer (or accidental misconfiguration) launches `apps/mcp` directly without first running `apps/server`.
- **Then**: The MCP process writes a structured JSON error to stderr (`{ "error": "schema_not_initialized", "hint": "start apps/server first" }`) and exits with code 2 within 1 second. No tool calls succeed silently against an empty DB.

### Scenario: dev environment survives every slice boundary
- **Given**: A clean checkout of any intermediate state — after slice 1, after slice 2, after slice 3, after slice 4, or after slice 5 (all five combinations).
- **When**: A developer runs `pnpm install` followed by `pnpm dev` from the repo root.
- **Then**: Within 10 seconds the web UI is reachable at its current dev URL, the server responds 200 on `GET /api/health`, and a fresh session can be created via `POST /api/sessions`. No orphaned MCP child process exists after `Ctrl-C`. `pnpm build`, `pnpm test`, and `pnpm typecheck` also succeed at the same checkout. This scenario is non-negotiable — a slice that breaks it is not complete, regardless of any other verification result.

### Scenario: shared schema divergence cannot persist
- **Given**: All five slices shipped.
- **When**: A developer adds a new field to `Section` in `packages/shared/src/types.ts` and `SectionSchema` in `packages/shared/src/schemas.ts`, then runs `turbo typecheck`.
- **Then**: All three apps either compile against the new shape or fail typecheck pointing at the specific consumer site. No app silently parses old-shape JSON because it kept its own zod schema — there is exactly one `SectionSchema` and it lives in shared.

## Rejected Alternatives
- **NestJS framework swap**: Rejected. Set-based analysis (plan-mode) showed every assertion in `routes.test.ts` would require rewriting (Hono's `app.fetch(new Request(...))` interface has no NestJS equivalent), with no benefit at this scale (8 routes, LAN-only, manual DI in `turn.ts` already works). User confirmed this is a file-organization perception, not a library mismatch.
- **Fastify framework swap**: Rejected for the same test-rewrite cost as NestJS without NestJS's stronger DI signal. Considered as the secondary option if "framework" was a hard requirement; user confirmed it was not.
- **MCP collapsed into a packages/mcp-tools library**: Rejected by user directive — MCP must remain a separate process to preserve the stdio transport contract.
- **Nodemon + tsx loader**: Rejected. `node --watch --import tsx/esm` (Node 20.11+ native) eliminates the dev-runner dependency entirely with equivalent behavior.
- **MCP owns DDL + migrations framework**: Rejected as out of scope. Current state has server owning DDL implicitly; this plan makes that explicit (server initializes, MCP fail-fast asserts) without adopting a migrations library. Revisit when a schema change is actually needed.
- **Schema migration to packages/shared as a "migrations" module**: Rejected for this restructure. Server keeps DDL; MCP fails fast. A future feature can promote DDL to shared if standalone-MCP becomes a real use case.

## Accepted Risks
- **Brief WAL race window during dev SIGTERM cycle**: If the server's SIGTERM handler throws or stalls before `mcp.close()` completes, the old MCP child can briefly coexist with a new one before being killed. Mitigated by the explicit handler + a force-kill timeout (spec'd in server-app slice). Production-irrelevant; dev-only.
- **`tsx/esm` short-form may differ from current full `--require tsx/dist/preflight.cjs --import tsx/dist/loader.mjs`**: The full form registers a CJS interop hook the short form omits. Better-sqlite3 works under both; rare CJS-only deps may behave differently. Spec for server-app must verify the loader form against the actual dep tree before locking it.
- **Turbo cache poisoning on `better-sqlite3` ABI**: Native binary is Node-ABI specific and not in any source-tree input. Mitigated by `cache: false` on the `test` task in `turbo.json`. Loses test caching, accepted as the cost of correctness.
- **`require.resolve("@prd-assist/mcp/package.json")` must work under pnpm's symlinked `node_modules`**: Validated in spec for mcp-app. If pnpm's hoisting strategy breaks resolution from `apps/server`, the fallback is an absolute path env var.
- **Slice 3 (server-app) ships before slice 4 (mcp-app)**: Server's `MCP_COMMAND` fallback resolves via `MCP_LEGACY_ROOT` env var pointing at the still-rooted `src/mcp/index.ts`. Dev-only intermediate state; the fallback code and env var are deleted atomically in slice 4.
- **Hybrid root `dev` script during slices 3–4**: Root `pnpm dev` orchestrates `turbo dev` for migrated apps + still-legacy `vite` via `concurrently`. Two orchestrators in one command is awkward but preserves the Migration Invariant. Resolves at slice 5 when root `dev` collapses to `turbo dev`.
- **Source-direct shared consumption**: `packages/shared/exports` points at `.ts` source. Consumers compile shared on import (tsx for Node apps, Vite for web). If a future consumer appears that cannot compile TS on import, shared needs a `build` step and consumer package.json must wait on `^build`. We accept this cost because it collapses the "tsconfig-before-import-flip" intermediate state rival identified as highest-risk.
- **The standalone MCP fail-fast guard is the only safeguard against schema drift**: If the server adds a column without MCP being updated, MCP keeps reading old shape. This is the same risk as today (no migration framework); the guard only catches "table missing," not "table changed."

## Git Strategy

Project-wide cadence for the monorepo-restructure plan:

- **Slice 1 (workspace-skeleton):** Full HITL — shipped as commit `99a0bfa` on 2026-04-19.
- **Slices 2–5 (shared-package, server-app, mcp-app, web-app):** **Full Agentic** — AI commits after every slice that passes gates; no pause between slices for user review.

Locked details (apply to all slices):
- Branch: direct on `main`. No feature branches.
- PRs: none. Commits land directly on `main`.
- Commits per slice: exactly one.
- Tags: none.
- Commit message: `[slice-N] <imperative summary>`.
- Verification posture: every slice must pass the Migration Invariants and the spec's Verification Commands before commit.

## Adaptation Log

### 2026-04-19 — Module resolution switched to `bundler` for all packages
- **Conflict:** Plan locked `nodenext` for server/mcp tsconfigs. Reality: `nodenext` requires `.js` suffix on every relative import (because TS does not rewrite paths and Node's ESM loader would, hypothetically, consume the suffixed paths). User strongly objects to seeing `.js` in `.ts` source.
- **Why bundler is fine:** `tsx` runs server/mcp source directly in dev; Vite handles web; `tsc --noEmit` is the only TS invocation. No compiled `.js` is ever produced for Node's native loader to resolve. The `nodenext` choice was paying syntactic cost for a runtime behavior that does not exist in this project.
- **Change:** Shared Foundation now locks `moduleResolution: "bundler"`, `module: "ES2022"` for every package. Slices 3–5 will declare those values in their per-app tsconfigs. Slice 2 implementation already adopted this; the spec's Requirements section was superseded in-flight.
- **Affects:** Slice 2 (already shipped under this rule), slices 3–5 (future).

### 2026-04-19 — Git strategy switched to Full Agentic for slices 2–5
- Slice 1 (`workspace-skeleton`) was authored and shipped under Full HITL (commit `99a0bfa`). After that landed, user directed the remaining slices run Full Agentic to remove the inter-slice handoff.
- Each subsequent spec will declare Full Agentic in its own Git Strategy section. The Migration Invariants gate every commit, so the runnability bar that made HITL safe still holds without the manual pause.
