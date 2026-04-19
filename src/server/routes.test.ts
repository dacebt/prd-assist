import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Hono } from "hono";
import { openDatabase } from "./db";
import { createSessionStore } from "./sessions";
import { registerRoutes, type RouteDeps } from "./routes";
import { createSessionMutex } from "./mutex";
import type { LlmClient } from "./llm";
import type { McpClient } from "./mcpClient";

function makeStubLlm(reply: string = "stub reply"): LlmClient {
  return {
    chat: () => Promise.resolve({ role: "assistant", content: reply }),
  };
}

function makeStubMcp(): McpClient {
  return {
    listTools: () => Promise.resolve([]),
    callTool: () => Promise.resolve({}),
    close: () => Promise.resolve(),
  };
}

function buildApp(llmOverride?: LlmClient) {
  const db = openDatabase(":memory:");
  const store = createSessionStore(db);
  const app = new Hono();
  const deps: RouteDeps = {
    store,
    llm: llmOverride ?? makeStubLlm(),
    mcp: makeStubMcp(),
    mutex: createSessionMutex(),
    model: "test-model",
    now: () => new Date("2026-01-01T10:00:00.000Z"),
  };
  registerRoutes(app, deps);
  return { app, store };
}

async function parseJson<T>(res: Response, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(await res.json());
}

describe("GET /api/sessions", () => {
  it("returns empty array when no sessions exist", async () => {
    const { app } = buildApp();
    const res = await app.fetch(new Request("http://localhost/api/sessions"));
    expect(res.status).toBe(200);
    const body = await parseJson(res, z.array(z.unknown()));
    expect(body).toEqual([]);
  });
});

describe("POST /api/sessions", () => {
  it("returns 201 with { id }", async () => {
    const { app } = buildApp();
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
    const { app } = buildApp();

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
    const { app } = buildApp();
    const res = await app.fetch(
      new Request("http://localhost/api/sessions/unknown-id"),
    );
    expect(res.status).toBe(404);
    const body = await parseJson(res, z.object({ error: z.string() }));
    expect(body.error).toBe("session_not_found");
  });
});

describe("POST /api/sessions/:id/messages", () => {
  it("returns 400 when text is empty string", async () => {
    const { app, store } = buildApp();
    const session = store.createSession(new Date());
    const res = await app.fetch(
      new Request(`http://localhost/api/sessions/${session.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await parseJson(res, z.object({ error: z.string() }));
    expect(body.error).toBe("invalid_request");
  });

  it("returns 400 when text is whitespace only", async () => {
    const { app, store } = buildApp();
    const session = store.createSession(new Date());
    const res = await app.fetch(
      new Request(`http://localhost/api/sessions/${session.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "   " }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when text exceeds 10000 trimmed characters", async () => {
    const { app, store } = buildApp();
    const session = store.createSession(new Date());
    const longText = "a".repeat(10001);
    const res = await app.fetch(
      new Request(`http://localhost/api/sessions/${session.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: longText }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await parseJson(res, z.object({ error: z.string() }));
    expect(body.error).toBe("invalid_request");
  });

  it("returns 404 for unknown session id", async () => {
    const { app } = buildApp();
    const res = await app.fetch(
      new Request("http://localhost/api/sessions/no-such-id/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      }),
    );
    expect(res.status).toBe(404);
    const body = await parseJson(res, z.object({ error: z.string() }));
    expect(body.error).toBe("session_not_found");
  });

  it("happy path returns 200 with { reply }", async () => {
    const { app, store } = buildApp(makeStubLlm("the reply content"));
    const session = store.createSession(new Date());
    const res = await app.fetch(
      new Request(`http://localhost/api/sessions/${session.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await parseJson(res, z.object({ reply: z.string() }));
    expect(body.reply).toBe("the reply content");
  });

  it("session after happy path has both user and assistant messages", async () => {
    const { app, store } = buildApp(makeStubLlm("assistant said this"));
    const session = store.createSession(new Date());
    await app.fetch(
      new Request(`http://localhost/api/sessions/${session.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "user said this" }),
      }),
    );
    const updated = store.getSession(session.id);
    expect(updated?.messages).toHaveLength(2);
    expect(updated?.messages[0]?.role).toBe("user");
    expect(updated?.messages[0]?.content).toBe("user said this");
    expect(updated?.messages[1]?.role).toBe("assistant");
    expect(updated?.messages[1]?.content).toBe("assistant said this");
  });

  it("concurrent POST to same session returns 409 immediately", async () => {
    let resolveFirst!: () => void;
    const slowLlm: LlmClient = {
      chat: () =>
        new Promise((resolve) => {
          resolveFirst = () => resolve({ role: "assistant", content: "done" });
        }),
    };

    const { app, store } = buildApp(slowLlm);
    const session = store.createSession(new Date());
    const url = `http://localhost/api/sessions/${session.id}/messages`;
    const body = JSON.stringify({ text: "hello" });
    const headers = { "content-type": "application/json" };

    const firstPromise = app.fetch(new Request(url, { method: "POST", headers, body }));
    await new Promise((r) => setTimeout(r, 10));

    const secondRes = await app.fetch(new Request(url, { method: "POST", headers, body }));
    expect(secondRes.status).toBe(409);
    const secondBody = await parseJson(secondRes, z.object({ error: z.string() }));
    expect(secondBody.error).toBe("session_busy");

    resolveFirst();
    const firstRes = await firstPromise;
    expect(firstRes.status).toBe(200);
  });
});

describe("POST /api/sessions (title derivation)", () => {
  it("sets title from first user message", async () => {
    const { app, store } = buildApp();
    const session = store.createSession(new Date());
    await app.fetch(
      new Request(`http://localhost/api/sessions/${session.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Build me a PRD assistant" }),
      }),
    );
    const updated = store.getSession(session.id);
    expect(updated?.title).toBe("Build me a PRD assistant");
  });
});
