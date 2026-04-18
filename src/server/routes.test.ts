import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Hono } from "hono";
import { openDatabase } from "./db.js";
import { createSessionStore } from "./sessions.js";
import { registerRoutes } from "./routes.js";

function buildApp() {
  const db = openDatabase(":memory:");
  const store = createSessionStore(db);
  const app = new Hono();
  registerRoutes(app, store);
  return app;
}

async function parseJson<T>(res: Response, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(await res.json());
}

describe("GET /api/sessions", () => {
  it("returns empty array when no sessions exist", async () => {
    const app = buildApp();
    const res = await app.fetch(new Request("http://localhost/api/sessions"));
    expect(res.status).toBe(200);
    const body = await parseJson(res, z.array(z.unknown()));
    expect(body).toEqual([]);
  });
});

describe("POST /api/sessions", () => {
  it("returns 201 with { id }", async () => {
    const app = buildApp();
    const res = await app.fetch(
      new Request("http://localhost/api/sessions", { method: "POST" }),
    );
    expect(res.status).toBe(201);
    const body = await parseJson(res, z.object({ id: z.string() }));
    expect(body.id.length).toBeGreaterThan(0);
  });
});

describe("GET /api/sessions/:id", () => {
  it("returns the session after creation", async () => {
    const app = buildApp();

    const createRes = await app.fetch(
      new Request("http://localhost/api/sessions", { method: "POST" }),
    );
    const { id } = await parseJson(createRes, z.object({ id: z.string() }));

    const getRes = await app.fetch(new Request(`http://localhost/api/sessions/${id}`));
    expect(getRes.status).toBe(200);
    const session = await parseJson(getRes, z.object({ id: z.string() }));
    expect(session.id).toBe(id);
  });

  it("returns 404 with error session_not_found for unknown id", async () => {
    const app = buildApp();
    const res = await app.fetch(
      new Request("http://localhost/api/sessions/unknown-id"),
    );
    expect(res.status).toBe(404);
    const body = await parseJson(res, z.object({ error: z.string() }));
    expect(body.error).toBe("session_not_found");
  });
});
