# Investigation Report

**Question:** Before we begin I'd like you to take a look at the current system and take inventory on the current state

**Date:** 2026-04-25

**Scope:**
- **In scope:** Repository structure, workspace scripts, current git state, app entrypoints, HTTP/session/message flow, MCP tool surface, PRD data model, tests/checks, and existing planning docs.
- **Out of scope (deliberately):** Real LM Studio turn execution and browser UI inspection. A full message turn would require a live local model and would mutate session state; this inventory only used a disposable SQLite file for read-only endpoint observation.
- **Observation:** The running backend was invoked in a one-shot Node process using `startServer` with `sqlitePath: "/tmp/prd-assist-inventory-single.sqlite"`, a stub LLM, and an ephemeral localhost port. It logged `listening on 127.0.0.1:60517`; `GET /api/health` returned `200 {"ok":true}` and `GET /api/sessions` returned `200 []`. The normal watch-mode dev entrypoint `SQLITE_PATH=/tmp/prd-assist-inventory.sqlite pnpm --filter @prd-assist/server dev` failed before serving with `EMFILE: too many open files, watch`; running `node --import tsx/esm apps/server/src/index.ts` inside the sandbox failed with `listen EPERM`, but the same server path ran with elevated localhost permission.

---

## Summary

The current system is a pnpm/Turbo TypeScript monorepo with `apps/web`, `apps/server`, `apps/mcp`, and `packages/shared` (`pnpm-workspace.yaml:1`). It has moved beyond the original single-supervisor MVP: the server now contains a routed multi-agent turn pipeline with orchestrator, interviewer, planner, worker, verifier, and summary stages reachable from the message route (`apps/server/src/turn.ts:128`, `apps/server/src/turn.ts:149`, `apps/server/src/turn.ts:199`). `pnpm typecheck` and `pnpm test` pass, and a disposable backend observation confirms health and empty session-list endpoints run. `pnpm lint` currently fails on existing server function/file size and complexity rules in `plannerBig.ts`, `turn.ts`, `workers.ts`, and `turn-toolcalls.test.ts`.

---

## Current System Inventory

The workspace root declares pnpm `10.33.0`, Node `>=20.11`, and root scripts for `dev`, `build`, `typecheck`, `test`, `lint`, `doc-edit-check`, and formatting (`package.json:5`, `package.json:10`). Turbo runs package tasks across four workspace packages and marks dev tasks as persistent, with environment pass-through for MCP, SQLite, and LM Studio settings (`turbo.json:4`, `turbo.json:7`, `turbo.json:15`). The root `dev` script starts only the server and web packages, not the MCP package directly, because the server spawns MCP as a child (`package.json:11`, `apps/server/src/mcpClient.ts:30`).

The git working tree is not clean: `apps/web/src/components/NewSessionButton.tsx`, `apps/web/src/components/SessionList.tsx`, and `apps/web/src/pages/SessionListPage.tsx` are modified. The diff is presentational: button styling, a session progress bar, and list-page layout changes. No investigation edits were made to those files.

The web app is a Vite React app with routes for `/` and `/sessions/:id` (`apps/web/src/router.tsx:9`). Its API client validates server responses with shared Zod schemas, posts session creation to `POST /api/sessions`, loads sessions through `GET /api/sessions/:id`, deletes sessions through `DELETE /api/sessions/:id`, and parses SSE frames from `POST /api/sessions/:id/messages` into `thinking`, `final`, and `error` events (`apps/web/src/api.ts:7`, `apps/web/src/api.ts:38`, `apps/web/src/api.ts:77`). This means the frontend contract is now streaming-oriented, not the older JSON reply contract.

The server entrypoint reads `SQLITE_PATH`, `LM_STUDIO_BASE_URL`, and `LM_STUDIO_MODELS_OVERRIDE`, defaults SQLite to `./data/prd-assist.sqlite`, defaults LM Studio to `http://localhost:1234/v1`, and listens on `127.0.0.1:5174` (`apps/server/src/index.ts:9`, `apps/server/src/index.ts:16`). Startup opens SQLite, creates the session store, creates the MCP client, registers routes, and starts Hono (`apps/server/src/server.ts:29`, `apps/server/src/server.ts:32`, `apps/server/src/server.ts:36`). The route surface is health, sessions, and messages: `/api/health` returns `{ ok: true }`, session routes handle list/create/get/delete, and the message route streams SSE while calling `handleTurn` (`apps/server/src/routes/health.ts:4`, `apps/server/src/routes/sessions.ts:6`, `apps/server/src/routes/messages.ts:31`).

