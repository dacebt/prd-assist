import type { LlmClient } from "./llm";
import type { ModelConfig } from "./config";
import type { SessionWithSummary } from "./sessions";
import type { StreamSink } from "./stream";
import type { LoopResult, Termination } from "./turn";
import { buildInterviewerBigPrompt } from "./prompts";
import { SECTION_KEYS } from "@prd-assist/shared";

const PER_CALL_TIMEOUT_MESSAGE = "The model took too long to respond. Please try again.";
const UNEXPECTED_ERROR_MESSAGE =
  "Something went wrong while processing that turn. See server logs for details.";

function buildPrdContext(session: SessionWithSummary): string {
  if (session.summary !== null) {
    return `PRD summary:\n${session.summary}`;
  }
  const sectionLines = SECTION_KEYS.map((key) => {
    const section = session.prd[key];
    return `${key}: status=${section.status}${section.content.length > 0 ? `, content_preview=${section.content.slice(0, 120)}` : ""}`;
  });
  return `PRD section status:\n${sectionLines.join("\n")}`;
}

type InterviewerMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

function buildMessages(session: SessionWithSummary): InterviewerMessage[] {
  const systemContent = `${buildInterviewerBigPrompt()}\n\n${buildPrdContext(session)}`;
  const systemMessage: InterviewerMessage = { role: "system", content: systemContent };
  const history: InterviewerMessage[] = session.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  return [systemMessage, ...history];
}

export async function runInterviewerBigStage(opts: {
  session: SessionWithSummary;
  llm: LlmClient;
  models: ModelConfig;
  now: () => Date;
  sink: StreamSink;
}): Promise<LoopResult> {
  const { session, llm, models, now, sink } = opts;
  const wallStart = now().getTime();

  sink({
    kind: "thinking",
    agentRole: "interviewerBig",
    content: "identifying PRD gap",
    at: now().toISOString(),
  });

  const messages = buildMessages(session);

  const abortSignal = AbortSignal.timeout(models.interviewerBig.perCallTimeoutMs);
  let termination: Termination;
  try {
    const reply = await llm.chat({
      model: models.interviewerBig.model,
      messages,
      signal: abortSignal,
    });

    const content = reply.content ?? "";
    sink({ kind: "final", content, at: now().toISOString() });
    termination = "final";
  } catch (err) {
    if (abortSignal.aborted) {
      sink({ kind: "final", content: PER_CALL_TIMEOUT_MESSAGE, at: now().toISOString() });
      termination = "per_call_timeout";
    } else {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`interviewerBig chat error: ${message}`);
      sink({ kind: "final", content: UNEXPECTED_ERROR_MESSAGE, at: now().toISOString() });
      termination = "unexpected";
    }
  }

  return { termination, wallStart, prdTouched: false };
}
