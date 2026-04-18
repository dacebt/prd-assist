# prd-assist MVP

## Project Status
greenfield

## Intent
A chat-driven PRD builder. One supervisor LLM in a turn loop talks to the user, calls four deterministic MCP tools to read and write a seven-section PRD stored in SQLite, and the user watches the PRD update live in a pane beside the chat. This MVP replaces a prior reactive multi-agent prototype whose coordination model proved unmanageable. The system here has no specialists, no event bus, and no lifecycle — every agent capability is added later as an in-process tool call against this foundation.

## Scope

### In Scope
- Node backend (Hono, TypeScript) serving HTTP to the browser and hosting the turn loop.
- MCP server (Node, `@modelcontextprotocol/sdk`, stdio transport) exposing four PRD tools.
- SQLite persistence (`better-sqlite3`, WAL mode, single file) holding sessions.
- Vite + React + TypeScript + Tailwind frontend with two-pane layout (chat left, PRD right) using `react-router-dom`.
- Session CRUD: create, list, load, send message.
- Turn loop that calls LM Studio via OpenAI-compatible endpoint (`openai` npm client) using the model configured by `LM_STUDIO_MODEL` (default `google/gemma-4-26b-a4b`).
- Four PRD tools: `get_prd`, `update_section`, `list_empty_sections`, `mark_confirmed`.
- Structural enforcement of confirmed-section write-lock via `user_requested_revision` argument on `update_section`.
- Structural rejection of unknown section keys, empty content on `mark_confirmed`, and content over size caps at the MCP tool boundary.
- Per-session in-process write mutex in the backend; HTTP 409 on concurrent turn attempts.
- Injectable `LlmClient` and `McpClient` interfaces so the turn loop can be unit-tested against stubs.
- Live PRD pane that re-fetches `GET /api/sessions/:id` every 500ms while a turn is in flight.
- Session title derived by truncating the first user message to 60 characters at a word boundary.
- Manual scripted harness (`scripts/doc-edit-check.ts`) that boots an in-process Hono server on a random free port, issues a fixed three-turn conversation via HTTP, and prints the final PRD for slice 4 verification.
- Slice-3 tool-calling smoke check proving the configured model emits native OpenAI `tool_calls` through LM Studio before slice 4 is built.

### Out of Scope
- SSE, WebSocket, or token-level streaming (deferred; brief v1.1).
- User-driven direct section editing in the PRD pane (deferred; brief v1.2).
- Any specialist (LLM-backed sub-tool). MVP has supervisor only.
- RAG, research, embeddings, vector store.
- Authentication, authorization, multi-user, multi-tenant.
- Real-time collaboration; any transport beyond HTTP poll.
- Docker, containerization, deployment tooling. Dev loop is `pnpm dev` only.
- Section set extensibility. The seven keys are fixed at build time.
- Agent-proposed new section keys.
- LLM-generated session titles.
- Section revision history or diff inspection UI.
- Rate limiting on HTTP endpoints.
- Retry on LM Studio transport errors (connection refused, 5xx, timeout). The turn fails; user retries manually.
- A2A protocol adoption. Dropped for MVP; must not appear in `src/` or `scripts/`.
- Frontend code carry-forward from the v1 prototype. Layout is inspirational; all code is new.
- Any Python. The v1 `packages/mcp-prd` is not ported — the MCP server is rewritten in TypeScript.
- Migration, backwards compatibility, or import of v1 prototype data.
- Windows support. Developed and supported on macOS; Linux is expected to work but is not a verification target.
- A fallback text-format tool protocol if native `tool_calls` are unsupported by the model. The slice-3 smoke check fails fast instead.

## Implementation Constraints

### Architecture
Three processes, one persistence layer.

```digraph
react_vite -> hono_backend [label="HTTP /api/*"]
hono_backend -> mcp_server [label="stdio MCP"]
mcp_server -> sqlite [label="read/write session.prd_json"]
hono_backend -> sqlite [label="read/write session metadata, messages_json"]
hono_backend -> lm_studio [label="OpenAI-compatible HTTP"]
```

Dependencies flow inward from the frontend. The React app owns no persistence state; everything is fetched from the backend. The Hono backend owns the turn loop, the LM Studio client, the MCP client, and writes to `messages_json`, `title`, and `updated_at`. The MCP server owns reads and writes of `prd_json`. SQLite is shared via two separate `better-sqlite3` connections on the same file in WAL mode.

**Single pnpm package at the repo root.** Three entry points:
- `src/web/` — Vite-managed React app built as static assets, served in development by the Vite dev server on `http://localhost:5173`.
- `src/server/index.ts` — Hono backend binary. Listens on `127.0.0.1:5174`. Spawns the MCP server as a child process at boot.
- `src/mcp/index.ts` — MCP server binary. Communicates with the backend over stdio via `@modelcontextprotocol/sdk`.

One `tsconfig.json` at the root with `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. One `package.json`. No workspaces.

**No-side-effect-on-import rule.** Modules under `src/server/` and `src/mcp/` must not perform I/O, start servers, open database connections, or spawn child processes at module evaluation time. Side effects are confined to explicit `main()` functions in the two entry points (`src/server/index.ts`, `src/mcp/index.ts`). This is mandatory so Vitest and `scripts/doc-edit-check.ts` can `import { handleTurn, startServer } from "…"` without booting unrelated resources.

**MCP child process lifecycle.** The MCP child is spawned by `@modelcontextprotocol/sdk`'s `StdioClientTransport`, not by `child_process.spawn` directly. The backend constructs the transport with:

```ts
new StdioClientTransport({
  command: resolve(process.cwd(), "node_modules/.bin/tsx"),
  args: [resolve(process.cwd(), "src/mcp/index.ts")],
  env: { ...process.env },
});
```

`src/server/index.ts` `main()` performs this boot sequence in strict order:

```digraph
open_backend_db -> run_schema_migration -> create_mcp_client -> mcp_client_connect
mcp_client_connect -> mcp_list_tools_once [label="cache tool list in memory"]
mcp_list_tools_once -> start_hono_listen
```

The schema migration must complete before the MCP child is created, because the MCP child opens its own SQLite connection during its startup and the first `get_prd` call fails if the `sessions` table does not yet exist. The backend awaits `client.connect(transport)` (which completes the MCP `initialize` handshake) before starting the HTTP listener. `mcp.listTools()` is called once at boot and the result is cached on the `McpClient` adapter; subsequent turns reuse it.

If the transport closes unexpectedly (the MCP child exited), the backend logs `mcp_child_exited` with the exit code available via `transport.onclose` and exits with status 1. `pnpm dev` relaunches via `tsx watch`. MVP does not implement in-place MCP restart.

**SQLite schema.** One table, one row per session, columns partitioned by writer:

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  messages_json TEXT NOT NULL DEFAULT '[]',
  prd_json TEXT NOT NULL
);
CREATE INDEX sessions_updated_at_idx ON sessions(updated_at DESC);
```

Writes go through column-scoped `UPDATE sessions SET <col> = ?, updated_at = ? WHERE id = ?` statements. The backend writes `messages_json`, `title`, `updated_at`. The MCP server writes `prd_json`, `updated_at`. Both may write `updated_at`; last write wins, which is semantically correct — the most recent writer stamps the time. Session creation is the only `INSERT` and happens before any tool call, so no cross-writer conflict exists at creation. Concurrent column-scoped updates do not stomp each other because each statement is a self-contained mutation of a single column.

**Every SQLite connection — both the backend's and the MCP server's — enables WAL mode immediately after opening:**

```ts
const db = new Database(sqlitePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");
```

Both processes open the same file. WAL mode is required for cross-process reads and writes to coexist without readers blocking writers.

**Turn loop ordering.**

