import { describe, it, expect, vi } from "vitest";
import { handleTurn } from "./turn";
import type { LlmClient } from "./llm";
import { createSessionMutex } from "./mutex";
import {
  makeSession,
  makeDeps,
  makeDefaultMcpClient,
  MOCK_GET_PRD_TOOL,
  MOCK_UPDATE_SECTION_TOOL,
} from "./turn.test.helpers";

describe("handleTurn — tool dispatch", () => {
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
});