The shared domain model is a seven-section PRD with fixed keys `vision`, `problem`, `targetUsers`, `goals`, `coreFeatures`, `outOfScope`, and `openQuestions` (`packages/shared/src/types.ts:1`, `packages/shared/src/sections.ts:3`). Each section has `content`, `updatedAt`, and `status`, where status is `empty | draft | confirmed` (`packages/shared/src/types.ts:10`, `packages/shared/src/types.ts:12`). The shared schemas mirror that shape and validate session summaries with `exchangeCount` and `sectionsConfirmed` (`packages/shared/src/schemas.ts:14`, `packages/shared/src/schemas.ts:38`).

Persistence is SQLite through `better-sqlite3`. The backend creates a `sessions` table with `messages_json`, `prd_json`, and nullable `prd_summary`, plus a `schema_version` table, WAL mode, foreign keys, and `synchronous = NORMAL` (`apps/server/src/db.ts:57`, `apps/server/src/db.ts:62`). Session creation stores one row with empty title, empty messages, and an initialized seven-section PRD (`apps/server/src/sessions.ts:48`). Session list summaries derive exchange count from user messages and confirmed-section count from the PRD JSON (`apps/server/src/sessions.ts:56`, `apps/server/src/sessions.ts:61`).

The current message turn is multi-stage. `handleTurn` acquires a per-session mutex, loads the session, appends and persists the user message, derives a title when needed, then classifies the turn through the orchestrator (`apps/server/src/turn.ts:103`, `apps/server/src/turn.ts:113`, `apps/server/src/turn.ts:128`). If the orchestrator says no PRD work is needed, the turn runs `interviewerBig`; if work is needed, it runs planner, sequential workers, planner verification, and `interviewerSmall` (`apps/server/src/turn.ts:149`, `apps/server/src/turn.ts:165`, `apps/server/src/turn.ts:199`, `apps/server/src/turn.ts:212`, `apps/server/src/turn.ts:227`). Final replies are persisted, and PRD-touching turns attempt summary regeneration (`apps/server/src/turn.ts:51`, `apps/server/src/turn.ts:68`, `apps/server/src/turn.ts:236`).

The MCP app is a stdio server that opens the same SQLite file, refuses to start if the backend schema has not initialized `sessions`, exposes the manifest, and dispatches tool calls (`apps/mcp/src/index.ts:9`, `apps/mcp/src/index.ts:13`, `apps/mcp/src/index.ts:33`). It exposes exactly four PRD tools: `get_prd`, `update_section`, `list_empty_sections`, and `mark_confirmed` (`apps/mcp/src/manifest.ts:13`). Tool behavior includes section-key validation, content length cap, confirmed-section write lock unless `user_requested_revision` is true, empty-section listing, and refusing to confirm empty content (`apps/mcp/src/tools.ts:64`, `apps/mcp/src/tools.ts:69`, `apps/mcp/src/tools.ts:89`, `apps/mcp/src/tools.ts:107`, `apps/mcp/src/tools.ts:117`).

Model configuration is per role. The configured roles are `orchestrator`, `interviewerBig`, `interviewerSmall`, `plannerBig`, `worker`, and `summary` (`apps/server/src/config.ts:3`). Defaults use Gemma 4 model IDs with 90-second per-call timeouts, planner/worker iteration caps of 12, and a 300-second turn wall-clock default (`apps/server/src/config.ts:28`, `apps/server/src/config.ts:88`). Environment overrides are parsed from `LM_STUDIO_MODELS_OVERRIDE` and fail process startup on invalid JSON or invalid schema (`apps/server/src/config.ts:48`, `apps/server/src/config.ts:62`).

Existing planning docs are partially historical. `.docs/MVP.md` describes the original goal as a chat-driven PRD builder and explicitly says "MVP = single agent, four tools, live PRD pane" (`.docs/MVP.md:7`, `.docs/MVP.md:11`). The later multi-agent plan declares the target replacement pipeline and says "done" means orchestrator, two branches, streamed thinking messages, and fresh PRD summary (`.docs/planning/plans/2026-04-21-multi-agent-turn-pipeline.plan.md:7`, `.docs/planning/plans/2026-04-21-multi-agent-turn-pipeline.plan.md:21`). The code now aligns more closely with that later plan than with the original MVP brief.

