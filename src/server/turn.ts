import type { SessionStore } from "./sessions.js";
import type { LlmClient, AssistantMessage } from "./llm.js";
import { LlmResponseShapeError } from "./llm.js";
import type { SessionMutex } from "./mutex.js";
import { buildSystemPrompt } from "./prompt.js";
import { deriveTitle } from "./deriveTitle.js";

export type TurnDeps = {
  store: SessionStore;
  llm: LlmClient;
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

const PER_CALL_TIMEOUT_MESSAGE =
  "The model took too long to respond. Please try again.";
const UNEXPECTED_ERROR_MESSAGE =
  "Something went wrong while processing that turn. See server logs for details.";

export async function handleTurn(opts: {
  sessionId: string;
  userText: string;
  deps: TurnDeps;
}): Promise<string> {
  const { sessionId, userText, deps } = opts;
  const { store, llm, mutex, now, config } = deps;

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

    if (session.title === "") {
      session.title = deriveTitle(userText);
    }

    store.persistUserMessage(session);

    const llmMessages = [
      { role: "system", content: buildSystemPrompt() },
      ...session.messages,
    ];

    const signal = AbortSignal.timeout(config.perCallTimeoutMs);

    let assistantContent: string;

    try {
      const reply: AssistantMessage = await llm.chat({
        model: config.model,
        messages: llmMessages,
        signal,
      });

      if (typeof reply.content !== "string") {
        throw new LlmResponseShapeError("content is not a string");
      }

      assistantContent = reply.content;
    } catch (err) {
      if (signal.aborted) {
        assistantContent = PER_CALL_TIMEOUT_MESSAGE;
      } else if (err instanceof LlmResponseShapeError) {
        console.error("LLM response shape error:", err);
        assistantContent = UNEXPECTED_ERROR_MESSAGE;
      } else {
        console.error("Unexpected error in handleTurn:", err);
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
