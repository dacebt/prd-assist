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
});
