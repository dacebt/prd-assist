import type { SessionStore } from "./sessions";
import type { LlmClient, AssistantMessage, LlmToolDescriptor } from "./llm";
import type { McpClient, McpToolDescriptor } from "./mcpClient";
import { mcpToolsToOpenAi } from "./mcpClient";
import type { SessionMutex } from "./mutex";
import { buildSystemPrompt } from "./prompt";
import { deriveTitle } from "./deriveTitle";

export type TurnDeps = {
  store: SessionStore;
  llm: LlmClient;
  mcp: McpClient;
  mutex: SessionMutex;
  now: () => Date;
  config: {
    model: string;
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
    const reply = await llm.chat({ model: config.model, messages: workingMessages, tools, signal });
    return { outcome: "reply", reply };
  } catch (err) {
    if (signal.aborted) {
      return { outcome: "terminated", termination: "per_call_timeout" };
    }
    console.error("LLM chat error in handleTurn:", err);
    return { outcome: "terminated", termination: "unexpected" };
  }
}

async function dispatchToolCalls(
  toolCalls: ToolCallEntry[],
  mcp: McpClient,
  mcpTools: McpToolDescriptor[],
  workingMessages: WorkingMessage[],
): Promise<void> {
  const validToolNames = mcpTools.map((t) => t.name);
  for (const call of toolCalls) {
    let toolResult: unknown;
    let parsedArgs: Record<string, unknown>;

    try {
      parsedArgs = JSON.parse(call.function.arguments) as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toolResult = { error: "invalid_tool_arguments", message };
      workingMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(toolResult),
      });
      continue;
    }

    if (!validToolNames.includes(call.function.name)) {
      toolResult = { error: "unknown_tool", name: call.function.name, valid_tools: validToolNames };
      workingMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(toolResult),
      });
      continue;
    }

    try {
      toolResult = await mcp.callTool(call.function.name, parsedArgs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toolResult = { error: "tool_invocation_failed", name: call.function.name, message };
    }

    workingMessages.push({
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify(toolResult),
    });
  }
}

type LoopResult = { termination: Termination; assistantContent: string; wallStart: number };

async function runToolCallLoop(
  llm: LlmClient,
  mcp: McpClient,
  mcpTools: McpToolDescriptor[],
  config: TurnDeps["config"],
  workingMessages: WorkingMessage[],
  now: () => Date,
): Promise<LoopResult> {
  const tools = mcpToolsToOpenAi(mcpTools);
  const wallStart = now().getTime();
  let iterationCount = 0;

  for (;;) {
    if (now().getTime() - wallStart > config.wallClockMs) {
      return { termination: "wall_clock", assistantContent: WALL_CLOCK_MESSAGE, wallStart };
    }
    if (iterationCount >= config.maxIterations) {
      return { termination: "iteration_cap", assistantContent: ITERATION_CAP_MESSAGE, wallStart };
    }

    iterationCount++;
    const modelResult = await callModel(llm, config, workingMessages, tools);

    if (modelResult.outcome === "terminated") {
      const msg = terminationMessage(modelResult.termination);
      return { termination: modelResult.termination, assistantContent: msg, wallStart };
    }

    const { reply } = modelResult;
    workingMessages.push({
      role: "assistant",
      content: reply.content,
      tool_calls: reply.tool_calls,
    });

    if (reply.tool_calls !== undefined && reply.tool_calls.length > 0) {
      await dispatchToolCalls(reply.tool_calls, mcp, mcpTools, workingMessages);
      continue;
    }

    if (typeof reply.content === "string") {
      return { termination: "final", assistantContent: reply.content, wallStart };
    }

    console.error("LLM returned neither tool_calls nor string content");
    return { termination: "unexpected", assistantContent: UNEXPECTED_ERROR_MESSAGE, wallStart };
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

    const mcpTools = await mcp.listTools();
    const systemContent = `${buildSystemPrompt()}\n\nThe session_id for every MCP tool call in this session is: ${sessionId}`;
    const workingMessages: WorkingMessage[] = [
      { role: "system", content: systemContent },
      ...session.messages,
    ];

    const { termination, assistantContent, wallStart } = await runToolCallLoop(
      llm,
      mcp,
      mcpTools,
      config,
      workingMessages,
      now,
    );

    const replyTs = now().toISOString();
    session.messages.push({ role: "assistant", content: assistantContent, at: replyTs });
    session.updatedAt = replyTs;
    store.persistAssistantMessage(session);

    console.warn(
      `turn ${sessionId.slice(0, 8)} termination=${termination} elapsed_ms=${now().getTime() - wallStart}`,
    );

    return assistantContent;
  } finally {
    mutex.release(sessionId);
  }
}
