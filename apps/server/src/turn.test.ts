import { describe, it, expect } from "vitest";
import { handleTurn, SessionBusyError, SessionNotFoundError } from "./turn";
import type { LlmClient } from "./llm";
import { createSessionMutex } from "./mutex";
import { makeSession, makeLlmClient, makeDeps, makeStubSink, stubChatStreaming, stubOrchestratorReply } from "./turn.test.helpers";

describe("handleTurn", () => {
  it("happy path emits final event with assistant content", async () => {
    const session = makeSession();
    let calls = 0;
    const llm: LlmClient = {
      chat: () => {
        calls++;
        if (calls === 1) return Promise.resolve(stubOrchestratorReply(false));
        return Promise.resolve({ role: "assistant", content: "Hello from assistant" });
      },
      chatStreaming: stubChatStreaming,
    };
    const deps = makeDeps(session, llm);
    const { sink, getFinalContent } = makeStubSink();

    await handleTurn({
      sessionId: "test-session",
      userText: "hi",
      deps,
      sink,
    });

    expect(getFinalContent()).toBe("Hello from assistant");
  });

  it("persists user message before calling llm", async () => {
    const session = makeSession();
    let userPersistedBeforeLlm = false;
    let calls = 0;
    const llm: LlmClient = {
      chat: () => {
        calls++;
        userPersistedBeforeLlm = deps.store.persistUserCalls.length > 0;
        if (calls === 1) return Promise.resolve(stubOrchestratorReply(false));
        return Promise.resolve({ role: "assistant", content: "ok" });
      },
      chatStreaming: stubChatStreaming,
    };
    const deps = makeDeps(session, llm);
    const { sink } = makeStubSink();

    await handleTurn({ sessionId: "test-session", userText: "hello", deps, sink });

    expect(userPersistedBeforeLlm).toBe(true);
  });

  it("persists user message even when LLM throws", async () => {
    const session = makeSession();
    let calls = 0;
    const llm: LlmClient = {
      chat: () => {
        calls++;
        if (calls === 1) return Promise.resolve(stubOrchestratorReply(false));
        return Promise.reject(new Error("LLM exploded"));
      },
      chatStreaming: stubChatStreaming,
    };
    const deps = makeDeps(session, llm);
    const { sink } = makeStubSink();

    await handleTurn({ sessionId: "test-session", userText: "hello", deps, sink });

    expect(deps.store.persistUserCalls.length).toBe(1);
    expect(deps.store.persistAssistantCalls.length).toBe(1);
    expect(deps.store.persistAssistantCalls[0]?.messages.at(-1)?.role).toBe("assistant");
  });

  it("mutex is held during the turn and released after", async () => {
    const session = makeSession();
    const mutex = createSessionMutex();
    let heldDuringTurn = false;
    let calls = 0;
    const llm: LlmClient = {
      chat: () => {
        calls++;
        heldDuringTurn = !mutex.tryAcquire("test-session");
        if (!heldDuringTurn) mutex.release("test-session");
        if (calls === 1) return Promise.resolve(stubOrchestratorReply(false));
        return Promise.resolve({ role: "assistant", content: "ok" });
      },
      chatStreaming: stubChatStreaming,
    };
    const deps = makeDeps(session, llm, mutex);
    const { sink } = makeStubSink();

    await handleTurn({ sessionId: "test-session", userText: "hello", deps, sink });

    expect(heldDuringTurn).toBe(true);
    expect(mutex.tryAcquire("test-session")).toBe(true);
  });

  it("throws SessionBusyError when mutex is already held", async () => {
    const session = makeSession();
    const mutex = createSessionMutex();
    mutex.tryAcquire("test-session");

    const deps = makeDeps(session, makeLlmClient("ok"), mutex);
    const { sink } = makeStubSink();

    await expect(
      handleTurn({ sessionId: "test-session", userText: "hello", deps, sink }),
    ).rejects.toThrow(SessionBusyError);
  });

  it("throws SessionNotFoundError for unknown session", async () => {
    const deps = makeDeps(null, makeLlmClient("ok"));
    const { sink } = makeStubSink();

    await expect(
      handleTurn({ sessionId: "test-session", userText: "hello", deps, sink }),
    ).rejects.toThrow(SessionNotFoundError);
  });
});
