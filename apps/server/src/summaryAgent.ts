import type { LlmClient } from "./llm";
import type { ModelConfig } from "./config";
import type { PRD } from "@prd-assist/shared";
import { buildSummaryPrompt } from "./prompts";

export async function regenerateSummary(opts: {
  llm: LlmClient;
  models: ModelConfig;
  prd: PRD;
}): Promise<string> {
  const { llm, models, prd } = opts;

  const system = { role: "system" as const, content: buildSummaryPrompt() };
  const user = {
    role: "user" as const,
    content: `Current PRD:\n\n${JSON.stringify(prd, null, 2)}`,
  };

  const reply = await llm.chat({
    model: models.summary.model,
    messages: [system, user],
    signal: AbortSignal.timeout(models.summary.perCallTimeoutMs),
  });

  return reply.content ?? "";
}
