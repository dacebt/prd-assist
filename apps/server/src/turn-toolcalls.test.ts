import { describe, it, expect, vi } from "vitest";
import { handleTurn } from "./turn";
import type { LlmClient } from "./llm";
import { createSessionMutex } from "./mutex";
import {
  makeSession,
  makeDeps,
  makeDefaultMcpClient,
  makeStubSink,
  MOCK_GET_PRD_TOOL,
  MOCK_UPDATE_SECTION_TOOL,
  stubChatStreaming,
  stubOrchestratorReply,
} from "./turn.test.helpers";

describe("handleTurn — tool dispatch", () => {
  it("happy path with tool calls: get_prd then update_section then final text", async () => {
    const session = makeSession();
    const callToolSpy = vi.fn().mockResolvedValue({ content: "mocked prd" });

    const mcp = makeDefaultMcpClient({
      listTools: () => Promise.resolve([MOCK_GET_PRD_TOOL, MOCK_UPDATE_SECTION_TOOL]),
      callTool: callToolSpy,
    });

    // New pipeline: orchestrator → plannerBig → worker (get_prd, update_section, done) → interviewerSmall
    let callCount = 0;
    const llm: LlmClient = {
      chat: () => {
        callCount++;
        if (callCount === 1) return Promise.resolve(stubOrchestratorReply(true));
        // plannerBig: return a task list with one task
        if (callCount === 2) {
          return Promise.resolve({
            role: "assistant",
            content: JSON.stringify({ tasks: [{ sectionKey: "vision", instruction: "Write vision from user input" }] }),
          });
        }
        // worker: call get_prd
        if (callCount === 3) {
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
        // worker: call update_section
        if (callCount === 4) {
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
        // worker: done (no tool calls, no content)
        if (callCount === 5) {
          return Promise.resolve({ role: "assistant", content: null });
        }
        // plannerVerify: confirm the vision edit
        if (callCount === 6) {
          return Promise.resolve({
            role: "assistant",
            content: JSON.stringify({ confirmed: ["vision"], failed: [] }),
          });
        }
        // interviewerSmall: final reply
        return Promise.resolve({ role: "assistant", content: "Done! Vision updated." });
      },
      chatStreaming: stubChatStreaming,
    };

    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    const { sink, getFinalContent } = makeStubSink();
    await handleTurn({ sessionId: "test-session", userText: "Set vision", deps, sink });

    expect(getFinalContent()).toBe("Done! Vision updated.");
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

    // New pipeline: orchestrator → plannerBig → worker (bad args → recovered) → interviewerSmall
    let callCount = 0;
    const llm: LlmClient = {
      chat: () => {
        callCount++;
        if (callCount === 1) return Promise.resolve(stubOrchestratorReply(true));
        // plannerBig: return task list
        if (callCount === 2) {
          return Promise.resolve({
            role: "assistant",
            content: JSON.stringify({ tasks: [{ sectionKey: "vision", instruction: "Write vision" }] }),
          });
        }
        // worker: bad tool args
        if (callCount === 3) {
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
        // worker: done after receiving error result
        if (callCount === 4) {
          return Promise.resolve({ role: "assistant", content: null });
        }
        // interviewerSmall
        return Promise.resolve({ role: "assistant", content: "recovered" });
      },
      chatStreaming: stubChatStreaming,
    };

    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    const { sink, getFinalContent } = makeStubSink();
    await handleTurn({ sessionId: "test-session", userText: "hi", deps, sink });

    expect(getFinalContent()).toBe("recovered");
  });

  it("handles unknown tool name from model", async () => {
    const session = makeSession();
    const mcp = makeDefaultMcpClient({
      listTools: () => Promise.resolve([MOCK_GET_PRD_TOOL]),
    });

    // New pipeline: orchestrator → plannerBig → worker (unknown tool → done) → interviewerSmall
    let callCount = 0;
    const llm: LlmClient = {
      chat: () => {
        callCount++;
        if (callCount === 1) return Promise.resolve(stubOrchestratorReply(true));
        // plannerBig: return task list
        if (callCount === 2) {
          return Promise.resolve({
            role: "assistant",
            content: JSON.stringify({ tasks: [{ sectionKey: "vision", instruction: "Write vision" }] }),
          });
        }
        // worker: unknown tool
        if (callCount === 3) {
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
        // worker: done after receiving error result
        if (callCount === 4) {
          return Promise.resolve({ role: "assistant", content: null });
        }
        // interviewerSmall
        return Promise.resolve({ role: "assistant", content: "recovered from unknown tool" });
      },
      chatStreaming: stubChatStreaming,
    };

    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    const { sink, getFinalContent } = makeStubSink();
    await handleTurn({ sessionId: "test-session", userText: "hi", deps, sink });

    expect(getFinalContent()).toBe("recovered from unknown tool");
  });

  it("handles MCP callTool throwing", async () => {
    const session = makeSession();
    const mcp = makeDefaultMcpClient({
      listTools: () => Promise.resolve([MOCK_GET_PRD_TOOL]),
      callTool: () => Promise.reject(new Error("MCP connection failed")),
    });

    // New pipeline: orchestrator → plannerBig → worker (MCP throws → done) → interviewerSmall
    let callCount = 0;
    const llm: LlmClient = {
      chat: () => {
        callCount++;
        if (callCount === 1) return Promise.resolve(stubOrchestratorReply(true));
        // plannerBig: return task list
        if (callCount === 2) {
          return Promise.resolve({
            role: "assistant",
            content: JSON.stringify({ tasks: [{ sectionKey: "vision", instruction: "Write vision" }] }),
          });
        }
        // worker: call get_prd (MCP will throw)
        if (callCount === 3) {
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
        // worker: done after receiving error result
        if (callCount === 4) {
          return Promise.resolve({ role: "assistant", content: null });
        }
        // interviewerSmall
        return Promise.resolve({ role: "assistant", content: "recovered from mcp error" });
      },
      chatStreaming: stubChatStreaming,
    };

    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    const { sink, getFinalContent } = makeStubSink();
    await handleTurn({ sessionId: "test-session", userText: "hi", deps, sink });

    expect(getFinalContent()).toBe("recovered from mcp error");
  });

  it("2-task planner: both workers run and both update_section calls fire", async () => {
    const session = makeSession();
    const callToolSpy = vi.fn().mockResolvedValue({ content: "mocked prd" });

    const mcp = makeDefaultMcpClient({
      listTools: () => Promise.resolve([MOCK_GET_PRD_TOOL, MOCK_UPDATE_SECTION_TOOL]),
      callTool: callToolSpy,
    });

    // orchestrator(1) → plannerBig(2) →
    //   workerA: update_section vision(3), done(4) →
    //   workerB: update_section targetUsers(5), done(6) →
    //   interviewerSmall(7)
    let callCount = 0;
    const llm: LlmClient = {
      chat: () => {
        callCount++;
        if (callCount === 1) return Promise.resolve(stubOrchestratorReply(true));
        // plannerBig: two tasks
        if (callCount === 2) {
          return Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
              tasks: [
                { sectionKey: "vision", instruction: "Write vision" },
                { sectionKey: "targetUsers", instruction: "Describe target users" },
              ],
            }),
          });
        }
        // workerA: call update_section vision
        if (callCount === 3) {
          return Promise.resolve({
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-a",
                type: "function",
                function: {
                  name: "update_section",
                  arguments: '{"session_id":"test-session","key":"vision","content":"Vision text"}',
                },
              },
            ],
          });
        }
        // workerA: done
        if (callCount === 4) {
          return Promise.resolve({ role: "assistant", content: null });
        }
        // workerB: call update_section targetUsers
        if (callCount === 5) {
          return Promise.resolve({
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-b",
                type: "function",
                function: {
                  name: "update_section",
                  arguments: '{"session_id":"test-session","key":"targetUsers","content":"Users text"}',
                },
              },
            ],
          });
        }
        // workerB: done
        if (callCount === 6) {
          return Promise.resolve({ role: "assistant", content: null });
        }
        // plannerVerify: confirm both edits
        if (callCount === 7) {
          return Promise.resolve({
            role: "assistant",
            content: JSON.stringify({ confirmed: ["vision", "targetUsers"], failed: [] }),
          });
        }
        // interviewerSmall
        return Promise.resolve({ role: "assistant", content: "Both sections updated." });
      },
      chatStreaming: stubChatStreaming,
    };

    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    const { sink, getFinalContent } = makeStubSink();
    await handleTurn({ sessionId: "test-session", userText: "Set vision and users", deps, sink });

    expect(getFinalContent()).toBe("Both sections updated.");
    expect(callToolSpy).toHaveBeenCalledTimes(2);
    expect(callToolSpy).toHaveBeenNthCalledWith(1, "update_section", {
      session_id: "test-session",
      key: "vision",
      content: "Vision text",
    });
    expect(callToolSpy).toHaveBeenNthCalledWith(2, "update_section", {
      session_id: "test-session",
      key: "targetUsers",
      content: "Users text",
    });
  });

  it("verify fail-closed: malformed verify JSON → interviewerSmall still runs with worker-derived tasks", async () => {
    const session = makeSession();
    const callToolSpy = vi.fn().mockResolvedValue({
      key: "vision",
      content: "A vision",
      status: "draft",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const mcp = makeDefaultMcpClient({
      listTools: () => Promise.resolve([MOCK_UPDATE_SECTION_TOOL]),
      callTool: callToolSpy,
    });

    // orchestrator(1) → plannerBig(2) → worker update_section(3) → worker done(4)
    // → plannerVerify returns malformed JSON(5) → interviewerSmall(6)
    let callCount = 0;
    const llm: LlmClient = {
      chat: () => {
        callCount++;
        if (callCount === 1) return Promise.resolve(stubOrchestratorReply(true));
        if (callCount === 2) {
          return Promise.resolve({
            role: "assistant",
            content: JSON.stringify({ tasks: [{ sectionKey: "vision", instruction: "Write vision" }] }),
          });
        }
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
        if (callCount === 4) {
          return Promise.resolve({ role: "assistant", content: null });
        }
        // plannerVerify: first attempt returns malformed JSON
        if (callCount === 5) {
          return Promise.resolve({ role: "assistant", content: "not json at all" });
        }
        // plannerVerify: retry also returns malformed JSON → fail-closed
        if (callCount === 6) {
          return Promise.resolve({ role: "assistant", content: "{ also bad" });
        }
        // interviewerSmall: should still run with the worker-derived task (vision)
        return Promise.resolve({ role: "assistant", content: "fallback reply" });
      },
      chatStreaming: stubChatStreaming,
    };

    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    const { sink, getFinalContent } = makeStubSink();
    await handleTurn({ sessionId: "test-session", userText: "Set vision", deps, sink });

    // interviewerSmall ran and produced the final reply
    expect(getFinalContent()).toBe("fallback reply");
    // prd was touched by the worker
    expect(callToolSpy).toHaveBeenCalledTimes(1);
  });

  it("verify rejects task: verify confirms nothing → interviewerSmall hears failedTasks, not executedTasks", async () => {
    const session = makeSession();
    const callToolSpy = vi.fn().mockResolvedValue({
      key: "vision",
      content: "A vision",
      status: "draft",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const mcp = makeDefaultMcpClient({
      listTools: () => Promise.resolve([MOCK_UPDATE_SECTION_TOOL]),
      callTool: callToolSpy,
    });

    // orchestrator(1) → plannerBig(2) → worker update_section(3) → worker done(4)
    // → plannerVerify confirms nothing, fails vision(5) → interviewerSmall(6)
    let callCount = 0;
    let interviewerSmallMessages: unknown[] | null = null;
    const llm: LlmClient = {
      chat: (args) => {
        callCount++;
        if (callCount === 1) return Promise.resolve(stubOrchestratorReply(true));
        if (callCount === 2) {
          return Promise.resolve({
            role: "assistant",
            content: JSON.stringify({ tasks: [{ sectionKey: "vision", instruction: "Write vision" }] }),
          });
        }
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
        if (callCount === 4) {
          return Promise.resolve({ role: "assistant", content: null });
        }
        // plannerVerify: confirms nothing, vision failed
        if (callCount === 5) {
          return Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
              confirmed: [],
              failed: [{ sectionKey: "vision", reason: "content empty" }],
            }),
          });
        }
        // interviewerSmall: capture the messages passed to it
        if (callCount === 6) {
          interviewerSmallMessages = args.messages;
          return Promise.resolve({ role: "assistant", content: "I could not update the vision — please clarify." });
        }
        // summary agent (prdTouched=true because worker mutated the PRD)
        return Promise.resolve({ role: "assistant", content: "summary after failed verify" });
      },
      chatStreaming: stubChatStreaming,
    };

    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    const { sink, getFinalContent } = makeStubSink();
    await handleTurn({ sessionId: "test-session", userText: "Set vision", deps, sink });

    expect(getFinalContent()).toBe("I could not update the vision — please clarify.");
    // The interviewerSmall system message should mention the failed edit, not a confirmed edit
    const systemMsg = interviewerSmallMessages?.[0] as { role: string; content: string } | undefined;
    expect(systemMsg?.content).toContain("Failed edits this turn:");
    expect(systemMsg?.content).toContain("vision");
    expect(systemMsg?.content).not.toContain("Edited sections this turn:");
  });
});