```digraph
receive_message -> validate_body -> acquire_mutex -> load_session
load_session -> append_user_msg -> persist_user_msg_and_title
persist_user_msg_and_title -> llm_loop_start
llm_loop_start -> llm_chat -> decide
decide -> call_tools  [label="tool_calls present"]
decide -> finalize    [label="assistant text only"]
call_tools -> parse_and_invoke -> append_tool_results -> llm_loop_start
parse_and_invoke -> tool_error [label="parse / validator / MCP error"]
tool_error -> append_tool_error_msg -> llm_loop_start
finalize -> append_assistant_msg -> persist_assistant_msg -> release_mutex -> return_reply
llm_loop_start -> iteration_cap_hit [label="iter >= 6"]
llm_chat -> per_call_timeout_hit   [label="90s elapsed"]
receive_message -> wall_clock_cap_hit [label="300s elapsed"]
iteration_cap_hit -> append_system_error -> persist_assistant_msg -> release_mutex -> return_reply
per_call_timeout_hit -> append_system_error -> persist_assistant_msg -> release_mutex -> return_reply
wall_clock_cap_hit -> append_system_error -> persist_assistant_msg -> release_mutex -> return_reply
```

The user message is persisted before the LLM loop starts. Any mid-loop failure still leaves the user's input on disk. The loop is bounded: max 6 iterations, per `llm.chat` call timeout 90 seconds via `AbortSignal`, total turn wall-clock 300 seconds. Iteration or wall-clock breach appends a system-error assistant message, persists, releases the mutex, and returns HTTP 200 with that content.

### Boundaries
- **HTTP request bodies (browser → backend).** Parsed with `zod` schemas at the route boundary. Reject malformed with HTTP 400 `{"error": "invalid_request", "details": <zod_issues>}`. No silent coercion. Maximum raw body size 64 KB; larger returns HTTP 413.
- **User message text.** `text` must be a string, trimmed length ≥ 1 and ≤ 10000 characters. Violations return HTTP 400 with `{"error": "invalid_request", "details": ...}`.
- **LLM tool-call arguments (Gemma → backend).** Every tool-call handling step is wrapped in try/catch that returns a structured tool-role message to the loop. Four categories, all handled identically at the loop level:
  - JSON parse failure on `call.function.arguments` → `{"error": "invalid_tool_arguments", "message": <parser_message>}`.
  - Unknown tool name (`call.function.name` not in the MCP `listTools` result) → `{"error": "unknown_tool", "name": <name>, "valid_tools": [...]}`.
  - Tool argument validator rejection (reported by MCP server) → passed through verbatim as the tool result.
  - MCP transport or server-side exception → `{"error": "tool_invocation_failed", "name": <name>, "message": <e.message>}`.
  In every case the loop continues with the structured tool result appended; the supervisor recovers in its next iteration.
- **MCP tool arguments (backend → MCP server).** Validated at the MCP server entry. `key` validated against the literal union `"vision" | "problem" | "targetUsers" | "goals" | "coreFeatures" | "outOfScope" | "openQuestions"`. `content` validated as string with length ≤ 10000 characters. `status` validated against the literal union `"empty" | "draft" | "confirmed"`. Violations return structured error results, never throw.
- **LM Studio responses.** Treated as untrusted. `choices[0].message` presence checked; missing fields produce an `invalid_llm_response` structured error that the loop treats as a soft failure (appends system-error assistant message and returns).
- **SQLite reads.** Storage is trusted; rows are parsed via `zod` into the canonical shape. A parse failure is a 500-class server error with the session id logged. This only triggers if the DB was hand-edited to an invalid shape.
- **Session ownership.** Per-session write mutex lives in-process in the backend as `Map<sessionId, Promise<void>>`. A second concurrent `POST /api/sessions/:id/messages` for the same session id returns HTTP 409 `{"error": "session_busy"}` within 100ms without waiting on the in-flight turn.

### Testing Approach
Vitest for pure-function units and for the turn loop under stubbed clients. Typecheck and lint carry the weight for route wiring, React components, and MCP glue.

What gets tested:
- Session title derivation over edge cases (empty, whitespace-only rejected upstream, multi-word, punctuation, 60-char boundary, 300-char input).
- Tool argument validators in `src/mcp/validate.ts`.
- `buildSystemPrompt` output contains every verbatim rule sentence defined in this spec.
- Turn loop against a stub `LlmClient`: scripted responses covering the happy path, tool-call loop, unknown-tool recovery, JSON parse failure recovery, iteration cap breach, per-call timeout breach, wall-clock cap breach.
- Per-session mutex acquire / release / contend.

What does not get tested:
- Hono route registration, Vite config, MCP SDK wiring, Tailwind compilation.
- React components whose behavior is expressed entirely in JSX and class names.
- The real LLM's behavior. Model correctness is verified by the scripted harness in slice 4 and by the Verification Scenarios, not by Vitest.

### Naming
- **Section keys.** TypeScript literal union `SectionKey = "vision" | "problem" | "targetUsers" | "goals" | "coreFeatures" | "outOfScope" | "openQuestions"`. Used verbatim in storage, HTTP, MCP tool arguments, React props, and JSON. No alternate serializations.
- **Section status.** `SectionStatus = "empty" | "draft" | "confirmed"`.
- **MCP tool names.** snake_case: `get_prd`, `update_section`, `list_empty_sections`, `mark_confirmed`.
- **Supervisor.** The one LLM invoked inside the turn loop.
- **Turn.** One user message producing one assistant reply, including any tool calls in between.
- **Session.** The conversation (`messages`) plus the document (`prd`), stored as one SQLite row.
- **PRD.** The seven-section document.
- **Specialist.** Reserved for post-MVP. Not defined in MVP code. Any symbol labelled "specialist" in MVP is a bug.

## Requirements

### Data model

```ts
type SectionKey =
  | "vision" | "problem" | "targetUsers" | "goals"
  | "coreFeatures" | "outOfScope" | "openQuestions";

type SectionStatus = "empty" | "draft" | "confirmed";

type Section = {
  content: string;      // markdown; length ≤ 10000
  updatedAt: string;    // ISO 8601 via new Date().toISOString()
  status: SectionStatus;
};

type PRD = Record<SectionKey, Section>;

type ChatMessageUser      = { role: "user";      content: string; at: string };
type ChatMessageAssistant = { role: "assistant"; content: string; at: string };
type ChatMessage          = ChatMessageUser | ChatMessageAssistant;

type Session = {
  id: string;           // crypto.randomUUID()
  title: string;        // truncated first user message; empty before first message
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  prd: PRD;
};
```

Only `role: "user"` and `role: "assistant"` messages are persisted to `session.messages`. The `role: "tool"` and `role: "assistant"` with `tool_calls` messages exchanged with the LLM during a turn exist only in the loop's working array.

New-session initial state: every key in `PRD` is `{ content: "", status: "empty", updatedAt: <now> }`. Title is the empty string until the first user message is appended, then derived.

### HTTP API (backend)

```
GET  /api/health                                      -> { "ok": true }
GET  /api/sessions                                    -> SessionSummary[]
POST /api/sessions                                    -> { id: string }
GET  /api/sessions/:id                                -> Session
POST /api/sessions/:id/messages  body: { text }       -> { reply: string }
```

`SessionSummary = { id: string; title: string; updatedAt: string }`. Returned in `updated_at DESC` order.

`GET /api/sessions/:id` returns the full session including the PRD. Used by both the initial load and the 500ms polling loop.

`POST /api/sessions` creates a session with the initial state above; no request body required. Returns `201` with `{ id }`.

`POST /api/sessions/:id/messages` runs one full turn synchronously and returns the final assistant reply. Average turn latency on local hardware is 30–120 seconds; clients block until resolution. Returns:
- `400` on malformed body (missing `text`, empty after trim, over 10000 chars).
- `404` if the session does not exist.
- `409` if a turn for that session is already in flight.
- `413` if the request body is over 64 KB.
- `500` on unexpected server error. On `500` the user message is persisted if the loop reached `persist_user_msg_and_title`; the error body is `{"error": "internal", "message": <string>}`.

### MCP tools

Four tools, all requiring `session_id: string`. Implemented in `src/mcp/` and exposed via stdio via `@modelcontextprotocol/sdk`. Every validator failure returns a tool result with `{"error": ..., ...}`; the MCP server does not throw across the wire.

**Wire format (all tools).** Every `CallToolRequest` handler returns a `CallToolResult` shape:

```ts
{
  content: [{ type: "text", text: JSON.stringify(<result-or-error-object>) }],
  isError: false,
}
```

