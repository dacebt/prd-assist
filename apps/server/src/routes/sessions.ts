import type { Hono } from "hono";
import { parseParam } from "../middleware/validate";
import { IdParamSchema, type RouteDeps } from "./index";

export function register(app: Hono, deps: RouteDeps): void {
  app.get("/api/sessions", (c) => {
    return c.json(deps.store.listSessions());
  });

  app.post("/api/sessions", (c) => {
    const session = deps.store.createSession(deps.now());
    return c.json({ id: session.id }, 201);
  });

  app.get("/api/sessions/:id", (c) => {
    const parsed = parseParam(c, IdParamSchema);
    if (!parsed.ok) return parsed.response;
    const session = deps.store.getSession(parsed.data.id);
    if (session === null) {
      return c.json({ error: "session_not_found" }, 404);
    }
    const { summary: _summary, ...publicSession } = session;
    return c.json(publicSession);
  });

  app.delete("/api/sessions/:id", (c) => {
    const parsed = parseParam(c, IdParamSchema);
    if (!parsed.ok) return parsed.response;
    deps.store.deleteSession(parsed.data.id);
    return c.body(null, 204);
  });
}
