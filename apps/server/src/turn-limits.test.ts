import { describe, it, expect } from "vitest";
import { handleTurn } from "./turn";
import type { LlmClient } from "./llm";
import { createSessionMutex } from "./mutex";
import {
  makeSession,
  makeDeps,
  makeDefaultMcpClient,
  MOCK_GET_PRD_TOOL,
  stubChatStreaming,
  stubOrchestratorReply,
} from "./turn.test.helpers";

describe("handleTurn — per-call timeout", () => {
  it("returns per-call timeout message when signal aborts", async () => {
    const session = makeSession();
    let calls = 0;
    const deps = makeDeps(
      session,
      {
        chat: ({ signal }) => {
          calls++;
          if (calls === 1) return Promise.resolve(stubOrchestratorReply(false));
          return new Promise((_resolve, reject) => {
            if (signal?.aborted) {
              reject(signal.reason);
              return;
            }
            signal?.addEventListener("abort", () => reject(signal.reason));
          });
        },
        chatStreaming: stubChatStreaming,
      },
      createSessionMutex(),
    );
    deps.config.perCallTimeoutMs = 50;

    const result = await handleTurn({ sessionId: "test-session", userText: "hello", deps });

    expect(result).toBe("The model took too long to respond. Please try again.");
  }, 5000);
});

describe("handleTurn — iteration cap", () => {
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
        if (callCount === 1) return Promise.resolve(stubOrchestratorReply(false));
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
      chatStreaming: stubChatStreaming,
    };

    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    const result = await handleTurn({ sessionId: "test-session", userText: "hi", deps });

    expect(result).toBe(
      "I hit a tool-call loop limit. Please rephrase your request or try a smaller step.",
    );
  });
});

describe("handleTurn — wall-clock timeout", () => {
  it("wall-clock cap returns wall-clock message", async () => {
    const session = makeSession();
    const mcp = makeDefaultMcpClient({
      listTools: () => Promise.resolve([MOCK_GET_PRD_TOOL]),
      callTool: () => Promise.resolve({ content: "ok" }),
    });

    let nowCallCount = 0;
    let llmCallCount = 0;
    const llm: LlmClient = {
      chat: () => {
        llmCallCount++;
        if (llmCallCount === 1) return Promise.resolve(stubOrchestratorReply(false));
        return Promise.resolve({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `call-${llmCallCount}`,
              type: "function",
              function: { name: "get_prd", arguments: '{"session_id":"test-session"}' },
            },
          ],
        });
      },
      chatStreaming: stubChatStreaming,
    };

    const startMs = 1000;
    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    deps.now = () => {
      nowCallCount++;
      // Calls: (1) ts timestamp, (2) thinking event at:, (3) wallStart — all return start time.
      // Fourth call onward (loop wall-clock checks) returns beyond cap.
      if (nowCallCount <= 3) return new Date(startMs);
      return new Date(startMs + 300_001);
    };
    deps.config.wallClockMs = 300_000;

    const result = await handleTurn({ sessionId: "test-session", userText: "hi", deps });

    expect(result).toBe("I ran out of time on that turn. Please try again.");
  });
});

describe("handleTurn — title derivation", () => {
  it("derives title from first user message", async () => {
    const session = makeSession();
    let calls = 0;
    const deps = makeDeps(session, {
      chat: () => {
        calls++;
        if (calls === 1) return Promise.resolve(stubOrchestratorReply(false));
        return Promise.resolve({ role: "assistant", content: "ok" });
      },
      chatStreaming: stubChatStreaming,
    });

    await handleTurn({ sessionId: "test-session", userText: "Build me a PRD", deps });

    expect(deps.store.persistUserCalls[0]?.title).toBe("Build me a PRD");
  });

  it("does not overwrite title on second message", async () => {
    const session = makeSession({ title: "Already set" });
    let calls = 0;
    const deps = makeDeps(session, {
      chat: () => {
        calls++;
        if (calls === 1) return Promise.resolve(stubOrchestratorReply(false));
        return Promise.resolve({ role: "assistant", content: "ok" });
      },
      chatStreaming: stubChatStreaming,
    });

    await handleTurn({ sessionId: "test-session", userText: "Second message", deps });

    expect(deps.store.persistUserCalls[0]?.title).toBe("Already set");
  });
});
