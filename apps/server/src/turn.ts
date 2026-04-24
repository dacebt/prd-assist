import type { SessionStore, SessionWithSummary } from "./sessions";
import type { LlmClient } from "./llm";
import type { McpClient } from "./mcpClient";
import type { SessionMutex } from "./mutex";
import { deriveTitle } from "./deriveTitle";
import type { ModelConfig } from "./config";
import type { StreamSink } from "./stream";
import { regenerateSummary } from "./summaryAgent";
import { classifyTurn } from "./orchestrator";
import { runInterviewerBigStage } from "./interviewerBig";
import { runPlannerBigStage } from "./plannerBig";
import type { PlannerTask } from "./plannerBig";
import { runWorkerStage } from "./workers";
import { runInterviewerSmallStage } from "./interviewerSmall";
import { UNEXPECTED_ERROR_MESSAGE } from "./turnMessages";

export type TurnDeps = {
  store: SessionStore;
  llm: LlmClient;
  mcp: McpClient;
  mutex: SessionMutex;
  now: () => Date;
  config: {
    models: ModelConfig;
    maxIterations: number;
    perCallTimeoutMs: number;
    wallClockMs: number;
  };
};

export class SessionBusyError extends Error {
  constructor() {
    super("Session is busy");
    this.name = "SessionBusyError";
  }
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = "SessionNotFoundError";
  }
}

type RouteDecision = "work" | "no_work";

export type Termination = "final" | "iteration_cap" | "per_call_timeout" | "wall_clock" | "unexpected";

export type LoopResult = { termination: Termination; wallStart: number; prdTouched: boolean };

async function persistReplyAndSummary(
  sessionId: string,
  session: SessionWithSummary,
  reply: string,
  store: SessionStore,
  llm: LlmClient,
  config: TurnDeps["config"],
  now: () => Date,
  routed: RouteDecision,
  termination: Termination,
  wallStart: number,
  prdTouched: boolean,
): Promise<void> {
  const replyTs = now().toISOString();
  session.messages.push({ role: "assistant", content: reply, at: replyTs });
  session.updatedAt = replyTs;
  store.persistAssistantMessage(session);
  if (prdTouched) {
    await maybePersistSummary(sessionId, store, llm, config.models);
  }
  console.warn(
    `turn ${sessionId.slice(0, 8)} termination=${termination} routed=${routed} elapsed_ms=${now().getTime() - wallStart}`,
  );
}

async function maybePersistSummary(
  sessionId: string,
  store: SessionStore,
  llm: LlmClient,
  models: ModelConfig,
): Promise<void> {
  try {
    const refreshed = store.getSession(sessionId);
    if (refreshed !== null) {
      const summary = await regenerateSummary({ llm, models, prd: refreshed.prd });
      store.persistSummary(sessionId, summary);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`summary regen failed: ${message}`);
  }
}

export async function handleTurn(opts: {
  sessionId: string;
  userText: string;
  deps: TurnDeps;
  sink: StreamSink;
}): Promise<void> {
  const { sessionId, userText, deps, sink } = opts;
  const { store, llm, mcp, mutex, now, config } = deps;

  if (!mutex.tryAcquire(sessionId)) {
    throw new SessionBusyError();
  }

  try {
    const session = store.getSession(sessionId);
    if (session === null) {
      throw new SessionNotFoundError(sessionId);
    }

    const ts = now().toISOString();
    session.messages.push({ role: "user", content: userText, at: ts });
    session.updatedAt = ts;
    if (session.title === "") session.title = deriveTitle(userText);
    store.persistUserMessage(session);

    // Capture the final content as it passes through so persistReplyAndSummary
    // can receive it without requiring a buffered sink. A single-element array
    // lets TypeScript track the value without narrowing it to a literal null.
    const capturedFinal: string[] = [];
    const wrappedSink: StreamSink = (event) => {
      if (event.kind === "final") capturedFinal.push(event.content);
      sink(event);
    };

    const classification = await classifyTurn({
      llm,
      models: config.models,
      prd: session.prd,
      summary: session.summary,
      recentMessages: session.messages.slice(-3),
    });

    wrappedSink({
      kind: "thinking",
      agentRole: "orchestrator",
      content: `classified: needsPrdWork=${String(classification.needsPrdWork)}`,
      at: now().toISOString(),
    });

    const routed: RouteDecision = classification.needsPrdWork ? "work" : "no_work";

    let termination: Termination;
    let wallStart: number;
    let prdTouched: boolean;

    if (routed === "work") {
      const plannerResult = await runPlannerBigStage({
        session,
        llm,
        models: config.models,
        now,
        sink: wrappedSink,
      });

      if (plannerResult.termination !== "final") {
        ({ termination, wallStart, prdTouched } = plannerResult);
      } else {
        const executedTasks: PlannerTask[] = [];
        let workerFailed = false;
        let failedWorkerResult: LoopResult | undefined;

        for (const task of plannerResult.taskList.tasks) {
          const workerResult = await runWorkerStage({
            task,
            sessionId,
            llm,
            mcp,
            models: config.models,
            wallClockMs: config.wallClockMs,
            now,
            sink: wrappedSink,
          });

          if (workerResult.prdTouched) {
            executedTasks.push(task);
          }

          if (workerResult.termination !== "final") {
            workerFailed = true;
            failedWorkerResult = workerResult;
            break;
          }
        }

        if (workerFailed && failedWorkerResult !== undefined) {
          termination = failedWorkerResult.termination;
          wallStart = plannerResult.wallStart;
          prdTouched = executedTasks.length > 0;
        } else {
          const smallResult = await runInterviewerSmallStage({
            session,
            executedTasks,
            llm,
            models: config.models,
            now,
            sink: wrappedSink,
          });
          termination = smallResult.termination;
          wallStart = plannerResult.wallStart;
          prdTouched = executedTasks.length > 0;
        }
      }
    } else {
      ({ termination, wallStart, prdTouched } = await runInterviewerBigStage({
        session,
        llm,
        models: config.models,
        now,
        sink: wrappedSink,
      }));
    }

    const reply = capturedFinal[0] ?? UNEXPECTED_ERROR_MESSAGE;
    await persistReplyAndSummary(
      sessionId, session, reply, store, llm, config, now, routed, termination, wallStart, prdTouched,
    );
  } finally {
    mutex.release(sessionId);
  }
}
