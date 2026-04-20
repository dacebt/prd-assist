# LAI-Assist v2 — MVP Brief

> Condensed rewrite plan. The prototype proved the individual pieces work but the reactive agent swarm is unmanageable. v2 replaces the swarm with a **supervisor + callable specialists** model. Starts with one agent; expands without repeating the prototype's mistakes.

---

## 1. Goal

Chat-driven PRD builder. User talks to one agent. Agent asks clarifying questions, writes/updates PRD sections through tools, user watches the PRD form live alongside the conversation.

MVP = single agent, four tools, live PRD pane. Everything else earns its way in.

---

## 2. The core system

Three things, three processes:

```
┌─────────────────┐ HTTP  ┌──────────────────────┐ stdio ┌──────────────┐
│  React (Vite)   │◄─────►│  Node backend (Hono) │◄─────►│  MCP server  │
│  chat + PRD     │ SSE   │  - sessions          │       │  (PRD tools) │
└─────────────────┘       │  - turn loop         │       └──────┬───────┘
                          │  - supervisor agent  │              │
                          └──────────┬───────────┘       ┌──────▼───────┐
                                     │                   │   SQLite     │
                                     ▼                   │  (sessions)  │
                              ┌──────────────┐           └──────────────┘
                              │  LM Studio   │
                              │ (OpenAI API) │
                              └──────────────┘
```

No Redis. No event stream. No blackboard. No Docker required for dev. One SQLite file is the entire persistence layer.

The **turn loop** is the heart — a single function, ~30 lines, that takes a user message and returns an assistant message. Every other piece of the system (persistence, MCP, streaming, future specialists) is something the turn loop calls into.

---

## 3. Data model

```ts
type Session = {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string; // derived from first user message
  messages: ChatMessage[];
  prd: PRD;
};

type ChatMessage =
  | { role: "user"; content: string; at: string }
  | { role: "assistant"; content: string; at: string };

type PRD = {
  vision: Section;
  problem: Section;
  targetUsers: Section;
  goals: Section;
  coreFeatures: Section;
  outOfScope: Section;
  openQuestions: Section;
};

type Section = {
  content: string; // markdown
  updatedAt: string;
  status: "empty" | "draft" | "confirmed";
};
```

One row per session in SQLite, session stored as a JSON blob. Normalize later if you ever need to query across sessions.

---

## 4. MCP tools (four, that's it)

```
get_prd(session_id) -> PRD
update_section(session_id, key, content, status?) -> Section
list_empty_sections(session_id) -> string[]
mark_confirmed(session_id, key) -> Section
```

