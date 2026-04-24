import { z } from "zod";
import type { Session, SessionSummary } from "@prd-assist/shared";
import { SessionSchema, SessionListSchema } from "@prd-assist/shared/schemas";

const CreateSessionResponseSchema = z.object({ id: z.string() });

export async function fetchSessions(): Promise<SessionSummary[]> {
  const res = await fetch("/api/sessions");
  if (!res.ok) throw new Error(`fetch sessions failed: ${res.status}`);
  return SessionListSchema.parse(await res.json());
}

export async function createSession(): Promise<{ id: string }> {
  const res = await fetch("/api/sessions", { method: "POST" });
  if (!res.ok) throw new Error(`create session failed: ${res.status}`);
  return CreateSessionResponseSchema.parse(await res.json());
}

export async function fetchSession(id: string): Promise<Session> {
  const res = await fetch(`/api/sessions/${id}`);
  if (!res.ok) throw new Error(`fetch session failed: ${res.status}`);
  return SessionSchema.parse(await res.json());
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`delete session failed: ${res.status}`);
}

export interface SendMessageHandlers {
  onThinking: (args: { agentRole: string; content: string }) => void;
  onFinal: (args: { content: string }) => void;
}

// Parses SSE frames from a ReadableStream reader.
// Each SSE frame ends with a blank line (\n\n). Only "event:" and "data:" lines matter.
// Uses TextDecoder with stream:true so multi-byte UTF-8 chars split across chunks decode correctly.
export async function sendMessage(
  sessionId: string,
  text: string,
  handlers: SendMessageHandlers,
): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    throw new Error(`send message failed: ${res.status}`);
  }

  if (!res.body) {
    throw new Error("no response body");
  }

  const reader = res.body.getReader();
  // Persistent TextDecoder so multi-byte chars split across chunk boundaries decode correctly.
  const decoder = new TextDecoder("utf-8");

  // Accumulates raw text that may contain partial frames.
  let buffer = "";
  let receivedFinal = false;

  const processFrame = (frame: string): void => {
    let event = "";
    let data = "";
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        data = line.slice("data:".length).trim();
      }
    }
    if (event === "") return;

    if (event === "thinking") {
      const parsed = JSON.parse(data) as { agentRole: string; content: string };
      handlers.onThinking({ agentRole: parsed.agentRole, content: parsed.content });
    } else if (event === "final") {
      const parsed = JSON.parse(data) as { content: string };
      handlers.onFinal({ content: parsed.content });
      receivedFinal = true;
    } else if (event === "error") {
      const parsed = JSON.parse(data) as { error: string; message?: string };
      throw new Error(parsed.message ?? parsed.error);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Frames are separated by blank lines (\n\n).
      // Split on double newline and keep the last partial frame in the buffer.
      const parts = buffer.split("\n\n");
      // The last element is either empty (frame ended cleanly) or a partial frame.
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        if (part.trim() !== "") {
          processFrame(part);
        }
      }
    }

    // Flush any remaining content in the decoder.
    const remaining = decoder.decode();
    if (remaining) {
      buffer += remaining;
    }
    if (buffer.trim() !== "") {
      processFrame(buffer);
    }
  } finally {
    reader.releaseLock();
  }

  if (!receivedFinal) {
    throw new Error("stream ended without a final event");
  }
}
