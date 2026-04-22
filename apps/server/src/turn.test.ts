import { describe, it, expect } from "vitest";
import { handleTurn, SessionBusyError, SessionNotFoundError } from "./turn";
import type { LlmClient } from "./llm";
import { createSessionMutex } from "./mutex";
import { makeSession, makeLlmClient, makeDeps, stubChatStreaming, stubOrchestratorReply } from "./turn.test.helpers";

describe("handleTurn", () => {
  it("happy path returns assistant content", async () => {
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

    await handleTurn({ sessionId: "test-session", userText: "hello", deps });

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

    await handleTurn({ sessionId: "test-session", userText: "hello", deps });

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
});
