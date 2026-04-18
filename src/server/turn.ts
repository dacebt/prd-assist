import type { SessionStore } from "./sessions.js";
import type { LlmClient, AssistantMessage } from "./llm.js";
import type { McpClient } from "./mcpClient.js";
import { mcpToolsToOpenAi } from "./mcpClient.js";
import type { SessionMutex } from "./mutex.js";
import { buildSystemPrompt } from "./prompt.js";
import { deriveTitle } from "./deriveTitle.js";

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
const PER_CALL_TIMEOUT_MESSAGE =
  "The model took too long to respond. Please try again.";
const WALL_CLOCK_MESSAGE =
  "I ran out of time on that turn. Please try again.";
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

  let assistantContent = UNEXPECTED_ERROR_MESSAGE;

  try {
    const session = store.getSession(sessionId);
    if (session === null) {
      throw new SessionNotFoundError(sessionId);
    }

    const ts = now().toISOString();
    session.messages.push({ role: "user", content: userText, at: ts });
    session.updatedAt = ts;

    if (session.title === "") {
      session.title = deriveTitle(userText);
    }

    store.persistUserMessage(session);

    const mcpTools = await mcp.listTools();
    const tools = mcpToolsToOpenAi(mcpTools);

    const systemContent =
      `${buildSystemPrompt()}\n\nThe session_id for every MCP tool call in this session is: ${sessionId}`;
    const workingMessages: WorkingMessage[] = [
      { role: "system", content: systemContent },
      ...session.messages,
    ];

    const wallStart = now().getTime();
    let iterationCount = 0;
    let termination: "final" | "iteration_cap" | "per_call_timeout" | "wall_clock" | "unexpected" =
      "unexpected";

    loop: while (true) {
      if (now().getTime() - wallStart > config.wallClockMs) {
        termination = "wall_clock";
        break loop;
      }

      if (iterationCount >= config.maxIterations) {
        termination = "iteration_cap";
        break loop;
      }

      iterationCount++;
      const signal = AbortSignal.timeout(config.perCallTimeoutMs);

      let reply: AssistantMessage;
      try {
        reply = await llm.chat({ model: config.model, messages: workingMessages, tools, signal });
      } catch (err) {
        if (signal.aborted) {
          termination = "per_call_timeout";
        } else {
          console.error("LLM chat error in handleTurn:", err);
          termination = "unexpected";
        }
        break loop;
      }

      workingMessages.push({ role: "assistant", content: reply.content, tool_calls: reply.tool_calls });

      if (reply.tool_calls !== undefined && reply.tool_calls.length > 0) {
        for (const call of reply.tool_calls) {
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

          const validToolNames = mcpTools.map((t) => t.name);
          if (!validToolNames.includes(call.function.name)) {
            toolResult = {
              error: "unknown_tool",
              name: call.function.name,
              valid_tools: validToolNames,
            };
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

        continue;
      }

      if (typeof reply.content === "string") {
        assistantContent = reply.content;
        termination = "final";
        break loop;
      }

      console.error("LLM returned neither tool_calls nor string content");
      termination = "unexpected";
      break loop;
    }

    if (termination !== "final") {
      if (termination === "iteration_cap") {
        assistantContent = ITERATION_CAP_MESSAGE;
      } else if (termination === "per_call_timeout") {
        assistantContent = PER_CALL_TIMEOUT_MESSAGE;
      } else if (termination === "wall_clock") {
        assistantContent = WALL_CLOCK_MESSAGE;
      } else {
        assistantContent = UNEXPECTED_ERROR_MESSAGE;
      }
    }

    const replyTs = now().toISOString();
    session.messages.push({ role: "assistant", content: assistantContent, at: replyTs });
    session.updatedAt = replyTs;
    store.persistAssistantMessage(session);

    return assistantContent;
  } finally {
    mutex.release(sessionId);
  }
}
