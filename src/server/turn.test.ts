import { describe, it, expect, vi } from "vitest";
import { handleTurn, SessionBusyError, SessionNotFoundError, type TurnDeps } from "./turn";
import type { LlmClient, AssistantMessage } from "./llm";
import type { McpClient, McpToolDescriptor } from "./mcpClient";
import type { SessionStore } from "./sessions";
import type { SessionMutex } from "./mutex";
import type { Session } from "@prd-assist/shared";
import { createSessionMutex } from "./mutex";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "test-session",
    title: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [],
    prd: {} as Session["prd"],
    ...overrides,
  };
}

function makeStore(session: Session | null): SessionStore & {
  persistUserCalls: Session[];
  persistAssistantCalls: Session[];
} {
  const persistUserCalls: Session[] = [];
  const persistAssistantCalls: Session[] = [];
  return {
    createSession: vi.fn(),
    listSessions: vi.fn(),
    getSession: (_id: string) => session,
    persistUserMessage(s: Session) {
      persistUserCalls.push({ ...s, messages: [...s.messages] });
    },
    persistAssistantMessage(s: Session) {
      persistAssistantCalls.push({ ...s, messages: [...s.messages] });
    },
    persistUserCalls,
    persistAssistantCalls,
  };
}

function makeLlmClient(reply: string | (() => Promise<AssistantMessage>)): LlmClient {
  return {
    chat: () => {
      if (typeof reply === "string") {
        return Promise.resolve({ role: "assistant", content: reply });
      }
      return reply();
    },
  };
}

function makeDefaultMcpClient(overrides: Partial<McpClient> = {}): McpClient {
  return {
    listTools: () => Promise.resolve([]),
    callTool: () => Promise.resolve({}),
    close: () => Promise.resolve(),
    ...overrides,
  };
}

const MOCK_GET_PRD_TOOL: McpToolDescriptor = {
  name: "get_prd",
  description: "Read the PRD",
  inputSchema: { type: "object", properties: { session_id: { type: "string" } } },
};

const MOCK_UPDATE_SECTION_TOOL: McpToolDescriptor = {
  name: "update_section",
  description: "Update a section",
  inputSchema: { type: "object", properties: { session_id: { type: "string" } } },
};

function makeDeps(
  session: Session | null,
  llm: LlmClient,
  mutex: SessionMutex = createSessionMutex(),
  mcp: McpClient = makeDefaultMcpClient(),
): TurnDeps & { store: ReturnType<typeof makeStore> } {
  const store = makeStore(session);
  return {
    store,
    llm,
    mcp,
    mutex,
    now: () => new Date("2026-01-01T10:00:00.000Z"),
    config: {
      model: "test-model",
      maxIterations: 6,
      perCallTimeoutMs: 90_000,
      wallClockMs: 300_000,
    },
  };
}

