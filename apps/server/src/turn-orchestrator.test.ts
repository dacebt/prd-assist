import { describe, it, expect, vi, afterEach } from "vitest";
import { handleTurn } from "./turn";
import type { LlmClient } from "./llm";
import {
  makeSession,
  makeDeps,
  makeStubSink,
  stubChatStreaming,
  stubOrchestratorReply,
} from "./turn.test.helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handleTurn — orchestrator thinking event", () => {
  it("emits exactly one orchestrator thinking event per turn", async () => {
    let calls = 0;
    const llm: LlmClient = {
      chat: (_args) => {
        calls++;
        if (calls === 1) return Promise.resolve(stubOrchestratorReply(false));
        return Promise.resolve({ role: "assistant", content: "Hello from assistant" });
      },
      chatStreaming: stubChatStreaming,
    };

    const session = makeSession();
    const deps = makeDeps(session, llm);
    const { sink, events } = makeStubSink();

    await handleTurn({ sessionId: "test-session", userText: "hi", deps, sink });

    const orchestratorThinkingEvents = events.filter(
      (e) => e.kind === "thinking" && e.agentRole === "orchestrator",
    );

    expect(orchestratorThinkingEvents).toHaveLength(1);
    expect(orchestratorThinkingEvents[0]?.content).toMatch(
      /^classified: needsPrdWork=(true|false)$/,
    );
  });

  it("turn-summary log line includes routed=", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    let calls = 0;
    const llm: LlmClient = {
      chat: (_args) => {
        calls++;
        if (calls === 1) return Promise.resolve(stubOrchestratorReply(false));
        return Promise.resolve({ role: "assistant", content: "Hello from assistant" });
      },
      chatStreaming: stubChatStreaming,
    };

    const sessionId = "ab12cd34-0000-0000-0000-000000000000";
    const session = makeSession({ id: sessionId });
    const deps = makeDeps(session, llm);
    const { sink } = makeStubSink();

    await handleTurn({ sessionId, userText: "hi", deps, sink });

    const warnLines = warnSpy.mock.calls.map((args) => (typeof args[0] === "string" ? args[0] : ""));
    const summaryLines = warnLines.filter((line) =>
      /^turn [0-9a-f]{8} termination=\w+ routed=(work|no_work) elapsed_ms=\d+$/.test(line),
    );

    expect(summaryLines).toHaveLength(1);
  });
});
