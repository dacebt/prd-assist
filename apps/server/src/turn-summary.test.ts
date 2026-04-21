import { describe, it, expect, vi } from "vitest";
import { handleTurn } from "./turn";
import type { LlmClient } from "./llm";
import { createSessionMutex } from "./mutex";
import {
  makeSession,
  makeDeps,
  makeDefaultMcpClient,
  MOCK_UPDATE_SECTION_TOOL,
  stubChatStreaming,
} from "./turn.test.helpers";

describe("handleTurn — summary hook", () => {
  it("writes summary when update_section succeeds", async () => {
    const session = makeSession();

    // Supervisor: call 1 → update_section tool call, call 2 → final text
    // Summary agent: call 3 → returns "new summary"
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
                function: {
                  name: "update_section",
                  arguments: '{"session_id":"test-session","key":"vision","content":"A vision"}',
                },
              },
            ],
          });
        }
        if (callCount === 2) {
          return Promise.resolve({ role: "assistant", content: "Done! Vision updated." });
        }
        // call 3: summary agent
        return Promise.resolve({ role: "assistant", content: "new summary" });
      },
      chatStreaming: stubChatStreaming,
    };

    const mcp = makeDefaultMcpClient({
      listTools: () => Promise.resolve([MOCK_UPDATE_SECTION_TOOL]),
      // update_section returns a non-error object (simulating Section shape)
      callTool: () => Promise.resolve({ key: "vision", content: "A vision", status: "draft", updatedAt: "2026-01-01T00:00:00Z" }),
    });

    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    const result = await handleTurn({ sessionId: "test-session", userText: "Set vision", deps });

    expect(result).toBe("Done! Vision updated.");
    expect(deps.store.persistSummaryCalls).toHaveLength(1);
    expect(deps.store.persistSummaryCalls[0]).toEqual({
      sessionId: "test-session",
      summary: "new summary",
    });
    expect(deps.store.persistAssistantCalls).toHaveLength(1);
  });

  it("does not write summary when turn has no tool calls", async () => {
    const session = makeSession();
    const llm: LlmClient = {
      chat: () => Promise.resolve({ role: "assistant", content: "Just chatting." }),
      chatStreaming: stubChatStreaming,
    };

    const deps = makeDeps(session, llm);
    const result = await handleTurn({ sessionId: "test-session", userText: "Hello", deps });

    expect(result).toBe("Just chatting.");
    expect(deps.store.persistSummaryCalls).toHaveLength(0);
    expect(deps.store.persistAssistantCalls).toHaveLength(1);
  });

  it("does not write summary when the PRD-mutating tool call fails", async () => {
    const session = makeSession();

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
                function: {
                  name: "update_section",
                  arguments: '{"session_id":"test-session","key":"vision","content":"A vision"}',
                },
              },
            ],
          });
        }
        return Promise.resolve({ role: "assistant", content: "I could not update that section." });
      },
      chatStreaming: stubChatStreaming,
    };

    const mcp = makeDefaultMcpClient({
      listTools: () => Promise.resolve([MOCK_UPDATE_SECTION_TOOL]),
      callTool: () => Promise.resolve({ error: "content_too_long", max: 10000, got: 99999 }),
    });

    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    const result = await handleTurn({ sessionId: "test-session", userText: "Set vision", deps });

    expect(result).toBe("I could not update that section.");
    expect(deps.store.persistSummaryCalls).toHaveLength(0);
  });

  it("writes summary when mark_confirmed succeeds", async () => {
    const session = makeSession();

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
                function: {
                  name: "mark_confirmed",
                  arguments: '{"session_id":"test-session","key":"vision"}',
                },
              },
            ],
          });
        }
        if (callCount === 2) {
          return Promise.resolve({ role: "assistant", content: "Vision confirmed." });
        }
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
    const result = await handleTurn({ sessionId: "test-session", userText: "Confirm vision", deps });

    expect(result).toBe("Vision confirmed.");
    expect(deps.store.persistSummaryCalls).toHaveLength(1);
    expect(deps.store.persistSummaryCalls[0]).toEqual({
      sessionId: "test-session",
      summary: "confirmed summary",
    });
  });

  it("turn still returns reply when summary agent throws", async () => {
    const session = makeSession();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

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
                function: {
                  name: "update_section",
                  arguments: '{"session_id":"test-session","key":"vision","content":"A vision"}',
                },
              },
            ],
          });
        }
        if (callCount === 2) {
          return Promise.resolve({ role: "assistant", content: "PRD updated." });
        }
        // call 3: summary agent — throw
        return Promise.reject(new Error("boom"));
      },
      chatStreaming: stubChatStreaming,
    };

    const mcp = makeDefaultMcpClient({
      listTools: () => Promise.resolve([MOCK_UPDATE_SECTION_TOOL]),
      callTool: () => Promise.resolve({ key: "vision", content: "A vision", status: "draft", updatedAt: "2026-01-01T00:00:00Z" }),
    });

    const deps = makeDeps(session, llm, createSessionMutex(), mcp);
    const result = await handleTurn({ sessionId: "test-session", userText: "Set vision", deps });

    expect(result).toBe("PRD updated.");
    expect(deps.store.persistAssistantCalls).toHaveLength(1);
    expect(deps.store.persistSummaryCalls).toHaveLength(0);

    const errorCalls = consoleSpy.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].startsWith("summary regen failed:"),
    );
    expect(errorCalls.length).toBeGreaterThanOrEqual(1);

    consoleSpy.mockRestore();
  });
});
