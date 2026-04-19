import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openDatabase } from "./db";
import { createSessionStore } from "./sessions";
import { registerRoutes } from "./routes";
import { createMcpClient } from "./mcpClient";
import type { LlmClient } from "./llm";
import type { SessionMutex } from "./mutex";

export interface ServerOptions {
  sqlitePath: string;
  hostname: string;
  port: number;
  llm: LlmClient;
  mutex: SessionMutex;
  model: string;
}

export async function startServer(
  opts: ServerOptions,
): Promise<{ port: number; close: () => Promise<void> }> {
  if (opts.sqlitePath !== ":memory:") {
    mkdirSync(dirname(opts.sqlitePath), { recursive: true });
  }

  const db = openDatabase(opts.sqlitePath);
  const store = createSessionStore(db);

  const mcp = await createMcpClient(opts.sqlitePath);

  const app = new Hono();

  registerRoutes(app, {
    store,
    llm: opts.llm,
    mcp,
    mutex: opts.mutex,
    model: opts.model,
    now: () => new Date(),
  });

  return new Promise((resolve) => {
    const server = serve(
      { fetch: app.fetch, hostname: opts.hostname, port: opts.port },
      (info) => {
        console.log(`listening on ${info.address}:${info.port}`);
        resolve({
          port: info.port,
          async close() {
            await mcp.close();
            await new Promise<void>((res) => server.close(() => res()));
            db.close();
          },
        });
      },
    );
  });
}
