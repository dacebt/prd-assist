import type { LlmClient } from "./llm";
import type { ModelConfig } from "./config";
import type { SessionWithSummary } from "./sessions";
import type { StreamSink } from "./stream";
import type { LoopResult, Termination } from "./turn";
import type { PlannerTask } from "./plannerBig";
import { buildInterviewerSmallPrompt } from "./prompts";

const PER_CALL_TIMEOUT_MESSAGE = "The model took too long to respond. Please try again.";
const UNEXPECTED_ERROR_MESSAGE =
  "Something went wrong while processing that turn. See server logs for details.";

type InterviewerSmallMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

function buildTaskContext(executedTasks: PlannerTask[]): string {
  if (executedTasks.length === 0) {
    return "No edits were made this turn.";
  }
  const lines = executedTasks.map((t) => `- ${t.sectionKey}: ${t.instruction}`);
  return `Edited sections this turn:\n${lines.join("\n")}`;
}

function buildMessages(
  session: SessionWithSummary,
  executedTasks: PlannerTask[],
): InterviewerSmallMessage[] {
  const taskContext = buildTaskContext(executedTasks);
  const systemContent = `${buildInterviewerSmallPrompt()}\n\n${taskContext}`;
  const systemMessage: InterviewerSmallMessage = { role: "system", content: systemContent };
  const history: InterviewerSmallMessage[] = session.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  return [systemMessage, ...history];
}

export async function runInterviewerSmallStage(opts: {
  session: SessionWithSummary;
  executedTasks: PlannerTask[];
  llm: LlmClient;
  models: ModelConfig;
  now: () => Date;
  sink: StreamSink;
}): Promise<LoopResult> {
  const { session, executedTasks, llm, models, now, sink } = opts;
  const wallStart = now().getTime();

  sink({
    kind: "thinking",
    agentRole: "interviewerSmall",
    content: "composing reply",
    at: now().toISOString(),
  });

  const messages = buildMessages(session, executedTasks);

  const signal = AbortSignal.timeout(models.interviewerSmall.perCallTimeoutMs);
  let termination: Termination;

  try {
    const reply = await llm.chat({
      model: models.interviewerSmall.model,
      messages,
      signal,
    });

    const content = reply.content ?? "";
    sink({ kind: "final", content, at: now().toISOString() });
    termination = "final";
  } catch (err) {
    if (signal.aborted) {
      sink({ kind: "final", content: PER_CALL_TIMEOUT_MESSAGE, at: now().toISOString() });
      termination = "per_call_timeout";
    } else {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`interviewerSmall chat error: ${message}`);
      sink({ kind: "final", content: UNEXPECTED_ERROR_MESSAGE, at: now().toISOString() });
      termination = "unexpected";
    }
  }

  return { termination, wallStart, prdTouched: false };
}
