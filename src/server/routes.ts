import { Hono } from "hono";
import { z } from "zod";
import type { SessionStore } from "./sessions.js";

const IdParamSchema = z.object({
  id: z.string().min(1),
});

export function registerRoutes(app: Hono, store: SessionStore): void {
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
}
