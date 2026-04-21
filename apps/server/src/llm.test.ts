import { describe, it, expect } from "vitest";
import { createOpenAiLlmClient, NotImplementedError } from "./llm";

describe("createOpenAiLlmClient", () => {
  it("chatStreaming throws NotImplementedError on iteration", async () => {
    const client = createOpenAiLlmClient({ baseURL: "http://localhost:1", apiKey: "x" });
    const iter = client.chatStreaming({ model: "m", messages: [] })[Symbol.asyncIterator]();

    await expect(iter.next()).rejects.toThrow(NotImplementedError);
  });

  it("chatStreaming error message is 'chatStreaming not implemented'", async () => {
    const client = createOpenAiLlmClient({ baseURL: "http://localhost:1", apiKey: "x" });
    const iter = client.chatStreaming({ model: "m", messages: [] })[Symbol.asyncIterator]();

    await expect(iter.next()).rejects.toThrow("chatStreaming not implemented");
  });
});
