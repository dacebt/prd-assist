import type { SessionStore, SessionWithSummary } from "./sessions";
import type { LlmClient, AssistantMessage, LlmToolDescriptor } from "./llm";
import type { McpClient, McpToolDescriptor } from "./mcpClient";
import { mcpToolsToOpenAi } from "./mcpClient";
import type { SessionMutex } from "./mutex";
import { buildSupervisorPrompt } from "./prompts";
import { deriveTitle } from "./deriveTitle";
import type { ModelConfig } from "./config";
import { createBufferedSink } from "./stream";
import type { StreamSink } from "./stream";
import { regenerateSummary } from "./summaryAgent";
import { classifyTurn } from "./orchestrator";

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

const ITERATION_CAP_MESSAGE =
  "I hit a tool-call loop limit. Please rephrase your request or try a smaller step.";
const PER_CALL_TIMEOUT_MESSAGE = "The model took too long to respond. Please try again.";
const WALL_CLOCK_MESSAGE = "I ran out of time on that turn. Please try again.";
const UNEXPECTED_ERROR_MESSAGE =
  "Something went wrong while processing that turn. See server logs for details.";

type ToolCallEntry = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type WorkingMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string; at: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCallEntry[] | undefined }
  | { role: "tool"; tool_call_id: string; content: string };

type RouteDecision = "work" | "no_work";

type Termination = "final" | "iteration_cap" | "per_call_timeout" | "wall_clock" | "unexpected";

type ModelCallResult =
  | { outcome: "reply"; reply: AssistantMessage }
  | { outcome: "terminated"; termination: Exclude<Termination, "final"> };

function terminationMessage(termination: Termination): string {
  if (termination === "iteration_cap") return ITERATION_CAP_MESSAGE;
  if (termination === "per_call_timeout") return PER_CALL_TIMEOUT_MESSAGE;
  if (termination === "wall_clock") return WALL_CLOCK_MESSAGE;
  return UNEXPECTED_ERROR_MESSAGE;
}

async function callModel(
  llm: LlmClient,
  config: TurnDeps["config"],
  workingMessages: WorkingMessage[],
  tools: LlmToolDescriptor[],
): Promise<ModelCallResult> {
  const signal = AbortSignal.timeout(config.perCallTimeoutMs);
  try {
    const reply = await llm.chat({ model: config.models.supervisor.model, messages: workingMessages, tools, signal });
    return { outcome: "reply", reply };
  } catch (err) {
    if (signal.aborted) {
      return { outcome: "terminated", termination: "per_call_timeout" };
    }
    console.error("LLM chat error in handleTurn:", err);
    return { outcome: "terminated", termination: "unexpected" };
  }
}

const PRD_MUTATING_TOOLS = new Set(["update_section", "mark_confirmed"]);

async function invokeTool(
  call: ToolCallEntry,
  mcp: McpClient,
  validToolNames: string[],
): Promise<unknown> {
  let parsedArgs: Record<string, unknown>;
  try {
    parsedArgs = JSON.parse(call.function.arguments) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: "invalid_tool_arguments", message };
  }

  if (!validToolNames.includes(call.function.name)) {
    return { error: "unknown_tool", name: call.function.name, valid_tools: validToolNames };
  }

  try {
    return await mcp.callTool(call.function.name, parsedArgs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: "tool_invocation_failed", name: call.function.name, message };
  }
}

async function dispatchToolCalls(
  toolCalls: ToolCallEntry[],
  mcp: McpClient,
  mcpTools: McpToolDescriptor[],
  workingMessages: WorkingMessage[],
  prdTouchedRef: { value: boolean },
): Promise<void> {
  const validToolNames = mcpTools.map((t) => t.name);
  for (const call of toolCalls) {
    const toolResult = await invokeTool(call, mcp, validToolNames);
    workingMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(toolResult) });
    if (
      PRD_MUTATING_TOOLS.has(call.function.name) &&
      toolResult !== null &&
      typeof toolResult === "object" &&
      !("error" in toolResult)
    ) {
      prdTouchedRef.value = true;
    }
  }
}

