import { describe, it, expect, vi } from "vitest";
import { handleTurn } from "./turn";
import type { LlmClient } from "./llm";
import { createSessionMutex } from "./mutex";
import {
  makeSession,
  makeDeps,
  makeDefaultMcpClient,
  makeStubSink,
  MOCK_UPDATE_SECTION_TOOL,
  stubChatStreaming,
  stubOrchestratorReply,
} from "./turn.test.helpers";

describe("handleTurn — summary hook", () => {
  it("writes summary when update_section succeeds", async () => {
    const session = makeSession();

    // New pipeline: orchestrator(1) → plannerBig(2) → worker update_section(3) → worker done(4)
    // → interviewerSmall(5) → summary agent(6)
    let callCount = 0;
    const llm: LlmClient = {
      chat: () => {
        callCount++;
        if (callCount === 1) return Promise.resolve(stubOrchestratorReply(true));
        // plannerBig: return task list
        if (callCount === 2) {
          return Promise.resolve({
            role: "assistant",
            content: JSON.stringify({ tasks: [{ sectionKey: "vision", instruction: "Write vision from user input" }] }),
          });
        }
        // worker: call update_section
        if (callCount === 3) {
          return Promise.resolve({
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "update_section",
                  arguments: '{"session_id":"test-session","key":"vision","content":"A vision"}',
                },
              },
            ],
          });
        }
        // worker: done
        if (callCount === 4) {
          return Promise.resolve({ role: "assistant", content: null });
        }
        // interviewerSmall
        if (callCount === 5) {
          return Promise.resolve({ role: "assistant", content: "Done! Vision updated." });
        }
        // summary agent
        return Promise.resolve({ role: "assistant", content: "new summary" });
      },
      chatStreaming: stubChatStreaming,
    };

    const mcp = makeDefaultMcpClient({
      listTools: () => Promise.resolve([MOCK_UPDATE_SECTION_TOOL]),
      callTool: () => Promise.resolve({ key: "vision", content: "A vision", status: "draft", updatedAt: "2026-01-01T00:00:00Z" }),
    });

    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    const { sink, getFinalContent } = makeStubSink();
    await handleTurn({ sessionId: "test-session", userText: "Set vision", deps, sink });

    expect(getFinalContent()).toBe("Done! Vision updated.");
    expect(deps.store.persistSummaryCalls).toHaveLength(1);
    expect(deps.store.persistSummaryCalls[0]).toEqual({
      sessionId: "test-session",
      summary: "new summary",
    });
    expect(deps.store.persistAssistantCalls).toHaveLength(1);
  });

  it("does not write summary when turn has no tool calls", async () => {
    const session = makeSession();
    let calls = 0;
    const llm: LlmClient = {
      chat: () => {
        calls++;
        if (calls === 1) return Promise.resolve(stubOrchestratorReply(false));
        return Promise.resolve({ role: "assistant", content: "Just chatting." });
      },
      chatStreaming: stubChatStreaming,
    };

    const deps = makeDeps(session, llm);
    const { sink, getFinalContent } = makeStubSink();
    await handleTurn({ sessionId: "test-session", userText: "Hello", deps, sink });

    expect(getFinalContent()).toBe("Just chatting.");
    expect(deps.store.persistSummaryCalls).toHaveLength(0);
    expect(deps.store.persistAssistantCalls).toHaveLength(1);
  });

  it("does not write summary when the PRD-mutating tool call fails", async () => {
    const session = makeSession();

    // New pipeline: orchestrator → plannerBig → worker (update_section returns error) → worker done → interviewerSmall
    let callCount = 0;
    const llm: LlmClient = {
      chat: () => {
        callCount++;
        if (callCount === 1) return Promise.resolve(stubOrchestratorReply(true));
        // plannerBig
        if (callCount === 2) {
          return Promise.resolve({
            role: "assistant",
            content: JSON.stringify({ tasks: [{ sectionKey: "vision", instruction: "Write vision" }] }),
          });
        }
        // worker: call update_section (will return error)
        if (callCount === 3) {
          return Promise.resolve({
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "update_section",
                  arguments: '{"session_id":"test-session","key":"vision","content":"A vision"}',
                },
              },
            ],
          });
        }
        // worker: done
        if (callCount === 4) {
          return Promise.resolve({ role: "assistant", content: null });
        }
        // interviewerSmall
        return Promise.resolve({ role: "assistant", content: "I could not update that section." });
      },
      chatStreaming: stubChatStreaming,
    };

    const mcp = makeDefaultMcpClient({
      listTools: () => Promise.resolve([MOCK_UPDATE_SECTION_TOOL]),
      callTool: () => Promise.resolve({ error: "content_too_long", max: 10000, got: 99999 }),
    });

    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    const { sink, getFinalContent } = makeStubSink();
    await handleTurn({ sessionId: "test-session", userText: "Set vision", deps, sink });

    expect(getFinalContent()).toBe("I could not update that section.");
    expect(deps.store.persistSummaryCalls).toHaveLength(0);
  });

  it("writes summary when mark_confirmed succeeds", async () => {
    const session = makeSession();

    // New pipeline: orchestrator(1) → plannerBig(2) → worker mark_confirmed(3) → worker done(4)
    // → interviewerSmall(5) → summary agent(6)
    let callCount = 0;
    const llm: LlmClient = {
      chat: () => {
        callCount++;
        if (callCount === 1) return Promise.resolve(stubOrchestratorReply(true));
        // plannerBig
        if (callCount === 2) {
          return Promise.resolve({
            role: "assistant",
            content: JSON.stringify({ tasks: [{ sectionKey: "vision", instruction: "Confirm vision" }] }),
          });
        }
        // worker: call mark_confirmed
        if (callCount === 3) {
          return Promise.resolve({
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "mark_confirmed",
                  arguments: '{"session_id":"test-session","key":"vision"}',
                },
              },
            ],
          });
        }
        // worker: done
        if (callCount === 4) {
          return Promise.resolve({ role: "assistant", content: null });
        }
        // interviewerSmall
        if (callCount === 5) {
          return Promise.resolve({ role: "assistant", content: "Vision confirmed." });
        }
        // summary agent
        return Promise.resolve({ role: "assistant", content: "confirmed summary" });
      },
      chatStreaming: stubChatStreaming,
    };

    const mcp = makeDefaultMcpClient({
      listTools: () =>
        Promise.resolve([{ ...MOCK_UPDATE_SECTION_TOOL, name: "mark_confirmed" }]),
      callTool: () =>
        Promise.resolve({ key: "vision", content: "A vision", status: "confirmed", updatedAt: "2026-01-01T00:00:00Z" }),
    });

    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    const { sink, getFinalContent } = makeStubSink();
    await handleTurn({ sessionId: "test-session", userText: "Confirm vision", deps, sink });

    expect(getFinalContent()).toBe("Vision confirmed.");
    expect(deps.store.persistSummaryCalls).toHaveLength(1);
    expect(deps.store.persistSummaryCalls[0]).toEqual({
      sessionId: "test-session",
      summary: "confirmed summary",
    });
  });

  it("turn still returns final event when summary agent throws", async () => {
    const session = makeSession();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // New pipeline: orchestrator(1) → plannerBig(2) → worker update_section(3) → worker done(4)
    // → interviewerSmall(5) → summary agent(6) — throws
    let callCount = 0;
    const llm: LlmClient = {
      chat: () => {
        callCount++;
        if (callCount === 1) return Promise.resolve(stubOrchestratorReply(true));
        // plannerBig
        if (callCount === 2) {
          return Promise.resolve({
            role: "assistant",
            content: JSON.stringify({ tasks: [{ sectionKey: "vision", instruction: "Write vision" }] }),
          });
        }
        // worker: call update_section
        if (callCount === 3) {
          return Promise.resolve({
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "update_section",
                  arguments: '{"session_id":"test-session","key":"vision","content":"A vision"}',
                },
              },
            ],
          });
        }
        // worker: done
        if (callCount === 4) {
          return Promise.resolve({ role: "assistant", content: null });
        }
        // interviewerSmall
        if (callCount === 5) {
          return Promise.resolve({ role: "assistant", content: "PRD updated." });
        }
        // summary agent — throw
        return Promise.reject(new Error("boom"));
      },
      chatStreaming: stubChatStreaming,
    };

    const mcp = makeDefaultMcpClient({
      listTools: () => Promise.resolve([MOCK_UPDATE_SECTION_TOOL]),
      callTool: () => Promise.resolve({ key: "vision", content: "A vision", status: "draft", updatedAt: "2026-01-01T00:00:00Z" }),
    });

    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    const { sink, getFinalContent } = makeStubSink();
    await handleTurn({ sessionId: "test-session", userText: "Set vision", deps, sink });

    expect(getFinalContent()).toBe("PRD updated.");
    expect(deps.store.persistAssistantCalls).toHaveLength(1);
    expect(deps.store.persistSummaryCalls).toHaveLength(0);

    const errorCalls = consoleSpy.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].startsWith("summary regen failed:"),
    );
    expect(errorCalls.length).toBeGreaterThanOrEqual(1);

    consoleSpy.mockRestore();
  });
});
