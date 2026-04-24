import { describe, it, expect } from "vitest";
import { handleTurn } from "./turn";
import type { LlmClient } from "./llm";
import { createSessionMutex } from "./mutex";
import {
  makeSession,
  makeDeps,
  makeDefaultMcpClient,
  makeStubSink,
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
          if (calls === 1) return Promise.resolve(stubOrchestratorReply(true));
          // plannerBig call — hangs until abort
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
    // plannerBig uses models.plannerBig.perCallTimeoutMs
    deps.config.models = {
      ...deps.config.models,
      plannerBig: { ...deps.config.models.plannerBig, perCallTimeoutMs: 50 },
    };

    const { sink, getFinalContent } = makeStubSink();
    await handleTurn({ sessionId: "test-session", userText: "hello", deps, sink });

    expect(getFinalContent()).toBe("The model took too long to respond. Please try again.");
  }, 5000);
});

describe("handleTurn — iteration cap", () => {
  it("reaches iteration cap and returns cap message", async () => {
    const session = makeSession();
    const mcp = makeDefaultMcpClient({
      listTools: () => Promise.resolve([MOCK_GET_PRD_TOOL]),
      callTool: () => Promise.resolve({ content: "ok" }),
    });

    // New pipeline: orchestrator(1) → plannerBig(2) → worker loops forever with tool calls
    let callCount = 0;
    const llm: LlmClient = {
      chat: () => {
        callCount++;
        if (callCount === 1) return Promise.resolve(stubOrchestratorReply(true));
        // plannerBig: return a task list
        if (callCount === 2) {
          return Promise.resolve({
            role: "assistant",
            content: JSON.stringify({ tasks: [{ sectionKey: "vision", instruction: "Write vision" }] }),
          });
        }
        // worker: keep calling get_prd indefinitely
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
    // worker iteration cap comes from models.worker.maxIterations
    deps.config.models = {
      ...deps.config.models,
      worker: { ...deps.config.models.worker, maxIterations: 6 },
    };
    const { sink, getFinalContent } = makeStubSink();
    await handleTurn({ sessionId: "test-session", userText: "hi", deps, sink });

    expect(getFinalContent()).toBe(
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
        if (llmCallCount === 1) return Promise.resolve(stubOrchestratorReply(true));
        // plannerBig: return a task list
        if (llmCallCount === 2) {
          return Promise.resolve({
            role: "assistant",
            content: JSON.stringify({ tasks: [{ sectionKey: "vision", instruction: "Write vision" }] }),
          });
        }
        // worker: keep calling get_prd
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
      // now() call sequence in the new pipeline before the worker loop wall-clock check:
      // (1) handleTurn: ts timestamp
      // (2) handleTurn: orchestrator thinking at:
      // (3) plannerBig: wallStart
      // (4) plannerBig: first thinking at: (before LLM)
      // (5) plannerBig: second thinking at: (after successful parse)
      // (6) runWorkerStage: wallStart — must be startMs so wall-clock check fires on call 8+
      // (7) runWorkerStage: worker thinking at:
      // (8) worker loop: wall-clock check → returns beyond cap → fires
      if (nowCallCount <= 6) return new Date(startMs);
      return new Date(startMs + 300_001);
    };
    deps.config.wallClockMs = 300_000;

    const { sink, getFinalContent } = makeStubSink();
    await handleTurn({ sessionId: "test-session", userText: "hi", deps, sink });

    expect(getFinalContent()).toBe("I ran out of time on that turn. Please try again.");
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

    const { sink } = makeStubSink();
    await handleTurn({ sessionId: "test-session", userText: "Build me a PRD", deps, sink });

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

    const { sink } = makeStubSink();
    await handleTurn({ sessionId: "test-session", userText: "Second message", deps, sink });

    expect(deps.store.persistUserCalls[0]?.title).toBe("Already set");
  });
});