Both success and error results are serialized into `content[0].text` as JSON. `isError` is always `false` — structural errors are carried in the JSON payload, not in the MCP error channel, because the supervisor needs the error body to decide how to recover. The backend's `McpClient` adapter unwraps `content[0].text` back into a parsed object before passing it to the turn loop.

**Tool manifest.** Each tool registers with a `name`, `description`, and `inputSchema` (JSON Schema). The descriptions below are the verbatim strings — Vitest asserts the registered descriptions match byte-for-byte.

**`get_prd`**
- **description:** `"Read the full PRD with all seven sections, their current content, status, and last-updated timestamp. Call this as the first tool call of every turn so you have fresh content before deciding what to do."`
- **inputSchema:**
  ```json
  { "type": "object",
    "properties": { "session_id": { "type": "string" } },
    "required": ["session_id"], "additionalProperties": false }
  ```

**`update_section`**
- **description:** `"Write new content to one PRD section. Preserve existing content verbatim unless the user has explicitly asked in this turn to change or remove specific parts. Set user_requested_revision=true only when the user has explicitly asked in this turn to revise a section whose status is already confirmed. Unknown section keys are rejected."`
- **inputSchema:**
  ```json
  { "type": "object",
    "properties": {
      "session_id": { "type": "string" },
      "key": { "type": "string", "enum": ["vision","problem","targetUsers","goals","coreFeatures","outOfScope","openQuestions"] },
      "content": { "type": "string", "maxLength": 10000 },
      "status": { "type": "string", "enum": ["empty","draft","confirmed"] },
      "user_requested_revision": { "type": "boolean" }
    },
    "required": ["session_id","key","content"], "additionalProperties": false }
  ```

**`list_empty_sections`**
- **description:** `"Return the keys of sections whose status is empty. Use this to decide which sections still need user input."`
- **inputSchema:** same shape as `get_prd`.

**`mark_confirmed`**
- **description:** `"Mark a section as confirmed after the user has reviewed its content in this conversation and has explicitly agreed it is complete. Do not call this on a section whose content is empty. Do not call this without explicit user confirmation in the current turn."`
- **inputSchema:**
  ```json
  { "type": "object",
    "properties": {
      "session_id": { "type": "string" },
      "key": { "type": "string", "enum": ["vision","problem","targetUsers","goals","coreFeatures","outOfScope","openQuestions"] }
    },
    "required": ["session_id","key"], "additionalProperties": false }
  ```

The `key` enum in each `inputSchema` is the structural guardrail that prevents the model from inventing section keys — the openai-compatible layer propagates the enum constraint into the function-calling format.

**`get_prd(session_id)` → `PRD`**
Reads `prd_json` from the session row via a dedicated MCP-owned SQLite connection. Returns the full seven-section object. No side effects. Missing `session_id` → `{"error": "session_not_found", "session_id": <id>}`.

**`update_section(session_id, key, content, status?, user_requested_revision?)` → `Section`**
- `key: SectionKey` — validated against the literal union. Unknown key returns `{"error": "unknown_section_key", "valid_keys": [...]}`.
- `content: string` — markdown; must be a string with length ≤ 10000. Longer returns `{"error": "content_too_long", "max": 10000, "got": <n>}`.
- `status?: SectionStatus` — if provided, validates against the literal union and sets the section's status. If omitted:
  - If the section is currently `empty` or `draft`, status becomes `draft`.
  - If the section is currently `confirmed` and `user_requested_revision=true`, status becomes `draft` (revision invalidates prior confirmation; a fresh confirmation must follow).
- `user_requested_revision?: boolean` — must be `true` to modify a section whose current status is `"confirmed"`. If the current status is `"confirmed"` and this argument is missing or `false`, the tool returns `{"error": "section_confirmed", "key": <key>, "hint": "set user_requested_revision=true when the user has explicitly asked in this turn to revise this section"}`.

The tool reads the row, mutates the target section in the `PRD` object, writes back only `prd_json` and `updated_at`. Returns the updated `Section`.

**`list_empty_sections(session_id)` → `SectionKey[]`**
Returns the keys of sections whose `status === "empty"`, in the declaration order of the `SectionKey` union. Missing session → `{"error": "session_not_found", ...}`.

**`mark_confirmed(session_id, key)` → `Section`**
- Validates `key` as `SectionKey`.
- Reads the section; if `content.trim().length === 0`, returns `{"error": "cannot_confirm_empty_section", "key": <key>}` without writing.
- Sets `section.status = "confirmed"` and `section.updatedAt = now`. Returns the updated section. No-op-equivalent if already confirmed (same write, same return).

Tool descriptions in the MCP manifest must spell out when to pass `user_requested_revision` and when confirmation is appropriate — those descriptions are model-facing guidance and are tested by a Vitest check against verbatim strings.

### Turn loop

Location: `src/server/turn.ts`. Exports a pure function:

```ts
export async function handleTurn(opts: {
  sessionId: string;
  userText: string;
  deps: TurnDeps;
}): Promise<string>;

export type TurnDeps = {
  db: SessionStore;          // loadSession / persistUserMessage / persistAssistantMessage / deriveTitle
  llm: LlmClient;            // chat({model, messages, tools, signal}) -> AssistantMessage
  mcp: McpClient;            // listTools(), callTool(name, args)
  mutex: SessionMutex;       // acquire(sessionId) / release(sessionId); sync 409 contention
  now: () => Date;           // test injection
  config: {
    model: string;
    maxIterations: number;   // 6
    perCallTimeoutMs: number; // 90_000
    wallClockMs: number;      // 300_000
  };
};
```

Production assembly lives in `src/server/index.ts`; `turn.ts` itself has no I/O imports.

Loop behavior:
1. Validate `userText` upstream at the route; `handleTurn` assumes non-empty trimmed input.
2. Attempt `mutex.acquire(sessionId)`. If already held, throw a typed `SessionBusyError` that the route maps to 409. The acquisition must be synchronous so the 409 response returns without waiting.
3. Try: load session; push the user message; if `session.title === ""` derive from this message; persist `messages_json` and `title` in a single `UPDATE` before any LLM call.
4. Build the LLM message array: `[{ role: "system", content: buildSystemPrompt() }, ...session.messages]`. No tool-role messages carry over between turns.
5. Build the LLM tools parameter from the `McpClient` adapter's cached tool list by mapping each MCP tool descriptor to the OpenAI function-calling shape:
   ```ts
   tools.map(t => ({
     type: "function" as const,
     function: { name: t.name, description: t.description, parameters: t.inputSchema },
   }))
   ```
   The MCP `inputSchema` field is passed verbatim as `parameters` — both are JSON Schema. This conversion happens once at boot when the tool list is cached, not on every turn.
6. Enter the loop. Start the wall-clock timer. Each iteration:
   a. Compose an `AbortSignal` with the 90s per-call timeout.
   b. Call `llm.chat({ model, messages, tools, signal })`. On abort, break out with system-error path.
   c. Append the assistant message to the working array.
   d. If `message.tool_calls` is present and non-empty: for each call, in order:
      - Try to parse `call.function.arguments` as JSON. On failure, append tool-error message.
      - If parsed: match `call.function.name` against the tools list. Unknown → append tool-error message.
      - If matched: try `mcp.callTool(name, args)`. On thrown exception → append tool-error message. On returned error object → append the structured result verbatim. On returned success → append the result verbatim as the tool content.
      Each appended tool message is `{ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) }`. Continue to next iteration.
   e. If `message.tool_calls` is absent and `message.content` is a non-null string: append `{ role: "assistant", content, at: now().toISOString() }` to `session.messages`, persist, release the mutex, return `content`.
   f. If iteration count reaches 6 or wall-clock exceeds 300s: break with system-error path.
7. System-error path: append assistant message with one of the fixed strings below, persist, release the mutex, return.
   - Iteration cap: `"I hit a tool-call loop limit. Please rephrase your request or try a smaller step."`
   - Per-call timeout: `"The model took too long to respond. Please try again."`
   - Wall-clock cap: `"I ran out of time on that turn. Please try again."`
   - Any other unexpected error: `"Something went wrong while processing that turn. See server logs for details."`
8. `finally`: release the mutex if not already released.

