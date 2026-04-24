import { z } from "zod";
import { SectionKeySchema } from "@prd-assist/shared/schemas";
import type { LlmClient } from "./llm";
import type { ModelConfig } from "./config";
import type { SessionWithSummary } from "./sessions";
import type { StreamSink } from "./stream";
import type { LoopResult, Termination } from "./turn";
import { buildPlannerBigPrompt, buildPlannerVerifyPrompt } from "./prompts";
import { SECTION_KEYS } from "@prd-assist/shared";
import { PER_CALL_TIMEOUT_MESSAGE, UNEXPECTED_ERROR_MESSAGE } from "./turnMessages";

export const PlannerTaskSchema = z.object({
  sectionKey: SectionKeySchema,
  instruction: z.string().min(1),
});

export const PlannerTaskListSchema = z.object({
  tasks: z.array(PlannerTaskSchema).min(0),
});

export type PlannerTask = z.infer<typeof PlannerTaskSchema>;
export type PlannerTaskList = z.infer<typeof PlannerTaskListSchema>;

const EMPTY_TASK_LIST: PlannerTaskList = { tasks: [] };

const RETRY_REMINDER =
  'Your previous reply was not valid JSON matching the schema { "tasks": [{ "sectionKey": string, "instruction": string }] }. Reply with only the JSON object and nothing else.';

type PlannerMessage = { role: "system" | "user" | "assistant"; content: string };

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

