import type { Hono } from "hono";

export function register(app: Hono): void {
  app.get("/api/health", (c) => c.json({ ok: true }));
}