Title derivation (`deriveTitle`): collapse internal whitespace to single spaces, trim, take the first 60 characters; if the 60-char cut falls mid-word (the 60th char is not whitespace and the 61st is not whitespace or end), back up to the last whitespace before position 60 and trim trailing whitespace. Deterministic, pure, no LLM.

### System prompt

Location: `src/server/prompt.ts`. Exports `buildSystemPrompt(): string`. Takes no arguments — the PRD is not embedded in the system prompt. The supervisor reads the PRD via `get_prd` every turn.

The returned string contains, in order, these sections, with the rule sentences exactly verbatim:

1. **Role statement.**
   > You are the supervisor of a PRD-building session. You speak directly to the user in chat. You use four MCP tools to read and write the PRD: `get_prd`, `update_section`, `list_empty_sections`, `mark_confirmed`. You are the only agent in this session.

2. **PRD structure.**
   > The PRD has seven sections with fixed keys: `vision`, `problem`, `targetUsers`, `goals`, `coreFeatures`, `outOfScope`, `openQuestions`. Each section has `content` (markdown), `status` (one of `empty`, `draft`, `confirmed`), and `updatedAt`.

3. **Editing discipline rules, word-for-word.**
   > 1. Before calling `update_section` on any section, you must know the section's current content. Call `get_prd` as the first tool call of every turn if you do not already have fresh PRD content from a tool result in this turn.
   > 2. When updating a section, preserve all existing content in that section verbatim unless the user has explicitly asked in this turn to change or remove specific parts. Never rephrase, normalize, tighten, or improve prose that was not the subject of the user's request.
   > 3. Do not call `update_section` on a section whose status is `confirmed` unless the user in this turn has explicitly asked to revise that section. When you do, set `user_requested_revision=true`.
   > 4. Do not call `mark_confirmed` on a section whose content is empty. Do not call `mark_confirmed` on a section unless the user has reviewed the content in this conversation and has explicitly agreed it is complete.
   > 5. Emit tool calls in the native OpenAI `tool_calls` format. Do not narrate tool calls as text in your assistant content.

4. **Conversational stance.**
   > Ask one specific clarifying question at a time when you need user input. Surface tradeoffs rather than inventing user preferences. Keep replies concise.

The full exact string is the authoritative source; Vitest asserts that `buildSystemPrompt()` output contains each of the five numbered rule sentences byte-for-byte.

### Frontend

React 18 + Vite + TypeScript + Tailwind. Routing via `react-router-dom` v6 with two routes:
- `/` — session list in a sidebar, main area empty-state. "New session" button issues `POST /api/sessions`, navigates to `/sessions/:id` on response.
- `/sessions/:id` — two-pane view. Chat pane left at `400px` fixed width. PRD pane right fills remaining viewport, scrollable.

**Chat pane:**
- Scrollable message list; auto-scrolls to bottom on new messages and on mount.
- Message bubbles styled by role: user right-aligned neutral, assistant left-aligned subtle background.
- Rendered via `react-markdown` with `remark-gfm`. No custom HTML extension, no raw HTML.
- Input: textarea that submits on Cmd/Ctrl-Enter; Enter alone inserts a newline. Submit posts to `/api/sessions/:id/messages` and awaits. Input is disabled while the POST is in flight.
- Submit failure displays a single-line red error above the input: `"Send failed: <message>"` extracted from the response body's `error` or `message` field, falling back to the HTTP status text. Input is re-enabled.

**PRD pane:**
- Seven section blocks, one per `SectionKey`, rendered in `SectionKey` declaration order.
- Each block shows: section label (human-readable), status pill (`empty` gray, `draft` blue, `confirmed` green), and rendered markdown content.
- Empty content renders as a dimmed italic placeholder `"(empty)"`.
- Polling: a `useEffect` hook starts polling `GET /api/sessions/:id` every 500ms while the chat input is disabled (turn in flight). Stops when the POST resolves or errors. On route mount, fetches once.

**Session list (left sidebar on `/`):**
- `GET /api/sessions` on mount; no auto-refresh.
- Each row shows the title (or `"(untitled)"` if empty) and `updatedAt` as relative time.
- Clicking a row navigates to `/sessions/:id`.

Types are imported from `src/shared/types.ts` — the same file the backend imports. No codegen.

### Doc-editing verification harness

Location: `scripts/doc-edit-check.ts`. Run via `pnpm tsx scripts/doc-edit-check.ts`.

The script:
1. Deletes `./tmp/harness.sqlite` if present. Creates `./tmp/` if absent.
2. Imports and starts the Hono backend in-process via an exported `startServer({ sqlitePath, port })` function that `src/server/index.ts` delegates to. Picks port 0 to bind a random free port.
3. Spawns the MCP child internally (the same code path the server uses in production).
4. Waits for `/api/health` to return `{ ok: true }`.
5. Issues `POST /api/sessions` to create a session; captures the returned `id`.
6. Sends three user messages sequentially via `POST /api/sessions/:id/messages`, awaiting each reply:
   - Turn 1: `"The product helps PMs draft PRDs with an AI assistant. Please put that in the vision."`
   - Turn 2: `"Add to the core features: 1) real-time PRD pane. 2) section-by-section editing."`
   - Turn 3: `"Also add to core features: 3) session autosave."`
7. Fetches the final session via `GET /api/sessions/:id`.
8. Prints:
   - `coreFeatures.content` as-is.
   - `vision.content` as-is.
   - The detected bullet count in `coreFeatures` (lines matching `/^\s*(-|\*|\d+\.)\s+/` in the rendered content).
   - The full PRD as pretty-printed JSON.
9. Tears down: stops the HTTP server, kills the MCP child.

**Pass criteria**, evaluated by the operator from the printed output:
- `coreFeatures.content` contains three bullets covering real-time pane, section editing, and session autosave.
- Each bullet's text is recognizably from the user's message — not paraphrased ("real-time PRD pane" survives, not "live document view" or similar).
- `vision.content` still contains the phrase from turn 1 and was not rewritten by turns 2 or 3.

**Failure adaptation** (documented, not pre-built): if the harness fails the preservation check, the spec adapts by adding `append_section(session_id, key, markdown)` as a fifth tool, updating the system prompt to route additive edits to it, and re-running the harness. This adaptation is recorded in the Adaptation Log when it happens.

**Prerequisite:** LM Studio must be running at `LM_STUDIO_BASE_URL` (default `http://localhost:1234/v1`) serving `LM_STUDIO_MODEL`. If the healthcheck call to LM Studio fails (connection refused or model not loaded), the harness exits with code 2 and the message `LM Studio not reachable — start it and load the configured model before running this script.`

## Project Setup

