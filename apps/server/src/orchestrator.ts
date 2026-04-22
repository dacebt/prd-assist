import type { LlmClient } from "./llm";
import type { ModelConfig } from "./config";
import type { PRD, ChatMessage } from "@prd-assist/shared";
import { buildOrchestratorPrompt } from "./prompts";
import { z } from "zod";

const OrchestratorOutputSchema = z.object({ needsPrdWork: z.boolean() }).strict();

const RETRY_REMINDER =
  'Your previous reply was not valid JSON matching the schema { "needsPrdWork": boolean }. Reply with only the JSON object and nothing else.';

type OrchestratorMessage = { role: "system" | "user" | "assistant"; content: string };

function parseAndValidate(content: string | null): { needsPrdWork: boolean } | null {
  const text = content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = OrchestratorOutputSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

function buildFailReason(content: string | null): string {
  const text = content ?? "";
  try {
    JSON.parse(text);
    return `schema mismatch after retry: ${text.slice(0, 80)}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `invalid JSON after retry: ${msg}`;
  }
}

async function attemptRetry(
  llm: LlmClient,
  models: ModelConfig,
  retryMessages: OrchestratorMessage[],
): Promise<{ needsPrdWork: boolean }> {
  try {
    const reply = await llm.chat({
      model: models.orchestrator.model,
      messages: retryMessages,
      signal: AbortSignal.timeout(models.orchestrator.perCallTimeoutMs),
    });
    const parsed = parseAndValidate(reply.content);
    if (parsed !== null) return parsed;
    console.error(`orchestrator classification fail-closed: ${buildFailReason(reply.content)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`orchestrator classification fail-closed: chat threw: ${message}`);
  }
  return { needsPrdWork: false };
}

export async function classifyTurn(opts: {
  llm: LlmClient;
  models: ModelConfig;
  prd: PRD;
  summary: string | null;
  recentMessages: ChatMessage[];
}): Promise<{ needsPrdWork: boolean }> {
  const { llm, models, prd, summary, recentMessages } = opts;

  const systemMessage: OrchestratorMessage = { role: "system", content: buildOrchestratorPrompt() };

  const prdBlock =
    summary !== null
      ? `PRD summary:\n${summary}`
      : `Current PRD:\n${JSON.stringify(prd, null, 2)}`;

  const userMessage: OrchestratorMessage = {
    role: "user",
    content: `${prdBlock}\n\nRecent conversation:\n${recentMessages.map((m) => `[${m.role}] ${m.content}`).join("\n")}`,
  };

  const messages: OrchestratorMessage[] = [systemMessage, userMessage];

  let firstReplyContent: string | null = null;
  try {
    const reply = await llm.chat({
      model: models.orchestrator.model,
      messages,
      signal: AbortSignal.timeout(models.orchestrator.perCallTimeoutMs),
    });
    firstReplyContent = reply.content;
    const parsed = parseAndValidate(reply.content);
    if (parsed !== null) return parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`orchestrator classification fail-closed: chat threw: ${message}`);
    return { needsPrdWork: false };
  }

  return await attemptRetry(llm, models, [
    ...messages,
    { role: "assistant", content: firstReplyContent ?? "" },
    { role: "user", content: RETRY_REMINDER },
  ]);
}
