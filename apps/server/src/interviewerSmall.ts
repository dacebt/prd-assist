import type { LlmClient } from "./llm";
import type { ModelConfig } from "./config";
import type { SessionWithSummary } from "./sessions";
import type { StreamSink } from "./stream";
import type { LoopResult, Termination } from "./turn";
import type { PlannerTask } from "./plannerBig";
import { buildInterviewerSmallPrompt } from "./prompts";

import { PER_CALL_TIMEOUT_MESSAGE, UNEXPECTED_ERROR_MESSAGE } from "./turnMessages";

type InterviewerSmallMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

type FailedTask = { sectionKey: string; reason: string };

function buildTaskContext(executedTasks: PlannerTask[], failedTasks: FailedTask[]): string {
  const parts: string[] = [];
  if (executedTasks.length === 0 && failedTasks.length === 0) {
    return "No edits were made this turn.";
  }
  if (executedTasks.length > 0) {
    const lines = executedTasks.map((t) => `- ${t.sectionKey}: ${t.instruction}`);
    parts.push(`Edited sections this turn:\n${lines.join("\n")}`);
  }
  if (failedTasks.length > 0) {
    const lines = failedTasks.map((t) => `- ${t.sectionKey}: ${t.reason}`);
    parts.push(`Failed edits this turn:\n${lines.join("\n")}`);
  }
  return parts.join("\n\n");
}

function buildMessages(
  session: SessionWithSummary,
  executedTasks: PlannerTask[],
  failedTasks: FailedTask[],
): InterviewerSmallMessage[] {
  const taskContext = buildTaskContext(executedTasks, failedTasks);
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
  failedTasks?: FailedTask[];
  llm: LlmClient;
  models: ModelConfig;
  now: () => Date;
  sink: StreamSink;
}): Promise<LoopResult> {
  const { session, executedTasks, failedTasks = [], llm, models, now, sink } = opts;
  const wallStart = now().getTime();

  sink({
    kind: "thinking",
    agentRole: "interviewerSmall",
    content: "composing reply",
    at: now().toISOString(),
  });

  const messages = buildMessages(session, executedTasks, failedTasks);

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