- Runtime: Node 20 LTS (minimum `20.11`).
- Language: TypeScript `5.x`. `tsconfig.json` with `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `module: "ES2022"`, `moduleResolution: "bundler"`, `jsx: "react-jsx"`.
- Package manager: pnpm ≥ 9.
- Directory structure:
  ```
  prd-assist/
    .docs/
    .gitignore
    package.json
    tsconfig.json
    vite.config.ts
    vitest.config.ts
    tailwind.config.js
    postcss.config.js
    .eslintrc.cjs
    .prettierrc
    src/
      shared/
        types.ts               // SectionKey, SectionStatus, Section, PRD, ChatMessage, Session, SessionSummary
      server/
        index.ts               // main(): spawn MCP, start Hono, listen 127.0.0.1:5174
        server.ts              // startServer({ sqlitePath, port }) — no side effects on import
        routes.ts              // /api/* route registration
        sessions.ts            // session CRUD / SessionStore implementation
        turn.ts                // handleTurn, TurnDeps, SessionBusyError
        prompt.ts              // buildSystemPrompt
        llm.ts                 // LlmClient interface + production adapter (openai npm package)
        mcpClient.ts           // McpClient interface + production adapter (MCP SDK over stdio)
        mutex.ts               // SessionMutex
        db.ts                  // better-sqlite3 connection + schema migration on open
      mcp/
        index.ts               // MCP server main()
        tools.ts               // the four tool implementations
        validate.ts            // SectionKey / SectionStatus / content validators
        db.ts                  // separate better-sqlite3 connection for MCP
      web/
        index.html
        src/
          main.tsx
          App.tsx
          router.tsx
          api.ts
          components/
            ChatPane.tsx
            PrdPane.tsx
            SessionList.tsx
            MessageBubble.tsx
            SectionBlock.tsx
          hooks/
            useSessionPolling.ts
          globals.css           // @tailwind directives
    scripts/
      doc-edit-check.ts         // doc-editing verification harness
    data/                       // gitignored; holds prd-assist.sqlite
    tmp/                        // gitignored; holds harness.sqlite
  ```
- Linter: ESLint with `@typescript-eslint/recommended` + `@typescript-eslint/recommended-requiring-type-checking`. Config `.eslintrc.cjs`.
- Formatter: Prettier default; config via `.prettierrc` (empty object is fine).
- Type checker: `tsc --noEmit` covers `src/**/*.{ts,tsx}` and `scripts/**/*.ts`.
- Test framework: Vitest. Test files co-located as `*.test.ts` next to source. Config `vitest.config.ts`; node environment only (no DOM environment is configured for MVP).
- Build tool: Vite builds the frontend (`src/web/`) to `dist/web/`. `tsc` emits the backend to `dist/server/` and the MCP server to `dist/mcp/`. Production deployment is not an MVP target; `pnpm dev` is the development path.
- Dev server: Vite on `http://localhost:5173`. Hono on `http://127.0.0.1:5174`. Vite proxies `/api/*` → `http://127.0.0.1:5174` via `vite.config.ts` `server.proxy`.
- Vite config lives at the repo root and must set `root: "src/web"` so Vite finds `src/web/index.html` and resolves `src/web/src/main.tsx` as the entry. Build output directory is `../../dist/web` (i.e. repo-root-relative `dist/web`).
- Hono runs via `@hono/node-server`: `serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 5174 })`. The `127.0.0.1` hostname is mandatory and must not be changed to `0.0.0.0` — the no-auth assumption depends on loopback-only binding.
- ESLint version pinned to `^8.57.0` to keep `.eslintrc.cjs` working. Do not upgrade to ESLint 9 during MVP.
- Vitest config (`vitest.config.ts`): `environment: "node"`, `include: ["src/**/*.test.ts", "scripts/**/*.test.ts"]`. No DOM environment.
- Tailwind `content` globs: `["./src/web/index.html", "./src/web/src/**/*.{ts,tsx}"]`.
- React Router pattern: `<BrowserRouter><Routes><Route .../></Routes></BrowserRouter>` declarative API. No `createBrowserRouter` for MVP.
- Environment variables:
  - `LM_STUDIO_BASE_URL` (default `http://localhost:1234/v1`)
  - `LM_STUDIO_MODEL` (default `google/gemma-4-26b-a4b`)
  - `SQLITE_PATH` (default `./data/prd-assist.sqlite`)
  - Loaded via `process.env` at startup. No dotenv dependency.
