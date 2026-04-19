import type { Hono } from "hono";
import { z } from "zod";
import { withParam } from "../middleware/validate";
import type { InternalRouteDeps } from "./index";

const IdParamSchema = z.object({
  id: z.string().min(1),
});

export function register(app: Hono, deps: InternalRouteDeps): void {
  app.get("/api/sessions", (c) => {
    return c.json(deps.store.listSessions());
  });

  app.post("/api/sessions", (c) => {
    const session = deps.store.createSession(deps.now());
    return c.json({ id: session.id }, 201);
  });

  app.get("/api/sessions/:id", withParam(IdParamSchema), (c) => {
    const { id } = c.get("param") as z.infer<typeof IdParamSchema>;
    const session = deps.store.getSession(id);
    if (session === null) {
      return c.json({ error: "session_not_found" }, 404);
    }
    return c.json(session);
  });
}