describe("handleTurn", () => {
  it("happy path returns assistant content", async () => {
    const session = makeSession();
    const deps = makeDeps(session, makeLlmClient("Hello from assistant"));

    const result = await handleTurn({
      sessionId: "test-session",
      userText: "hi",
      deps,
    });

    expect(result).toBe("Hello from assistant");
  });

  it("persists user message before calling llm", async () => {
    const session = makeSession();
    let userPersistedBeforeLlm = false;
    const llm: LlmClient = {
      chat: () => {
        userPersistedBeforeLlm = deps.store.persistUserCalls.length > 0;
        return Promise.resolve({ role: "assistant", content: "ok" });
      },
    };
    const deps = makeDeps(session, llm);

    await handleTurn({ sessionId: "test-session", userText: "hello", deps });

    expect(userPersistedBeforeLlm).toBe(true);
  });

  it("persists user message even when LLM throws", async () => {
    const session = makeSession();
    const llm: LlmClient = {
      chat: () => Promise.reject(new Error("LLM exploded")),
    };
    const deps = makeDeps(session, llm);

    await handleTurn({ sessionId: "test-session", userText: "hello", deps });

    expect(deps.store.persistUserCalls.length).toBe(1);
    expect(deps.store.persistAssistantCalls.length).toBe(1);
    expect(deps.store.persistAssistantCalls[0]?.messages.at(-1)?.role).toBe("assistant");
  });

  it("mutex is held during the turn and released after", async () => {
    const session = makeSession();
    const mutex = createSessionMutex();
    let heldDuringTurn = false;
    const llm: LlmClient = {
      chat: () => {
        heldDuringTurn = !mutex.tryAcquire("test-session");
        if (!heldDuringTurn) mutex.release("test-session");
        return Promise.resolve({ role: "assistant", content: "ok" });
      },
    };
    const deps = makeDeps(session, llm, mutex);

    await handleTurn({ sessionId: "test-session", userText: "hello", deps });

    expect(heldDuringTurn).toBe(true);
    expect(mutex.tryAcquire("test-session")).toBe(true);
  });

  it("throws SessionBusyError when mutex is already held", async () => {
    const session = makeSession();
    const mutex = createSessionMutex();
    mutex.tryAcquire("test-session");

    const deps = makeDeps(session, makeLlmClient("ok"), mutex);

    await expect(
      handleTurn({ sessionId: "test-session", userText: "hello", deps }),
    ).rejects.toThrow(SessionBusyError);
  });

  it("throws SessionNotFoundError for unknown session", async () => {
    const deps = makeDeps(null, makeLlmClient("ok"));

    await expect(
      handleTurn({ sessionId: "test-session", userText: "hello", deps }),
    ).rejects.toThrow(SessionNotFoundError);
  });

  it("returns per-call timeout message when signal aborts", async () => {
    const session = makeSession();
    const deps = makeDeps(
      session,
      {
        chat: ({ signal }) =>
          new Promise((_resolve, reject) => {
            if (signal?.aborted) {
              reject(signal.reason);
              return;
            }
            signal?.addEventListener("abort", () => reject(signal.reason));
          }),
      },
      createSessionMutex(),
    );
    deps.config.perCallTimeoutMs = 50;

    const result = await handleTurn({ sessionId: "test-session", userText: "hello", deps });

    expect(result).toBe("The model took too long to respond. Please try again.");
  }, 5000);

  it("derives title from first user message", async () => {
    const session = makeSession();
    const deps = makeDeps(session, makeLlmClient("ok"));

    await handleTurn({ sessionId: "test-session", userText: "Build me a PRD", deps });

    expect(deps.store.persistUserCalls[0]?.title).toBe("Build me a PRD");
  });

  it("does not overwrite title on second message", async () => {
    const session = makeSession({ title: "Already set" });
    const deps = makeDeps(session, makeLlmClient("ok"));

    await handleTurn({ sessionId: "test-session", userText: "Second message", deps });

    expect(deps.store.persistUserCalls[0]?.title).toBe("Already set");
  });

  it("happy path with tool calls: get_prd then update_section then final text", async () => {
    const session = makeSession();
    const callToolSpy = vi.fn().mockResolvedValue({ content: "mocked prd" });

    const mcp = makeDefaultMcpClient({
      listTools: () => Promise.resolve([MOCK_GET_PRD_TOOL, MOCK_UPDATE_SECTION_TOOL]),
      callTool: callToolSpy,
    });

    let callCount = 0;
    const llm: LlmClient = {
      chat: () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "get_prd", arguments: '{"session_id":"test-session"}' },
              },
            ],
          });
        }
        if (callCount === 2) {
          return Promise.resolve({
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-2",
                type: "function",
                function: {
                  name: "update_section",
                  arguments: '{"session_id":"test-session","key":"vision","content":"A vision"}',
                },
              },
            ],
          });
        }
        return Promise.resolve({ role: "assistant", content: "Done! Vision updated." });
      },
    };

    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    const result = await handleTurn({ sessionId: "test-session", userText: "Set vision", deps });

    expect(result).toBe("Done! Vision updated.");
    expect(callToolSpy).toHaveBeenCalledTimes(2);
    expect(callToolSpy).toHaveBeenNthCalledWith(1, "get_prd", { session_id: "test-session" });
    expect(callToolSpy).toHaveBeenNthCalledWith(2, "update_section", {
      session_id: "test-session",
      key: "vision",
      content: "A vision",
    });
  });

  it("handles JSON-parse failure in tool arguments", async () => {
    const session = makeSession();
    const mcp = makeDefaultMcpClient({
      listTools: () => Promise.resolve([MOCK_GET_PRD_TOOL]),
    });

    let callCount = 0;
    const llm: LlmClient = {
      chat: () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-bad",
                type: "function",
                function: { name: "get_prd", arguments: "{ invalid json" },
              },
            ],
          });
        }
        return Promise.resolve({ role: "assistant", content: "recovered" });
      },
    };

    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    const result = await handleTurn({ sessionId: "test-session", userText: "hi", deps });

    expect(result).toBe("recovered");
  });

  it("handles unknown tool name from model", async () => {
    const session = makeSession();
    const mcp = makeDefaultMcpClient({
      listTools: () => Promise.resolve([MOCK_GET_PRD_TOOL]),
    });

    let callCount = 0;
    const llm: LlmClient = {
      chat: () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "modify_vision", arguments: "{}" },
              },
            ],
          });
        }
        return Promise.resolve({ role: "assistant", content: "recovered from unknown tool" });
      },
    };

    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    const result = await handleTurn({ sessionId: "test-session", userText: "hi", deps });

    expect(result).toBe("recovered from unknown tool");
  });

  it("handles MCP callTool throwing", async () => {
    const session = makeSession();
    const mcp = makeDefaultMcpClient({
      listTools: () => Promise.resolve([MOCK_GET_PRD_TOOL]),
      callTool: () => Promise.reject(new Error("MCP connection failed")),
    });

    let callCount = 0;
    const llm: LlmClient = {
      chat: () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "get_prd", arguments: '{"session_id":"test-session"}' },
              },
            ],
          });
        }
        return Promise.resolve({ role: "assistant", content: "recovered from mcp error" });
      },
    };

    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    const result = await handleTurn({ sessionId: "test-session", userText: "hi", deps });

    expect(result).toBe("recovered from mcp error");
  });

  it("reaches iteration cap and returns cap message", async () => {
    const session = makeSession();
    const mcp = makeDefaultMcpClient({
      listTools: () => Promise.resolve([MOCK_GET_PRD_TOOL]),
      callTool: () => Promise.resolve({ content: "ok" }),
    });

    let callCount = 0;
    const llm: LlmClient = {
      chat: () => {
        callCount++;
        return Promise.resolve({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `call-${callCount}`,
              type: "function",
              function: { name: "get_prd", arguments: '{"session_id":"test-session"}' },
            },
          ],
        });
      },
    };

    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    const result = await handleTurn({ sessionId: "test-session", userText: "hi", deps });

    expect(result).toBe(
      "I hit a tool-call loop limit. Please rephrase your request or try a smaller step.",
    );
  });

  it("wall-clock cap returns wall-clock message", async () => {
    const session = makeSession();
    const mcp = makeDefaultMcpClient({
      listTools: () => Promise.resolve([MOCK_GET_PRD_TOOL]),
      callTool: () => Promise.resolve({ content: "ok" }),
    });

    let nowCallCount = 0;
    const llm: LlmClient = {
      chat: () => {
        return Promise.resolve({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `call-${nowCallCount}`,
              type: "function",
              function: { name: "get_prd", arguments: '{"session_id":"test-session"}' },
            },
          ],
        });
      },
    };

    const startMs = 1000;
    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    deps.now = () => {
      nowCallCount++;
      // First two calls (ts timestamp + wallStart) return start time.
      // Third call onward (loop wall-clock checks) returns beyond cap.
      if (nowCallCount <= 2) return new Date(startMs);
      return new Date(startMs + 300_001);
    };
    deps.config.wallClockMs = 300_000;

    const result = await handleTurn({ sessionId: "test-session", userText: "hi", deps });

    expect(result).toBe("I ran out of time on that turn. Please try again.");
  });
});