- Runtime dependencies: `hono`, `@hono/node-server`, `better-sqlite3`, `@modelcontextprotocol/sdk`, `openai`, `zod`, `react`, `react-dom`, `react-router-dom`, `react-markdown`, `remark-gfm`.
- Dev dependencies: `typescript`, `vite`, `@vitejs/plugin-react`, `vitest`, `tsx`, `concurrently`, `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `prettier`, `tailwindcss`, `postcss`, `autoprefixer`, `@types/node`, `@types/react`, `@types/react-dom`, `@types/better-sqlite3`.
- Scripts in `package.json`:
  - `dev`: `concurrently "tsx watch src/server/index.ts" "vite"` (backend launches MCP child itself).
  - `build`: `tsc -p tsconfig.json && vite build`
  - `typecheck`: `tsc --noEmit`
  - `lint`: `eslint 'src/**/*.{ts,tsx}' 'scripts/**/*.ts'`
  - `test`: `vitest`
  - `doc-edit-check`: `tsx scripts/doc-edit-check.ts`

## Rejected Alternatives

- **Two-tool section writer (append + rewrite split).** `append_to_section` + `rewrite_section` as separate tools. Exceeds the practical tool-count budget for a local 26B model and relies on a brittle semantic distinction the model handles inconsistently — breaks down on partial rewrites where the user asks to "reword one bullet." Would have won on: narrower default blast radius for the common additive case. Rejected on: wrong failure mode — silent data loss when the model picks the wrong tool. Kept as a documented adaptation path if the slice-4 harness proves Option A insufficient.

- **Per-section structured model.** Typed schemas per section (`addFeature`, `updateFeature`, `removePersona`, `setVisionStatement`). Only two of the seven sections are genuinely list-shaped; the remaining five are prose and do not survive a schema round-trip without corruption risk. Requires stable ID recall across tool calls — a documented failure mode for local models. Would have won on: impossible-to-corrupt-unrelated-content property for list-shaped sections. Rejected on: up-front design cost and inability to generalize to prose sections.

- **Markdown-block edit tools.** `upsert_bullet`, `remove_bullet`, `set_heading_prose`. Same ID-recall brittleness as the structured model, at finer granularity. Maximum engineering surface for minimum reliability gain.

- **Diff/patch tool.** `apply_section_patch(key, patch)`. Local 26B models produce invalid or semantically wrong patches reliably enough to reject without further evaluation.

- **Optimistic-concurrency section writes.** `update_section(key, base_version, new_content)` with version-mismatch rejection. Single-writer system has no lost-update problem. Version matching does not catch the actual failure mode (bad content from the agent). Solves nothing that is broken.

- **PRD snapshot embedded in the system prompt.** Original brief approach. Problem: the snapshot goes stale the moment the first `update_section` returns inside a turn, and the supervisor has no deterministic way to know which sections have been written. Replaced with: supervisor calls `get_prd` as its first tool action every turn; the tool result lives in the loop's context at correct freshness; the system prompt holds only rules and structure, no data. Would have won on: saves one tool round per turn. Rejected on: false data freshness — introduces exactly the silent-staleness failure the MVP is trying to prevent.

- **Multi-spec plan with separate architecture document.** The shared contracts are small (four tool signatures + four type definitions). Six slices of a few hours each for one developer do not justify the coordination overhead of multiple spec documents. A single spec with a pinned Contracts section carries the same weight with less drift surface.

- **LLM-generated session titles.** An extra `llm.chat` invocation on the first user message of every session, adding 15–45 seconds to the highest-visibility moment in the UX. Truncation is free and good enough.

- **A2A as MVP coordination layer.** A2A specifies agent cards, task lifecycle, streaming message envelopes, and discovery — coordination semantics that rule 4 of the MVP's coordination doctrine explicitly rejects. The v1 prototype's failure mode was exactly this kind of cross-agent coordination surface. Deferred indefinitely.

- **Extensible section set.** `PRD` as `Record<string, Section>` with agent-proposed keys. Invites the model to invent keys ("risks", "assumptions") that the live pane does not render and the prompt does not address. Fixed seven is the contract.

- **SSE or token-level streaming for MVP.** 500ms polling of `GET /api/sessions/:id` while a turn is in flight achieves the "live PRD pane" property at a fraction of the complexity. Token streaming is worth building later when the UX gap is visible.

- **User-editable PRD pane in MVP.** Introduces write ownership contention between the user and the agent within a single turn. Deferred to v1.2 per brief.

- **Retry-on-LLM-failure in the turn loop.** Transient LM Studio errors (connection refused, 5xx, timeout) could be retried. Rejected for MVP because retry policy interacts with the wall-clock cap, creates ambiguous semantics for partial tool-call chains, and the user can simply resend the message. Revisit when the actual failure frequency is measured.

- **Catastrophic-rewrite length guard at the tool level.** `update_section` could reject any write where new content length is less than 50% of existing content length. Catches the worst case of paraphrase drift. Rejected for MVP because: legitimate user-requested concise rewrites would be false-positives; `user_requested_revision` as a bypass conflates two concerns; and the slice-4 empirical harness is the proper gate. Documented as a future adaptation knob.

- **DOM testing with happy-dom or jsdom.** Dropped in favor of typecheck + manual UI exercise + the Verification Scenarios. React component tests add maintenance overhead without catching the class of bugs this MVP is actually at risk of (prompt behavior, tool surface correctness, SQLite write coordination).

## Accepted Risks

- **Gemma 4 26B-A4B tool-calling support through LM Studio is unverified.** The user confirmed they will proceed without a pre-flight lab test. The slice-3 tool-calling smoke check catches this before slice 4 — if the model does not emit native `tool_calls`, slice 3 fails and the spec must adapt (fallback model, or the deferred text-format tool protocol). This pushes the failure mode forward from "slice 4 collapses after significant investment" to "slice 3 fails within an hour of implementation."

- **Option A depends on prompt-level discipline for verbatim preservation.** Local instruction-tuned models can normalize or tighten prose they are asked to preserve. The system prompt rules are the primary mitigation; the slice-4 harness is the empirical check. If the harness shows drift, the documented adaptation is to add `append_section` as a fifth tool and route additive edits through it. A further adaptation knob — tool-level catastrophic-rewrite length guard — is documented but not pre-built.

- **Confirmed-section write-lock can be bypassed by the supervisor setting `user_requested_revision=true` without a real user request.** The tool cannot tell whether the user actually asked. Mitigations: system-prompt rule instructing the model not to set this flag absent a user request; the full conversation history is directly in the supervisor's context and is the only place where "user asked" can be observed.

- **`get_prd`-first rule is prompt-enforced, not structural.** The supervisor could skip `get_prd` and call `update_section` blind. For new-section writes this is harmless. For writes to populated sections it risks preservation failure. Mitigation: system-prompt rule; slice-4 harness covers the common case where the supervisor skips the read; if drift surfaces in practice, an adaptation is to make `update_section` require a client-sent `seen_prd_at` field, enforced structurally.

- **Single SQLite row per session means every turn read is a full session read.** Acceptable at MVP scale — sessions are tens of KB and turns are tens of seconds. Revisit when sessions cross 500 KB or when turn latency becomes I/O-bound (not expected).

- **No authentication, even on localhost.** The backend listens on `127.0.0.1` only; local trust is assumed. Accepted because MVP is single-user on a developer machine.

- **500ms polling during a turn creates up to 500ms of visible lag between an agent write and the UI update.** Accepted because SSE complexity is not worth adding in the MVP. Users see the section update within two poll cycles.

- **Per-session mutex is in-process only.** Multiple backend replicas would break the guarantee. Accepted because MVP is single-process.

- **Turn latency is 30–120 seconds and the client blocks on the POST.** No background execution, no resumability. Client disconnection mid-turn: the server completes the turn, discards the reply. The user refreshes and sees their message persisted plus any PRD updates the turn produced before disconnect. Accepted because streaming and resumability are out of scope.

- **MCP child exit exits the backend.** No in-place restart; `pnpm dev` relaunches via `tsx watch`. In production this would be unacceptable; MVP is dev-only and the simpler crash-restart boundary is fine.

- **Vitest does not cover end-to-end integration.** Turn-loop tests run against stubbed `LlmClient` and `McpClient`. End-to-end behavior is verified by the Verification Scenarios and the harness, which require LM Studio. Accepted because the alternative — launching a full real LLM in CI — is not available and not desirable.

## Build Process

### Git Strategy

**Full Agentic** — The AI commits after every slice that passes its gates and proceeds through all slices without pausing for user review.

See `skills/spec-creator/references/git-strategies.md` for the four canonical strategies and their digraphs.

### Verification Commands

Run from the repo root. These are the gates between slices.

```
pnpm install
pnpm typecheck
pnpm lint
pnpm test -- --run
pnpm build
```

**Slice-specific commands.** Slice 3 additionally runs a tool-calling smoke check (specified in that slice). Slice 4 additionally runs `pnpm doc-edit-check` against LM Studio. Slice 5 additionally requires manual exercise per its verification step.

**LM Studio prerequisite.** Slices 3, 4, and 5 require LM Studio reachable at `LM_STUDIO_BASE_URL` serving `LM_STUDIO_MODEL`. If LM Studio is unreachable, the orchestrator records "LM Studio unreachable" for the affected slice and halts progress on that slice — this is a user-environment prerequisite, not an implementation defect.

### Work Process

This is the canonical implementation workflow for EBT work mode. It is embedded into every spec's Build Process section so that any agent picking up the spec has the full workflow without needing to load ebt-work-mode separately.

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

### Scenario: Create session and send first message
- **Given**: the backend is running, the frontend is loaded at `/`, and LM Studio is serving the configured model.
- **When**: the user clicks "New session", is navigated to `/sessions/:id`, and sends `"I want to build a tool that helps PMs draft PRDs."`.
- **Then**: a new row appears in the `sessions` table with `messages_json` containing one user and one assistant message, `title` equal to the first 60 characters of the user message trimmed at a word boundary, and `prd_json` with all seven sections present.

### Scenario: Supervisor reads PRD as first tool call of every turn
- **Given**: a fresh session with no prior tool calls.
- **When**: the user sends any message.
- **Then**: the first entry in the turn's tool-call trace is `call.function.name === "get_prd"`.

### Scenario: Agent fills a section from a direct request
- **Given**: an existing session with all seven sections in `empty` state.
- **When**: the user sends `"Please put the following vision: A PRD assistant that drafts sections from chat."`.
- **Then**: `prd_json.vision.content` contains the string `"drafts sections from chat"`, `prd_json.vision.status === "draft"`, and the assistant's reply acknowledges the vision has been set.

### Scenario: Agent preserves existing content when adding a bullet
- **Given**: an existing session where `prd_json.coreFeatures.content` is the markdown `"- Real-time PRD pane\n- Section-by-section editing"`.
- **When**: the user sends `"Also add: session autosave."`.
- **Then**: `prd_json.coreFeatures.content` contains all three bullets — "Real-time PRD pane", "Section-by-section editing", and a new bullet about session autosave — with the original two bullets byte-identical to before.

### Scenario: Confirmed section is not overwritten without user-requested revision
- **Given**: an existing session where `prd_json.vision.status === "confirmed"` with content `"A PRD assistant that drafts sections from chat."`.
- **When**: the supervisor, in response to a user message unrelated to vision, calls `update_section("vision", <new_content>)` without `user_requested_revision=true`.
- **Then**: the MCP tool returns `{"error": "section_confirmed", "key": "vision", "hint": ...}`, `prd_json.vision.content` is unchanged, and the supervisor's final assistant message does not claim the vision was updated.

### Scenario: Confirmed section drops to draft on user-requested revision
- **Given**: `prd_json.vision.status === "confirmed"` with non-empty content.
- **When**: the user sends `"Please revise the vision to mention that we support multiple PRDs."` and the supervisor calls `update_section("vision", <new_content>, { user_requested_revision: true })` with `status` not provided.
- **Then**: the tool succeeds, `prd_json.vision.content` updates to the new content, `prd_json.vision.status === "draft"`, and `prd_json.vision.updatedAt` advances.

### Scenario: Unknown section key is rejected structurally
- **Given**: an existing session.
- **When**: the supervisor calls `update_section("risks", "some content")`.
- **Then**: the MCP tool returns `{"error": "unknown_section_key", "valid_keys": ["vision","problem","targetUsers","goals","coreFeatures","outOfScope","openQuestions"]}`, no row write occurs, and the turn continues without crashing.

### Scenario: mark_confirmed refuses to confirm an empty section
- **Given**: an existing session where `prd_json.problem.content === ""` and `status === "empty"`.
- **When**: the supervisor calls `mark_confirmed("problem")`.
- **Then**: the MCP tool returns `{"error": "cannot_confirm_empty_section", "key": "problem"}`, the status remains `"empty"`, and the turn continues.

### Scenario: Content over size cap is rejected
- **Given**: an existing session.
- **When**: the supervisor calls `update_section("vision", <10001-character string>)`.
- **Then**: the MCP tool returns `{"error": "content_too_long", "max": 10000, "got": 10001}`, no write occurs, and the turn continues.

### Scenario: Empty user message is rejected at the HTTP boundary
- **Given**: a valid session id `abc`.
- **When**: a client sends `POST /api/sessions/abc/messages` with body `{"text": "   "}`.
- **Then**: the response is HTTP 400 with body `{"error": "invalid_request", "details": ...}`, no session mutation occurs, and no LLM call is made.

### Scenario: Malformed tool arguments do not crash the turn or lose the user message
- **Given**: an existing session; the supervisor produces a `tool_calls` entry whose `function.arguments` is `"{ key: vision, content: ..."` — invalid JSON.
- **When**: the turn loop processes that tool call.
- **Then**: the user message is persisted to `messages_json` before the failure, no exception bubbles to the HTTP layer, the loop appends a `role: "tool"` message with `{"error": "invalid_tool_arguments", "message": <parser_message>}`, and the loop continues to the next iteration.

### Scenario: Unknown tool name returned by the model is recovered
- **Given**: the supervisor emits a `tool_calls` entry with `function.name === "modify_vision"` (not a real tool).
- **When**: the turn loop processes that tool call.
- **Then**: the loop appends `{"error": "unknown_tool", "name": "modify_vision", "valid_tools": ["get_prd","update_section","list_empty_sections","mark_confirmed"]}`, and the loop continues to the next iteration.

### Scenario: Two concurrent turn attempts on the same session
- **Given**: a session id `abc` with an in-flight `POST /api/sessions/abc/messages` request.
- **When**: a second `POST /api/sessions/abc/messages` request for the same session arrives while the first is running.
- **Then**: the second request returns HTTP 409 `{"error": "session_busy"}` within 100ms and does not block waiting for the first.

### Scenario: Turn exceeds iteration cap
- **Given**: a session and a stubbed `LlmClient` that emits tool calls on every iteration indefinitely.
- **When**: the loop would enter iteration 7.
- **Then**: the loop stops, appends an assistant message `"I hit a tool-call loop limit. Please rephrase your request or try a smaller step."` to `messages_json`, persists, returns HTTP 200 with that reply content, and releases the mutex.

### Scenario: Per-call timeout on the LLM
- **Given**: a session and a stubbed `LlmClient` whose `chat()` never resolves.
- **When**: 90 seconds elapse on a single `chat()` call.
- **Then**: the `AbortSignal` fires, the loop appends `"The model took too long to respond. Please try again."`, persists, returns HTTP 200, and releases the mutex.

### Scenario: Live PRD pane updates within two poll cycles of a section write
- **Given**: the frontend is showing `/sessions/:id` with a turn in flight and `coreFeatures.content` currently empty.
- **When**: the supervisor calls `update_section("coreFeatures", "- Feature A")` mid-turn.
- **Then**: within 1000ms (two poll cycles) the rendered `coreFeatures` section block shows "Feature A" and the status pill reads `draft`, without a manual refresh.

### Scenario: Tool-calling smoke check (slice 3)
- **Given**: LM Studio is running and serving `LM_STUDIO_MODEL`; slice 3 has added a temporary `POST /api/debug/tool-calling-smoke` route.
- **When**: the operator (or the slice verification) calls the route, which invokes `llm.chat` with a single dummy tool named `echo` and messages asking the model to call `echo` with `{"text": "hi"}`.
- **Then**: the response's `choices[0].message.tool_calls` is a non-empty array whose first entry has `function.name === "echo"` and parseable JSON arguments containing `text: "hi"`. Failure halts slice 3; slice 4 is not built against a model that cannot emit native `tool_calls`.

### Scenario: Doc-editing harness pass (slice 4)
- **Given**: a clean `./tmp/harness.sqlite` file and LM Studio serving `LM_STUDIO_MODEL`.
- **When**: the operator runs `pnpm doc-edit-check`.
- **Then**: the script runs all three scripted turns without uncaught exception, prints the final `coreFeatures` section and `vision` section and the full PRD, and the operator confirms manually: `coreFeatures` contains three bullets covering real-time pane, section editing, and session autosave; bullet text is recognizably from the user messages (not paraphrased); `vision` still contains content from turn 1.

## Adaptation Log

### 2026-04-17 — slice 3: `TurnDeps` store field named `store`, not `db`

The Turn loop section of this spec declares `TurnDeps` with field `db: SessionStore`. During slice-3 implementation the field was named `store: SessionStore` to avoid naming ambiguity with the raw `better-sqlite3` `Database` handle also passed around inside `src/server/`. No behavior impact. Affected files: `src/server/turn.ts`, `src/server/routes.ts`, `src/server/turn.test.ts`. Slice 4 inherits the `store` name and adds `mcp: McpClient` alongside it.

## Implementation Slices

```digraph
slice_1_skeleton -> slice_2_sessions
slice_2_sessions -> slice_3_chat
slice_3_chat -> slice_4_mcp_tools
slice_4_mcp_tools -> slice_5_live_pane
```

### Slice 1: Skeleton
- **What**: Initialize the pnpm package, root `tsconfig.json` with strict settings, ESLint, Prettier, Vitest, Tailwind, Vite. Create `src/shared/types.ts` with full domain types per the Data model section. Stand up Hono backend with `GET /api/health` returning `{"ok": true}`. Stand up Vite + React + TS frontend with a landing page that fetches `/api/health` and displays the result. Root `pnpm dev` runs backend (`tsx watch src/server/index.ts`) and frontend (`vite`) concurrently; Vite proxies `/api/*` to `http://127.0.0.1:5174`.
- **Verify**: `pnpm typecheck && pnpm lint && pnpm build` exits 0. Then: `pnpm dev`; open `http://localhost:5173`; page displays `ok: true`. Confirm Hono logs the listen address as `127.0.0.1:5174` (not `0.0.0.0`).
- **Outcome**: Foundational. Two processes, proxy wiring, type foundation in place.

### Slice 2: Sessions CRUD
- **What**: Add `better-sqlite3`. Create `sessions` table via an idempotent migration in `src/server/db.ts` (or `src/mcp/db.ts`, invoked on first open from the backend at boot even though the MCP child is not yet integrated — the schema is shared). Implement `GET /api/sessions`, `POST /api/sessions`, `GET /api/sessions/:id` with `zod`-validated I/O. Implement the initial PRD factory (all seven keys, `empty` status). Session list ordered by `updated_at DESC`. Frontend: `react-router-dom` with two routes; session list sidebar at `/`; "New session" button; `/sessions/:id` renders an empty two-pane shell (no chat input, no PRD content yet — just the section labels with `empty` pills).
- **Verify**: `pnpm typecheck && pnpm lint && pnpm test -- --run && pnpm build` exits 0. Vitest covers the initial PRD factory and session-row serialization. Manually: create a session via the UI, confirm it appears in the list, refresh, confirm persistence; `sqlite3 ./data/prd-assist.sqlite "select * from sessions"` shows the row with all columns populated.
- **Outcome**: User can create and list sessions. No chat, no tool calls.

### Slice 3: Chat without tools, plus tool-calling smoke check
- **What**: Add `src/server/llm.ts` with the `LlmClient` interface and production adapter using the `openai` npm client pointed at `LM_STUDIO_BASE_URL`. Add `src/server/mutex.ts` with `SessionMutex`. Add `POST /api/sessions/:id/messages` with `zod` body validation (`text` trimmed length 1–10000). Implement a reduced `handleTurn` that ignores MCP tools entirely: single `llm.chat` call with system prompt + history, append assistant reply, persist, return. Implement title derivation on the first user message. Implement mutex-based 409. Frontend: chat pane with bubble rendering (`react-markdown` + `remark-gfm`) and input textarea; input disabled while a POST is in flight; failure renders inline error.

  Also add a temporary debug route `POST /api/debug/tool-calling-smoke` that invokes `llm.chat` with one dummy tool `echo` and asks the model to call it. Register the route behind an environment check so it only mounts when `NODE_ENV !== "production"`.
- **Verify**: `pnpm typecheck && pnpm lint && pnpm test -- --run && pnpm build` exits 0. Vitest covers: title derivation (edge cases listed in Testing Approach), mutex acquire/release/contend, `LlmClient` interface adhered to by the production adapter (typecheck-level), route-level `text` validation. Manually: with LM Studio running, send a message, observe a reply, confirm title derivation, trigger a concurrent second POST and confirm 409. Run the tool-calling smoke check via `curl -X POST http://localhost:5174/api/debug/tool-calling-smoke` and confirm the response contains a `tool_calls` array with `function.name === "echo"`. If the smoke check fails, halt and escalate — slice 4 will not work as designed.
- **Outcome**: User holds a basic chat with the supervisor. No PRD writes. Tool-calling format is proven to work against the configured model.

### Slice 4: MCP server + PRD tools + full turn loop + doc-editing harness
- **What**: Implement the MCP server at `src/mcp/` with all four tools, including the `user_requested_revision` argument, key/content/status validators, empty-section rejection on `mark_confirmed`, and dedicated SQLite connection. Implement `src/server/mcpClient.ts` with the `McpClient` interface and a production adapter that spawns the MCP server as a child process and speaks the MCP protocol over stdio. Wire the child spawn into `src/server/index.ts` boot: wait for `initialize` handshake before starting HTTP listen; on child exit log and exit.

  Replace the reduced `handleTurn` with the full loop per the Turn loop section: LLM-client and MCP-client dependencies injected via `TurnDeps`, all tool-call errors handled with structured recovery, iteration cap (6), per-call timeout (90s), wall-clock cap (300s), fixed system-error strings. Remove the debug `tool-calling-smoke` route.

  Implement `buildSystemPrompt` in `src/server/prompt.ts` with all five rule sentences verbatim.

  Frontend: `SectionBlock` renders the markdown content and the status pill; empty content shows `"(empty)"`. No polling yet. The PRD pane renders the current state on mount and on navigation.

  Write `scripts/doc-edit-check.ts` per the Doc-editing verification harness section. Add `doc-edit-check` script to `package.json`.
- **Verify**: `pnpm typecheck && pnpm lint && pnpm test -- --run && pnpm build` exits 0. Vitest covers: `SectionKey`/`SectionStatus` validators, content-length validator, `user_requested_revision` gating logic (tests call tool functions directly), `list_empty_sections` ordering, `mark_confirmed` on empty-content rejection, `buildSystemPrompt` contains each verbatim rule sentence, full `handleTurn` against stubbed `LlmClient` covering: happy path with `get_prd` + `update_section` + reply, JSON-parse-failure recovery, unknown-tool recovery, MCP-exception recovery, iteration cap breach, per-call timeout (signal abort), wall-clock breach, per-session mutex contention. Then: `rm -f ./tmp/harness.sqlite && pnpm doc-edit-check` with LM Studio running. Confirm all three scripted turns complete, the harness prints `coreFeatures` with three bullets, and the operator confirms the three pass conditions manually.
- **Outcome**: The agent writes PRD sections in response to user chat. Reload of `/sessions/:id` shows section content. Doc-editing reliability is empirically verified on the target model.

### Slice 5: Live PRD pane
- **What**: Implement `src/web/src/hooks/useSessionPolling.ts`: polls `GET /api/sessions/:id` every 500ms while a flag (`active`) is true, stops otherwise, returns the most recent session. Wire the flag to the chat pane's in-flight state. `PrdPane.tsx` consumes the polled session and re-renders section blocks. Finalize layout: chat on the left at 400px fixed width, PRD pane on the right scrollable.
- **Verify**: `pnpm typecheck && pnpm lint && pnpm test -- --run && pnpm build` exits 0. Vitest covers the polling hook's start/stop transitions (unit test using fake timers). Manually execute the "Live PRD pane updates within two poll cycles of a section write" scenario: start a new session, send a message that asks the agent to write the vision, confirm the vision content appears in the right pane within 1000ms of the agent's `update_section` tool call returning, without manual refresh. Also confirm: status pill transitions from `empty` → `draft`; empty sections still show the `(empty)` placeholder.
- **Outcome**: User sees the PRD form live while chatting. MVP complete.

## Acceptance Criteria

- `pnpm install && pnpm typecheck && pnpm lint && pnpm test -- --run && pnpm build` exits 0 from the repo root with no ESLint errors and no `tsc` errors.
- The `sessions` table schema matches the DDL in the Architecture section exactly (column names, types, defaults, index), verified by `sqlite3 ./data/prd-assist.sqlite ".schema sessions"`.
- The MCP server exposes exactly four tools, verified by calling `listTools` from a Vitest integration test and asserting the returned names equal the set `{"get_prd", "update_section", "list_empty_sections", "mark_confirmed"}`.
- Each of the four MCP tool descriptions matches, byte-for-byte, the verbatim strings specified in the MCP tools section of this spec — verified by a Vitest equality check on the manifest.
- Each MCP tool's `inputSchema.properties.key` enum (where present) contains exactly the seven `SectionKey` values in the declared order — verified by a Vitest equality check on the manifest.
- `MCP tool results are wrapped as `{ content: [{ type: "text", text: <json-string> }], isError: false }` — verified by a Vitest call against a real `get_prd` invocation asserting the shape of the returned result.
- The MCP-to-OpenAI tool conversion function in `src/server/mcpClient.ts` produces `{ type: "function", function: { name, description, parameters } }` entries with `parameters` identical to the MCP tool's `inputSchema` — verified by a Vitest equality check.
- `src/server/prompt.ts` exports `buildSystemPrompt(): string`. Vitest asserts the return value contains, byte-for-byte, each of the five numbered rule sentences defined in the System prompt section.
- `src/server/turn.ts` exports `handleTurn` taking a `TurnDeps` argument. `src/server/turn.ts` does not statically import `openai`, `@modelcontextprotocol/sdk`, or `better-sqlite3` — verified by `grep -E "from ['\"](openai|@modelcontextprotocol|better-sqlite3)" src/server/turn.ts` returning no matches.
- Calling `update_section` with `key="risks"` returns `{"error": "unknown_section_key", "valid_keys": [...]}` — verified by Vitest.
- Calling `update_section` on a `confirmed` section without `user_requested_revision=true` returns `{"error": "section_confirmed", ...}` — verified by Vitest.
- Calling `update_section` on a `confirmed` section with `user_requested_revision=true` and no explicit `status` succeeds and leaves the section at `status: "draft"` — verified by Vitest.
- Calling `mark_confirmed` on a section with empty content returns `{"error": "cannot_confirm_empty_section", ...}` — verified by Vitest.
- Calling `update_section` with 10001-character `content` returns `{"error": "content_too_long", "max": 10000, "got": 10001}` — verified by Vitest.
- Sending `POST /api/sessions/:id/messages` with `{"text": "   "}` returns HTTP 400 — verified by a Vitest route-level test.
- Starting two concurrent `POST /api/sessions/:id/messages` requests against the same session id within 100ms returns one 200 (eventually) and one 409 immediately — verified by a Vitest integration test using the stubbed `LlmClient` to freeze the first request.
- `handleTurn` returns the fixed iteration-cap string after 6 tool-calling iterations from a stubbed `LlmClient` — verified by Vitest.
- `handleTurn` returns the fixed per-call-timeout string when a stubbed `LlmClient.chat()` never resolves within 90 seconds (test uses a short override config with fake timers) — verified by Vitest.
- The slice-3 tool-calling smoke check passes against the configured model — verified by running the debug route and observing a non-empty `tool_calls` array with `function.name === "echo"`.
- The slice-4 doc-editing harness `pnpm doc-edit-check` completes a three-turn run without uncaught exceptions and prints a final `coreFeatures` containing three bullets recognizable from the scripted user messages.
- Opening `http://localhost:5173/sessions/:id`, sending a message that triggers a section write, and observing the PRD pane results in the section content becoming visible within 1000ms of the tool call returning, without manual refresh — verified manually against the "Live PRD pane updates within two poll cycles" scenario.
- No file in `src/` imports from any path containing `lai-assist`, and no file in `src/` references the identifiers `event_id`, `active_agents`, `snapshot`, `pydantic`, `clarifier`, `planner`, `critic`, `researcher`, `writer`, `narrator`, `orchestrator` (as a non-comment identifier). Verified by `grep -RE "lai-assist|event_id|active_agents|\\bsnapshot\\b|pydantic|\\bclarifier\\b|\\bplanner\\b|\\bcritic\\b|\\bresearcher\\b|\\bwriter\\b|\\bnarrator\\b" src/`.
- No occurrence of the string `A2A` in `src/` or `scripts/` — verified by `grep -R "A2A" src scripts`.
- No module under `src/server/` or `src/mcp/` performs I/O or spawns processes at import time — verified by `node -e "require('./dist/server/turn.js'); require('./dist/mcp/tools.js')"` completing without opening a network or file handle (enforced structurally by the no-static-I/O-imports acceptance criterion above).
