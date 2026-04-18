import { Hono } from "hono";
import { z } from "zod";
import type { SessionStore } from "./sessions.js";
import type { LlmClient } from "./llm.js";
import type { SessionMutex } from "./mutex.js";
import { handleTurn, SessionBusyError, SessionNotFoundError } from "./turn.js";
import type { TurnDeps } from "./turn.js";
const IdParamSchema = z.object({
  id: z.string().min(1),
});

const PostMessageBodySchema = z.object({
  text: z
    .string()
    .refine((s) => s.trim().length >= 1, { message: "text must not be empty after trimming" })
    .refine((s) => s.trim().length <= 10000, {
      message: "text must be at most 10000 characters after trimming",
    }),
});

export interface RouteDeps {
  store: SessionStore;
  llm: LlmClient;
  mutex: SessionMutex;
  model: string;
  now: () => Date;
}

export function registerRoutes(app: Hono, deps: RouteDeps): void {
  const { store, llm, mutex, model, now } = deps;

  const turnDeps: TurnDeps = {
    store,
    llm,
    mutex,
    now,
    config: {
      model,
      maxIterations: 6,
      perCallTimeoutMs: 90_000,
      wallClockMs: 300_000,
    },
  };

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/sessions", (c) => {
    const sessions = store.listSessions();
    return c.json(sessions);
  });

  app.post("/api/sessions", (c) => {
    const session = store.createSession(new Date());
    return c.json({ id: session.id }, 201);
  });

  app.get("/api/sessions/:id", (c) => {
    const paramResult = IdParamSchema.safeParse(c.req.param());
    if (!paramResult.success) {
      return c.json({ error: "session_not_found" }, 404);
    }
    const session = store.getSession(paramResult.data.id);
    if (session === null) {
      return c.json({ error: "session_not_found" }, 404);
    }
    return c.json(session);
  });

  app.post("/api/sessions/:id/messages", async (c) => {
    const contentLength = c.req.raw.headers.get("content-length");
    if (contentLength !== null && parseInt(contentLength, 10) > 64 * 1024) {
      return c.json({ error: "payload_too_large" }, 413);
    }

    const paramResult = IdParamSchema.safeParse(c.req.param());
    if (!paramResult.success) {
      return c.json({ error: "session_not_found" }, 404);
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request", details: ["invalid JSON"] }, 400);
    }

    const bodyResult = PostMessageBodySchema.safeParse(rawBody);
    if (!bodyResult.success) {
      return c.json({ error: "invalid_request", details: bodyResult.error.issues }, 400);
    }

    const sessionId = paramResult.data.id;
    const userText = bodyResult.data.text;

    try {
      const reply = await handleTurn({ sessionId, userText, deps: turnDeps });
      return c.json({ reply });
    } catch (err) {
      if (err instanceof SessionBusyError) {
        return c.json({ error: "session_busy" }, 409);
      }
      if (err instanceof SessionNotFoundError) {
        return c.json({ error: "session_not_found" }, 404);
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("POST /messages unexpected error:", err);
      return c.json({ error: "internal", message }, 500);
    }
  });

  if (process.env["NODE_ENV"] !== "production") {
    app.post("/api/debug/tool-calling-smoke", async (c) => {
      try {
        const result = await llm.chat({
          model,
          messages: [
            {
              role: "system",
              content: "When asked to echo something, call the echo tool with the provided text.",
            },
            { role: "user", content: "Please call the echo tool with text 'hi'." },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "echo",
                description: "Echoes the provided text.",
                parameters: {
                  type: "object",
                  properties: { text: { type: "string" } },
                  required: ["text"],
                },
              },
            },
          ],
        });
        return c.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return c.json({ error: "smoke_test_failed", message });
      }
    });
  }

}