---

### Skeleton State

The composed server skeleton is reachable without a live LLM for read-only endpoints: a one-shot `startServer` run with a disposable SQLite path returned `GET /api/health -> 200 {"ok":true}` and `GET /api/sessions -> 200 []`. Static tracing shows the same runtime path opens the DB, starts the MCP child, registers routes, and serves Hono (`apps/server/src/server.ts:29`, `apps/server/src/server.ts:32`, `apps/server/src/server.ts:36`, `apps/server/src/server.ts:45`).

The normal `pnpm --filter @prd-assist/server dev` script is currently not observable in this environment because Node watch mode fails with `EMFILE: too many open files, watch`. This is an environment/tooling observation, not evidence that the app code cannot run without watch mode: the same server module started and served read-only endpoints in the one-shot observation.

The repository contains a live local SQLite database under `data/` (`data/prd-assist.sqlite`, `data/prd-assist.sqlite-shm`, and `data/prd-assist.sqlite-wal` observed by `ls -la data`). The investigation did not inspect or mutate that database; runtime observation used `/tmp`.

---

### Layer Map

| Layer | Current owner | Evidence |
|---|---|---|
| Browser UI | `apps/web` React routes, pages, components, hooks | `apps/web/src/router.tsx:5`, `apps/web/src/api.ts:7` |
| HTTP boundary | Hono routes in `apps/server/src/routes` | `apps/server/src/routes/index.ts:26` |
| Turn orchestration | `apps/server/src/turn.ts` plus role modules | `apps/server/src/turn.ts:94` |
| LLM roles | orchestrator, interviewers, planner, workers, summary | `apps/server/src/config.ts:3` |
| MCP bridge | server-side MCP client converts MCP tools to OpenAI tools | `apps/server/src/mcpClient.ts:19`, `apps/server/src/mcpClient.ts:43` |
| PRD tools | `apps/mcp` stdio server and tool implementations | `apps/mcp/src/index.ts:28`, `apps/mcp/src/tools.ts:147` |
| Shared contract | section keys, session types, Zod schemas | `packages/shared/src/types.ts:1`, `packages/shared/src/schemas.ts:29` |
| Persistence | SQLite session table plus JSON columns | `apps/server/src/db.ts:62`, `apps/server/src/sessions.ts:111` |

---

### Risk Inventory

`pnpm lint` fails on seven existing lint errors: `runPlannerBigStage` has 85 lines, `runPlannerVerifyStage` has 74 lines, `turn-toolcalls.test.ts` has 426 lines, `handleTurn` has 130 lines and complexity 15, and `runWorkerStage` has 72 lines and complexity 13. These failures are grounded in the lint command output and correspond to `apps/server/src/plannerBig.ts:67`, `apps/server/src/plannerBig.ts:198`, `apps/server/src/turn-toolcalls.test.ts:357`, `apps/server/src/turn.ts:94`, and `apps/server/src/workers.ts:80`.

The development script uses Node watch mode (`apps/server/package.json:7`), and that mode failed here with `EMFILE: too many open files, watch`. The app can be run without watch mode for observation, but the declared dev path may be brittle on this machine until watcher limits or watch scope are addressed.

The current turn orchestration concentrates many branch responsibilities in `handleTurn`, including persistence, stream wrapping, routing, planner/worker sequencing, verification, interviewer closeout, summary hook, and mutex release (`apps/server/src/turn.ts:94`). This is already reflected by lint complexity and line-count failures, so changes in this area carry regression risk unless they are kept small and verified through the existing turn tests.

---

### Evidence Index

- `package.json:10` - root scripts for dev, build, typecheck, test, lint, docs, and formatting.
- `pnpm-workspace.yaml:1` - workspace includes `apps/*` and `packages/*`.
- `apps/server/src/index.ts:9` - runtime environment defaults.
- `apps/server/src/server.ts:22` - deployable server composition entrypoint.
- `apps/server/src/routes/messages.ts:31` - SSE message endpoint.
- `apps/server/src/turn.ts:128` - orchestrator classification inside each turn.
- `apps/server/src/turn.ts:149` - work branch begins planner/worker path.
- `apps/mcp/src/manifest.ts:13` - four-tool MCP manifest.
- `packages/shared/src/types.ts:1` - fixed seven-section PRD domain type.
- `.docs/planning/plans/2026-04-21-multi-agent-turn-pipeline.plan.md:21` - later plan's multi-agent definition of done.
