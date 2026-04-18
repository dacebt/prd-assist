import { z } from "zod";
import type { Session, SessionSummary } from "../../shared/types.js";

const SectionStatusSchema = z.enum(["empty", "draft", "confirmed"]);

const SectionSchema = z.object({
  content: z.string(),
  updatedAt: z.string(),
  status: SectionStatusSchema,
});

const PrdSchema = z.object({
  vision: SectionSchema,
  problem: SectionSchema,
  targetUsers: SectionSchema,
  goals: SectionSchema,
  coreFeatures: SectionSchema,
  outOfScope: SectionSchema,
  openQuestions: SectionSchema,
});

const ChatMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), content: z.string(), at: z.string() }),
  z.object({ role: z.literal("assistant"), content: z.string(), at: z.string() }),
]);

const SessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messages: z.array(ChatMessageSchema),
  prd: PrdSchema,
});

const SessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.string(),
});

const SessionListSchema = z.array(SessionSummarySchema);

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

const SendMessageResponseSchema = z.object({ reply: z.string() });

const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});

export async function sendMessage(sessionId: string, text: string): Promise<string> {
  const res = await fetch(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    let errorMessage = res.statusText;
    try {
      const errBody = ErrorResponseSchema.parse(await res.json());
      errorMessage = errBody.message ?? errBody.error;
    } catch {
      // fallback to statusText
    }
    throw new Error(errorMessage);
  }

  const body = SendMessageResponseSchema.parse(await res.json());
  return body.reply;
}
