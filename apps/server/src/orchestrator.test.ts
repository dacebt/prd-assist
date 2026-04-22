import { describe, it, expect, vi, afterEach } from "vitest";
import type { LlmClient } from "./llm";
import type { ChatMessage } from "@prd-assist/shared";
import { classifyTurn } from "./orchestrator";
import { buildOrchestratorPrompt } from "./prompts";
import { DEFAULT_MODEL_CONFIG } from "./config";
import { initialPrd } from "./sessions";
import { stubChatStreaming } from "./turn.test.helpers";

const MODELS = DEFAULT_MODEL_CONFIG;
const PRD = initialPrd(new Date("2026-01-01T00:00:00.000Z"));

type ChatArgs = Parameters<LlmClient["chat"]>[0];

function makeMessages(count: number): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  for (let i = 0; i < count; i++) {
    if (i % 2 === 0) {
      msgs.push({ role: "user", content: `user message ${i}`, at: "2026-01-01T00:00:00.000Z" });
    } else {
      msgs.push({ role: "assistant", content: `assistant message ${i}`, at: "2026-01-01T00:00:00.000Z" });
    }
  }
  return msgs;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifyTurn", () => {
  it("happy path returns needsPrdWork: true with non-null summary", async () => {
    const capturedArgs: ChatArgs[] = [];
    const llm: LlmClient = {
      chat: (args) => {
        capturedArgs.push(args);
        return Promise.resolve({ role: "assistant", content: '{"needsPrdWork": true}' });
      },
      chatStreaming: stubChatStreaming,
    };
    const recentMessages = makeMessages(2);

    const result = await classifyTurn({
      llm,
      models: MODELS,
      prd: PRD,
      summary: "This PRD covers a PRD-building tool.",
      recentMessages,
    });

    expect(result).toEqual({ needsPrdWork: true });
    expect(capturedArgs).toHaveLength(1);

    const firstArgs = capturedArgs[0];
    if (firstArgs === undefined) throw new Error("no args captured");

    expect(firstArgs.model).toBe("google/gemma-4-e4b");

    const messages = firstArgs.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toBe(buildOrchestratorPrompt());

    const userContent = messages[1]?.content ?? "";
    expect(userContent).toContain("This PRD covers a PRD-building tool.");
    expect(userContent).toContain("[user]");
    expect(userContent).toContain("[assistant]");
  });

  it("happy path returns needsPrdWork: false on conversation turn", async () => {
    const llm: LlmClient = {
      chat: () => Promise.resolve({ role: "assistant", content: '{"needsPrdWork": false}' }),
      chatStreaming: stubChatStreaming,
    };

    const result = await classifyTurn({
      llm,
      models: MODELS,
      prd: PRD,
      summary: "Some summary",
      recentMessages: makeMessages(1),
    });

    expect(result).toEqual({ needsPrdWork: false });
  });

  it("null summary: user message contains Current PRD and section keys, not PRD summary:", async () => {
    let capturedUserContent = "";
    const llm: LlmClient = {
      chat: (args) => {
        const messages = args.messages as Array<{ role: string; content: string }>;
        capturedUserContent = messages[1]?.content ?? "";
        return Promise.resolve({ role: "assistant", content: '{"needsPrdWork": false}' });
      },
      chatStreaming: stubChatStreaming,
    };

    await classifyTurn({
      llm,
      models: MODELS,
      prd: PRD,
      summary: null,
      recentMessages: makeMessages(1),
    });

    expect(capturedUserContent).toContain("Current PRD:");
    expect(capturedUserContent).toContain("vision");
    expect(capturedUserContent).not.toContain("PRD summary:");
  });

  it("parse-failure retry succeeds: second call valid JSON", async () => {
    let callCount = 0;
    const capturedArgs: ChatArgs[] = [];
    const llm: LlmClient = {
      chat: (args) => {
        callCount++;
        capturedArgs.push(args);
        if (callCount === 1) {
          return Promise.resolve({ role: "assistant", content: "sure here is the answer" });
        }
        return Promise.resolve({ role: "assistant", content: '{"needsPrdWork": true}' });
      },
      chatStreaming: stubChatStreaming,
    };

    const result = await classifyTurn({
      llm,
      models: MODELS,
      prd: PRD,
      summary: "some summary",
      recentMessages: makeMessages(2),
    });

    expect(result).toEqual({ needsPrdWork: true });
    expect(capturedArgs).toHaveLength(2);

    const firstMessages = capturedArgs[0]?.messages ?? [];
    const secondMessages = capturedArgs[1]?.messages ?? [];
    expect(secondMessages.length).toBe(firstMessages.length + 2);

    const assistantRepeat = secondMessages[secondMessages.length - 2] as { role: string; content: string };
    expect(assistantRepeat.content).toBe("sure here is the answer");

    const reminder = secondMessages[secondMessages.length - 1] as { role: string; content: string };
    expect(reminder.role).toBe("user");
    expect(reminder.content).toContain("Reply with only the JSON object");
  });

  it("parse-failure twice falls closed with needsPrdWork: false and logs error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const llm: LlmClient = {
      chat: () => Promise.resolve({ role: "assistant", content: "not json at all" }),
      chatStreaming: stubChatStreaming,
    };

    const result = await classifyTurn({
      llm,
      models: MODELS,
      prd: PRD,
      summary: "some summary",
      recentMessages: makeMessages(1),
    });

    expect(result).toEqual({ needsPrdWork: false });
    expect(
      errorSpy.mock.calls.some(
        (args) => typeof args[0] === "string" && args[0].startsWith("orchestrator classification fail-closed:"),
      ),
    ).toBe(true);
  });

  it("shape-valid JSON with wrong keys falls closed", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const llm: LlmClient = {
      chat: () => Promise.resolve({ role: "assistant", content: '{"something": true}' }),
      chatStreaming: stubChatStreaming,
    };

    const result = await classifyTurn({
      llm,
      models: MODELS,
      prd: PRD,
      summary: "some summary",
      recentMessages: makeMessages(1),
    });

    expect(result).toEqual({ needsPrdWork: false });
    expect(
      errorSpy.mock.calls.some(
        (args) => typeof args[0] === "string" && args[0].startsWith("orchestrator classification fail-closed:"),
      ),
    ).toBe(true);
  });

  it("llm.chat throws: returns needsPrdWork: false and logs fail-closed with error message", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const llm: LlmClient = {
      chat: () => Promise.reject(new Error("model unavailable")),
      chatStreaming: stubChatStreaming,
    };

    const result = await classifyTurn({
      llm,
      models: MODELS,
      prd: PRD,
      summary: "some summary",
      recentMessages: makeMessages(1),
    });

    expect(result).toEqual({ needsPrdWork: false });
    expect(
      errorSpy.mock.calls.some(
        (args) =>
          typeof args[0] === "string" &&
          args[0].startsWith("orchestrator classification fail-closed:") &&
          args[0].includes("model unavailable"),
      ),
    ).toBe(true);
  });

  it("recent-messages slicing: classifyTurn iterates its input; only passed messages appear", async () => {
    let capturedUserContent = "";
    const llm: LlmClient = {
      chat: (args) => {
        const messages = args.messages as Array<{ role: string; content: string }>;
        capturedUserContent = messages[1]?.content ?? "";
        return Promise.resolve({ role: "assistant", content: '{"needsPrdWork": false}' });
      },
      chatStreaming: stubChatStreaming,
    };

    const allMessages = makeMessages(5);
    const last3 = allMessages.slice(-3);

    await classifyTurn({
      llm,
      models: MODELS,
      prd: PRD,
      summary: "some summary",
      recentMessages: last3,
    });

    expect(capturedUserContent).toContain(last3[0]?.content ?? "");
    expect(capturedUserContent).toContain(last3[1]?.content ?? "");
    expect(capturedUserContent).toContain(last3[2]?.content ?? "");
    expect(capturedUserContent).not.toContain(allMessages[0]?.content ?? "UNIQUE_0");
    expect(capturedUserContent).not.toContain(allMessages[1]?.content ?? "UNIQUE_1");
  });
});
