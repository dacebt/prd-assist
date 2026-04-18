import { describe, it, expect, vi } from "vitest";
import { handleTurn, SessionBusyError, SessionNotFoundError, type TurnDeps } from "./turn.js";
import type { LlmClient, AssistantMessage } from "./llm.js";
import type { SessionStore } from "./sessions.js";
import type { SessionMutex } from "./mutex.js";
import type { Session } from "../shared/types.js";
import { createSessionMutex } from "./mutex.js";

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
    chat: async () => {
      if (typeof reply === "string") {
        return { role: "assistant", content: reply };
      }
      return reply();
    },
  };
}

function makeDeps(
  session: Session | null,
  llm: LlmClient,
  mutex: SessionMutex = createSessionMutex(),
): TurnDeps & { store: ReturnType<typeof makeStore> } {
  const store = makeStore(session);
  return {
    store,
    llm,
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
});