function parseTaskList(content: string | null): PlannerTaskList | null {
  const text = content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = PlannerTaskListSchema.safeParse(parsed);
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

export type PlannerBigResult = LoopResult & { taskList: PlannerTaskList };

export async function runPlannerBigStage(opts: {
  session: SessionWithSummary;
  llm: LlmClient;
  models: ModelConfig;
  now: () => Date;
  sink: StreamSink;
}): Promise<PlannerBigResult> {
  const { session, llm, models, now, sink } = opts;
  const wallStart = now().getTime();

  const prdContext = buildPrdContext(session);
  const conversationContext = session.messages
    .map((m) => `[${m.role}] ${m.content}`)
    .join("\n");

  const systemMessage: PlannerMessage = {
    role: "system",
    content: buildPlannerBigPrompt(),
  };

  const userMessage: PlannerMessage = {
    role: "user",
    content: `${prdContext}\n\nConversation:\n${conversationContext}`,
  };

  const messages: PlannerMessage[] = [systemMessage, userMessage];

  const signal = AbortSignal.timeout(models.plannerBig.perCallTimeoutMs);
  let firstReplyContent: string | null = null;

  try {
    const reply = await llm.chat({ model: models.plannerBig.model, messages, signal });
    firstReplyContent = reply.content;
    const parsed = parseTaskList(reply.content);
    if (parsed !== null) {
      sink({
        kind: "thinking",
        agentRole: "plannerBig",
        content: `planning ${String(parsed.tasks.length)} task(s)`,
        at: now().toISOString(),
      });
      return { taskList: parsed, termination: "final", wallStart, prdTouched: false };
    }
  } catch (err) {
    if (signal.aborted) {
      sink({ kind: "final", content: PER_CALL_TIMEOUT_MESSAGE, at: now().toISOString() });
      return { taskList: EMPTY_TASK_LIST, termination: "per_call_timeout", wallStart, prdTouched: false };
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`plannerBig chat error: ${message}`);
    sink({ kind: "final", content: UNEXPECTED_ERROR_MESSAGE, at: now().toISOString() });
    return { taskList: EMPTY_TASK_LIST, termination: "unexpected", wallStart, prdTouched: false };
  }

  const retryMessages: PlannerMessage[] = [
    ...messages,
    { role: "assistant", content: firstReplyContent ?? "" },
    { role: "user", content: RETRY_REMINDER },
  ];

  const retrySignal = AbortSignal.timeout(models.plannerBig.perCallTimeoutMs);
  let retryTermination: Termination = "final";

  try {
    const retryReply = await llm.chat({
      model: models.plannerBig.model,
      messages: retryMessages,
      signal: retrySignal,
    });
    const parsed = parseTaskList(retryReply.content);
    if (parsed !== null) {
      sink({
        kind: "thinking",
        agentRole: "plannerBig",
        content: `planning ${String(parsed.tasks.length)} task(s)`,
        at: now().toISOString(),
      });
      return { taskList: parsed, termination: "final", wallStart, prdTouched: false };
    }
    console.error(`plannerBig fail-closed: ${buildFailReason(retryReply.content)}`);
  } catch (err) {
    if (retrySignal.aborted) {
      retryTermination = "per_call_timeout";
      sink({ kind: "final", content: PER_CALL_TIMEOUT_MESSAGE, at: now().toISOString() });
      return { taskList: EMPTY_TASK_LIST, termination: retryTermination, wallStart, prdTouched: false };
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`plannerBig retry chat error: ${message}`);
    retryTermination = "unexpected";
    sink({ kind: "final", content: UNEXPECTED_ERROR_MESSAGE, at: now().toISOString() });
    return { taskList: EMPTY_TASK_LIST, termination: retryTermination, wallStart, prdTouched: false };
  }

  return { taskList: EMPTY_TASK_LIST, termination: "final", wallStart, prdTouched: false };
}

export const PlannerVerifyVerdictSchema = z.object({
  confirmed: z.array(SectionKeySchema),
  failed: z.array(z.object({ sectionKey: SectionKeySchema, reason: z.string() })),
});

export type PlannerVerifyVerdict = z.infer<typeof PlannerVerifyVerdictSchema>;

const VERIFY_RETRY_REMINDER =
  'Your previous reply was not valid JSON matching the schema { "confirmed": [sectionKey, ...], "failed": [{ "sectionKey": string, "reason": string }] }. Reply with only the JSON object and nothing else.';

function buildPrdSectionsForVerify(session: SessionWithSummary): string {
  // Always use raw section content for verify — the summary is from before the worker
  // mutations and would be stale by the time verify runs.
  const sectionLines = SECTION_KEYS.map((key) => {
    const section = session.prd[key];
    const preview = section.content.length > 0 ? section.content.slice(0, 400) : "(empty)";
    return `${key}: ${preview}`;
  });
  return `Current PRD section content:\n${sectionLines.join("\n")}`;
}

function parseVerifyVerdict(content: string | null): PlannerVerifyVerdict | null {
  const text = content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = PlannerVerifyVerdictSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export type PlannerVerifyResult = { verdict: PlannerVerifyVerdict; wallStart: number };

export async function runPlannerVerifyStage(opts: {
  session: SessionWithSummary;
  executedTasks: PlannerTask[];
  llm: LlmClient;
  models: ModelConfig;
  now: () => Date;
  sink: StreamSink;
}): Promise<PlannerVerifyResult> {
  const { session, executedTasks, llm, models, now, sink } = opts;
  const wallStart = now().getTime();

  // Fail-closed trust-workers fallback: used when verify cannot run.
  // interviewerSmall still runs afterward; this stage never emits `final`.
  const trustWorkers: PlannerVerifyResult = {
    verdict: { confirmed: executedTasks.map((t) => t.sectionKey), failed: [] },
    wallStart,
  };

  sink({
    kind: "thinking",
    agentRole: "plannerBig",
    content: `verifying ${String(executedTasks.length)} edit(s)`,
    at: now().toISOString(),
  });

  const prdContent = buildPrdSectionsForVerify(session);
  const taskLines = executedTasks
    .map((t) => `- ${t.sectionKey}: ${t.instruction}`)
    .join("\n");
  const attemptedBlock =
    executedTasks.length > 0
      ? `Attempted edits:\n${taskLines}`
      : "No edits were attempted this turn.";

  const systemMessage: PlannerMessage = {
    role: "system",
    content: buildPlannerVerifyPrompt(),
  };
  const userMessage: PlannerMessage = {
    role: "user",
    content: `${prdContent}\n\n${attemptedBlock}`,
  };
  const messages: PlannerMessage[] = [systemMessage, userMessage];

  const signal = AbortSignal.timeout(models.plannerBig.perCallTimeoutMs);
  let firstReplyContent: string | null = null;

  try {
    const reply = await llm.chat({ model: models.plannerBig.model, messages, signal });
    firstReplyContent = reply.content;
    const parsed = parseVerifyVerdict(reply.content);
    if (parsed !== null) {
      return { verdict: parsed, wallStart };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`plannerVerify chat error: ${message}`);
    return trustWorkers;
  }

  const retryMessages: PlannerMessage[] = [
    ...messages,
    { role: "assistant", content: firstReplyContent ?? "" },
    { role: "user", content: VERIFY_RETRY_REMINDER },
  ];

  const retrySignal = AbortSignal.timeout(models.plannerBig.perCallTimeoutMs);

  try {
    const retryReply = await llm.chat({
      model: models.plannerBig.model,
      messages: retryMessages,
      signal: retrySignal,
    });
    const parsed = parseVerifyVerdict(retryReply.content);
    if (parsed !== null) {
      return { verdict: parsed, wallStart };
    }
    console.error(`plannerVerify fail-closed: ${buildFailReason(retryReply.content)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`plannerVerify retry chat error: ${message}`);
  }

  return trustWorkers;
}
