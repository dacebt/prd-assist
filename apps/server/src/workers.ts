import type { LlmClient, LlmToolDescriptor, AssistantMessage } from "./llm";
import type { McpClient, McpToolDescriptor } from "./mcpClient";
import { mcpToolsToOpenAi } from "./mcpClient";
import type { ModelConfig } from "./config";
import type { StreamSink } from "./stream";
import type { LoopResult, Termination } from "./turn";
import type { PlannerTask } from "./plannerBig";
import { buildWorkerPrompt } from "./prompts";

const ITERATION_CAP_MESSAGE =
  "I hit a tool-call loop limit. Please rephrase your request or try a smaller step.";
const PER_CALL_TIMEOUT_MESSAGE = "The model took too long to respond. Please try again.";
const WALL_CLOCK_MESSAGE = "I ran out of time on that turn. Please try again.";
const UNEXPECTED_ERROR_MESSAGE =
  "Something went wrong while processing that turn. See server logs for details.";

const PRD_MUTATING_TOOLS = new Set(["update_section", "mark_confirmed"]);

type WorkerMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: WorkerToolCall[] | undefined }
  | { role: "tool"; tool_call_id: string; content: string };

type WorkerToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ModelCallResult =
  | { outcome: "reply"; reply: AssistantMessage }
  | { outcome: "terminated"; termination: Exclude<Termination, "final"> };

async function callWorkerModel(
  llm: LlmClient,
  model: string,
  perCallTimeoutMs: number,
  messages: WorkerMessage[],
  tools: LlmToolDescriptor[],
): Promise<ModelCallResult> {
  const signal = AbortSignal.timeout(perCallTimeoutMs);
  try {
    const reply = await llm.chat({ model, messages, tools, signal });
    return { outcome: "reply", reply };
  } catch (err) {
    if (signal.aborted) {
      return { outcome: "terminated", termination: "per_call_timeout" };
    }
    console.error("worker chat error:", err);
    return { outcome: "terminated", termination: "unexpected" };
  }
}

async function invokeWorkerTool(
  call: WorkerToolCall,
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

export async function runWorkerStage(opts: {
  task: PlannerTask;
  sessionId: string;
  llm: LlmClient;
  mcp: McpClient;
  models: ModelConfig;
  wallClockMs: number;
  now: () => Date;
  sink: StreamSink;
}): Promise<LoopResult> {
  const { task, sessionId, llm, mcp, models, wallClockMs, now, sink } = opts;
  const wallStart = now().getTime();

  sink({
    kind: "thinking",
    agentRole: "worker",
    content: `editing ${task.sectionKey}`,
    at: now().toISOString(),
  });

  const mcpTools = await mcp.listTools();
  const tools = mcpToolsToOpenAi(mcpTools);
  const validToolNames = mcpTools.map((t: McpToolDescriptor) => t.name);

  const systemContent = `${buildWorkerPrompt()}\n\nThe session_id for every MCP tool call in this session is: ${sessionId}\n\nYour task:\nSection: ${task.sectionKey}\nInstruction: ${task.instruction}`;

  const workingMessages: WorkerMessage[] = [{ role: "system", content: systemContent }];

  let iterationCount = 0;
  const prdTouchedRef = { value: false };

  for (;;) {
    if (now().getTime() - wallStart > wallClockMs) {
      sink({ kind: "final", content: WALL_CLOCK_MESSAGE, at: now().toISOString() });
      return { termination: "wall_clock", wallStart, prdTouched: prdTouchedRef.value };
    }

    if (iterationCount >= models.worker.maxIterations) {
      sink({ kind: "final", content: ITERATION_CAP_MESSAGE, at: now().toISOString() });
      return { termination: "iteration_cap", wallStart, prdTouched: prdTouchedRef.value };
    }

    iterationCount++;
    const modelResult = await callWorkerModel(
      llm,
      models.worker.model,
      models.worker.perCallTimeoutMs,
      workingMessages,
      tools,
    );

    if (modelResult.outcome === "terminated") {
      const msg =
        modelResult.termination === "per_call_timeout" ? PER_CALL_TIMEOUT_MESSAGE : UNEXPECTED_ERROR_MESSAGE;
      sink({ kind: "final", content: msg, at: now().toISOString() });
      return { termination: modelResult.termination, wallStart, prdTouched: prdTouchedRef.value };
    }

    const { reply } = modelResult;
    workingMessages.push({ role: "assistant", content: reply.content, tool_calls: reply.tool_calls });

    if (reply.tool_calls !== undefined && reply.tool_calls.length > 0) {
      for (const call of reply.tool_calls) {
        const toolResult = await invokeWorkerTool(call, mcp, validToolNames);
        workingMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(toolResult),
        });
        if (
          PRD_MUTATING_TOOLS.has(call.function.name) &&
          toolResult !== null &&
          typeof toolResult === "object" &&
          !("error" in toolResult)
        ) {
          prdTouchedRef.value = true;
        }
      }
      continue;
    }

    // Model replied with prose or null content — task is done; do not emit final here.
    // interviewerSmall is responsible for the user-facing final event.
    return { termination: "final", wallStart, prdTouched: prdTouchedRef.value };
  }
}
