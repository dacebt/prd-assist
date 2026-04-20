import OpenAI from "openai";

export interface LlmToolDescriptor {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface LlmClient {
  chat(args: {
    model: string;
    messages: unknown[];
    tools?: LlmToolDescriptor[];
    signal?: AbortSignal;
  }): Promise<AssistantMessage>;
}

export class LlmResponseShapeError extends Error {
  constructor(detail: string) {
    super(`LLM response shape error: ${detail}`);
    this.name = "LlmResponseShapeError";
  }
}

export function createOpenAiLlmClient({
  baseURL,
  apiKey,
}: {
  baseURL: string;
  apiKey: string;
}): LlmClient {
  const client = new OpenAI({ baseURL, apiKey });

  return {
    async chat({ model, messages, tools, signal }) {
      const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
        model,
        messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
        ...(tools !== undefined && { tools: tools as OpenAI.Chat.ChatCompletionTool[] }),
      };

      const response = await client.chat.completions.create(params, { signal });

      const message = response.choices[0]?.message;
      if (message === undefined) {
        throw new LlmResponseShapeError("choices[0].message is missing");
      }

      const result: AssistantMessage = {
        role: "assistant",
        content: message.content ?? null,
      };

      if (message.tool_calls && message.tool_calls.length > 0) {
        result.tool_calls = message.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        }));
      }

      return result;
    },
  };
}
