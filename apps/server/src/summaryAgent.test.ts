import { describe, it, expect, vi } from "vitest";
import { regenerateSummary } from "./summaryAgent";
import { buildSummaryPrompt } from "./prompts";
import { DEFAULT_MODEL_CONFIG } from "./config";
import { initialPrd } from "./sessions";
import type { LlmClient } from "./llm";
import { stubChatStreaming } from "./turn.test.helpers";

describe("regenerateSummary", () => {
  it("calls summary model with system prompt + PRD user message and returns content", async () => {
    const prd = initialPrd(new Date("2026-01-01T00:00:00.000Z"));
    const chatSpy = vi.fn().mockResolvedValue({ role: "assistant", content: "mocked summary" });

    const llm: LlmClient = {
      chat: chatSpy,
      chatStreaming: stubChatStreaming,
    };

    const result = await regenerateSummary({ llm, models: DEFAULT_MODEL_CONFIG, prd });

    expect(result).toBe("mocked summary");
    expect(chatSpy).toHaveBeenCalledTimes(1);

    // Verified above via toHaveBeenCalledTimes(1); destucture through a known-defined cast
    const callArgs = chatSpy.mock.calls[0]?.[0] as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(callArgs).toBeDefined();

    expect(callArgs.model).toBe("google/gemma-4-e4b");

    const [systemMsg, userMsg] = callArgs.messages;
    expect(systemMsg?.role).toBe("system");
    expect(systemMsg?.content).toBe(buildSummaryPrompt());

    expect(userMsg?.role).toBe("user");
    expect(userMsg?.content).toContain("Current PRD:");
    expect(userMsg?.content).toContain(JSON.stringify(prd, null, 2));
  });

  it("returns empty string when LLM reply content is null", async () => {
    const prd = initialPrd(new Date("2026-01-01T00:00:00.000Z"));
    const llm: LlmClient = {
      chat: vi.fn().mockResolvedValue({ role: "assistant", content: null }),
      chatStreaming: stubChatStreaming,
    };

    const result = await regenerateSummary({ llm, models: DEFAULT_MODEL_CONFIG, prd });
    expect(result).toBe("");
  });
});