type LoopResult = { termination: Termination; wallStart: number; prdTouched: boolean };

async function runToolCallLoop(
  llm: LlmClient,
  mcp: McpClient,
  mcpTools: McpToolDescriptor[],
  config: TurnDeps["config"],
  workingMessages: WorkingMessage[],
  now: () => Date,
  sink: StreamSink,
): Promise<LoopResult> {
  const tools = mcpToolsToOpenAi(mcpTools);
  const wallStart = now().getTime();
  let iterationCount = 0;
  const prdTouchedRef = { value: false };

  for (;;) {
    if (now().getTime() - wallStart > config.wallClockMs) {
      sink({ kind: "final", content: WALL_CLOCK_MESSAGE, at: now().toISOString() });
      return { termination: "wall_clock", wallStart, prdTouched: prdTouchedRef.value };
    }
    if (iterationCount >= config.maxIterations) {
      sink({ kind: "final", content: ITERATION_CAP_MESSAGE, at: now().toISOString() });
      return { termination: "iteration_cap", wallStart, prdTouched: prdTouchedRef.value };
    }

    iterationCount++;
    const modelResult = await callModel(llm, config, workingMessages, tools);

    if (modelResult.outcome === "terminated") {
      const msg = terminationMessage(modelResult.termination);
      sink({ kind: "final", content: msg, at: now().toISOString() });
      return { termination: modelResult.termination, wallStart, prdTouched: prdTouchedRef.value };
    }

    const { reply } = modelResult;
    workingMessages.push({ role: "assistant", content: reply.content, tool_calls: reply.tool_calls });

    if (reply.tool_calls !== undefined && reply.tool_calls.length > 0) {
      await dispatchToolCalls(reply.tool_calls, mcp, mcpTools, workingMessages, prdTouchedRef);
      continue;
    }

    if (typeof reply.content === "string") {
      sink({ kind: "final", content: reply.content, at: now().toISOString() });
      return { termination: "final", wallStart, prdTouched: prdTouchedRef.value };
    }

    console.error("LLM returned neither tool_calls nor string content");
    sink({ kind: "final", content: UNEXPECTED_ERROR_MESSAGE, at: now().toISOString() });
    return { termination: "unexpected", wallStart, prdTouched: prdTouchedRef.value };
  }
}

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

async function runSupervisorStage(
  sessionId: string,
  session: SessionWithSummary,
  llm: LlmClient,
  mcp: McpClient,
  config: TurnDeps["config"],
  now: () => Date,
  sink: StreamSink,
): Promise<LoopResult> {
  const mcpTools = await mcp.listTools();
  const systemContent = `${buildSupervisorPrompt()}\n\nThe session_id for every MCP tool call in this session is: ${sessionId}`;
  const workingMessages: WorkingMessage[] = [
    { role: "system", content: systemContent },
    ...session.messages,
  ];
  return await runToolCallLoop(llm, mcp, mcpTools, config, workingMessages, now, sink);
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
}): Promise<string> {
  const { sessionId, userText, deps } = opts;
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

    const buffered = createBufferedSink();

    const classification = await classifyTurn({
      llm,
      models: config.models,
      prd: session.prd,
      summary: session.summary,
      recentMessages: session.messages.slice(-3),
    });

    buffered.sink({
      kind: "thinking",
      agentRole: "orchestrator",
      content: `classified: needsPrdWork=${String(classification.needsPrdWork)}`,
      at: now().toISOString(),
    });

    const routed: RouteDecision = classification.needsPrdWork ? "work" : "no_work";

    const { termination, wallStart, prdTouched } = await runSupervisorStage(
      sessionId, session, llm, mcp, config, now, buffered.sink,
    );

    const reply = buffered.getFinal() ?? UNEXPECTED_ERROR_MESSAGE;
    await persistReplyAndSummary(
      sessionId, session, reply, store, llm, config, now, routed, termination, wallStart, prdTouched,
    );
    return reply;
  } finally {
    mutex.release(sessionId);
  }
}