The agent reads the whole PRD at the start of each turn (it's small, few KB), writes sections as understanding develops, asks the user to confirm before marking sections done. No RAG, no research, no embeddings yet.

---

## 5. The turn loop

```ts
async function handleTurn(sessionId: string, userText: string): Promise<string> {
  const session = await loadSession(sessionId);
  session.messages.push({ role: "user", content: userText, at: now() });

  const tools = await mcp.listTools();
  const history = session.messages;
  const systemPrompt = buildSystemPrompt(session.prd);

  while (true) {
    const res = await llm.chat({
      model: "local-model",
      messages: [{ role: "system", content: systemPrompt }, ...history],
      tools,
    });
    const msg = res.choices[0].message;
    history.push(msg);

    if (msg.tool_calls?.length) {
      for (const call of msg.tool_calls) {
        const out = await mcp.callTool(call.function.name, JSON.parse(call.function.arguments));
        history.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
      }
      continue; // let the LLM react to tool results
    }

    session.messages.push({ role: "assistant", content: msg.content, at: now() });
    await saveSession(session);
    return msg.content;
  }
}
```

That's the whole engine. Every future capability — specialists, streaming, approval flows — either modifies `tools`, modifies `systemPrompt`, or wraps this function. Nothing else reaches in.

---

## 6. Agent interaction model

This is the section the prototype didn't have — and the reason it went off the rails. v2 commits to an explicit coordination shape from day one, even while only one agent exists.

### 6.1 The model: supervisor + callable specialists

- **Supervisor** — the one LLM in the turn loop above. Talks to the user. Decides what needs doing next. The _only_ agent the user converses with.
- **Specialists** — LLM-backed functions the supervisor can call as tools. Examples you'll add later: `critique_section`, `prioritize_features`, `suggest_open_questions`, `research_topic`.
- **Tools** — deterministic functions (the four MCP tools above, plus any pure utilities).

From the supervisor's perspective, **there is no difference between a tool and a specialist**. Both are just tool calls. Under the hood, a specialist is a second LLM call with its own focused prompt and a narrow set of sub-tools. It takes an input, returns an output, and is done.

### 6.2 The four rules

1. **Specialists are stateless.** Every invocation gets everything it needs as arguments. No ambient session state, no event subscriptions, no lifecycle. When the function returns, the specialist ceases to exist.
2. **Only the supervisor talks to the user.** Specialists produce structured output for the supervisor, never user-facing text. If the supervisor wants to surface a specialist's finding, it paraphrases in its own turn.
3. **Specialists don't know about each other.** They don't call each other, don't emit events, don't read shared state beyond their input arguments. Composition happens in the supervisor or in the code that wraps it.
4. **No shared event bus.** If you find yourself wanting Redis streams, consumer groups, or reactive subscriptions, stop and redesign. That's how v1 died.

### 6.3 What a specialist looks like

```ts
// Every specialist has this shape.
type Specialist<TInput, TOutput> = (input: TInput) => Promise<TOutput>;

// Example: a critic specialist (added in v2.0, not MVP).
const critiqueSection: Specialist<
  { sectionKey: string; content: string; fullPrd: PRD },
  { issues: Issue[]; severity: "minor" | "major" | "blocking" }
> = async (input) => {
  const res = await llm.chat({
    model: "local-model",
    messages: [
      { role: "system", content: CRITIC_PROMPT },
      { role: "user", content: JSON.stringify(input) },
    ],
    response_format: { type: "json_schema", json_schema: CRITIC_OUTPUT_SCHEMA },
  });
  return JSON.parse(res.choices[0].message.content);
};
```

The supervisor sees a tool named `critique_section(section_key, content, full_prd) -> Critique` and decides when to invoke it. It looks identical to `update_section`. The supervisor doesn't know one is deterministic and one is another LLM call. It doesn't need to.

### 6.4 How coordination actually happens

**Inside a single turn**, the supervisor may call tools + specialists in whatever order the model decides. Example flow for "please make this PRD more specific":

1. Supervisor calls `get_prd`.
2. Supervisor calls `critique_section(vision)` → returns `{ issues: [...], severity: "major" }`.
3. Supervisor calls `critique_section(problem)` → returns `{ issues: [], severity: "minor" }`.
4. Supervisor composes a reply to the user summarizing what needs attention.

That whole sequence is sequential inside the turn loop. No concurrency, no events, no lifecycle. If step 2 times out, the turn fails cleanly — no other agents are affected because there aren't any.

**Across turns**, state lives in `session.prd` and `session.messages`. That's it. Nothing persists between turns except what's in the session row.

### 6.5 When you think you want multi-agent, you probably want multi-tool

The prototype made 10 things into agents that should have been tools. Heuristic:

- If it's deterministic → **tool**.
- If it's an LLM call that produces structured output for consumption by another LLM → **specialist** (implemented as a tool).
- If it's a long-running autonomous actor with its own goals → **you don't need this for an MVP and probably not for v2 either**.

The third category is the trap. Don't build it until you have a specific, concrete use case that genuinely requires autonomous behavior. "Having a critic that watches and chimes in" is not that use case — a critic called by the supervisor at the right moment is simpler and better.

### 6.6 Failure modes to watch for (and how the model prevents them)

| Prototype failure                                                         | v2 prevention                                                                                                                                                  |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agents reacting to each other's lifecycle events → infinite amplification | No lifecycle events exist. Specialists are function calls with a return value.                                                                                 |
| Watchdog timing out stuck agents                                          | Specialist calls are awaited with a timeout at the call site. Timeout = that tool call fails. Supervisor handles it in its next thought.                       |
| Per-turn dedup, consumer groups, ack/nack                                 | No event stream to dedup over. Each turn is a function call.                                                                                                   |
| Critic and planner ping-ponging disagreements                             | The supervisor decides how many critique rounds to run. If it wants a second pass, it calls `critique_section` again. Explicit, bounded, visible in the trace. |
| Narrator agent over-firing                                                | Narration is the supervisor's own reply. There's no separate narrator.                                                                                         |

---

## 7. Stack

- **Frontend**: Vite + React + TypeScript. Tailwind optional. Two-pane layout (chat left, live PRD right) — keep this from v1, it worked.
- **Backend**: Node 20+, Hono (or Fastify), TypeScript.
- **LLM client**: `openai` npm package against LM Studio's OpenAI-compatible endpoint.
- **MCP**: `@modelcontextprotocol/sdk`. Server as a child process, stdio transport.
- **DB**: `better-sqlite3`. Synchronous API, one file, perfect for single-user local.
- **Package manager**: pnpm or bun.

---

## 8. Build order

Each slice demoable in a browser before moving on.

1. **Skeleton** — Vite + Hono + `/api/health`. ~1h.
2. **Sessions** — create/load/list, SQLite persisting. Frontend can switch between sessions. No LLM yet. ~2h.
3. **Chat, no tools** — Backend calls LM Studio, returns reply, frontend renders bubbles. ~3h.
4. **MCP server + 4 PRD tools** — Separate process. Agent loop uses them. Verify by telling the agent "fill in the vision" and watching the DB update. ~4h.
5. **Live PRD pane** — Right-side pane renders `session.prd`. Poll `/api/sessions/:id` every 500ms while a turn is in flight. ~2h.
6. **SSE streaming** (optional) — Replace polling with token-by-token streaming when you want it. ~3h.

**~1–2 weekends to working MVP.** Resist adding anything else until you've used it to write a real PRD.

---

## 9. Expansion path

Resist this list until the MVP has written a real PRD and you know what hurts.

- **v1.1 — Streaming.** SSE for assistant replies.
- **v1.2 — Section edit UI.** User clicks into the PRD pane and edits a section directly. Agent observes the edit on its next turn via `get_prd`.
- **v2.0 — First specialist: critic.** Add `critique_section` as a specialist. This is the moment to re-read section 6 and verify you're not smuggling back in a bus or a reactive pattern. Start with ONE specialist and prove the pattern.
- **v2.1 — Second specialist: researcher.** `research_topic(query) -> findings`. Probably uses a web-search MCP tool under the hood.
- **v2.2 — Structured confirm loop.** After enough sections are drafted, supervisor calls a specialist that checks whether the PRD is ready for human review, returns a checklist.
- **v3.0 — RAG over past PRDs.** Only if you've accumulated enough PRDs that reuse has measurable value. Not before.

Each step adds one tool or one specialist. Never more than one at a time. Never adds a coordination mechanism.

---

## 10. Non-goals

- Not multi-user.
- Not real-time collaborative.
- Not a general product workbench — only PRDs.
- Not agentic / autonomous. Agent speaks only when spoken to.
- Not a framework. No "plug in your own agent." Code the specific behaviors you need.

---

## 11. Lessons from the prototype

- Emergent coordination between reactive agents is a research problem. Don't ship it as architecture.
- Every workaround (per-turn dedup, watchdog, consumer groups) was a symptom of one root cause: the system produced more events than could be reasoned about.
- Treat an LLM as a function that returns a value. State lives outside the function. Lifecycle is the caller's problem. This framing makes composition obvious.
- The frontend, the MCP tool surface, and the section-based PRD model were the parts that held up. Carry them forward in spirit.
- The supervisor + specialist pattern is boring. That's the point. Boring systems are the ones you can keep debugging on Saturday evening.
