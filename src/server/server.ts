import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openDatabase } from "./db.js";
import { createSessionStore } from "./sessions.js";
import { registerRoutes } from "./routes.js";
import type { LlmClient } from "./llm.js";
import type { SessionMutex } from "./mutex.js";

export interface ServerOptions {
  sqlitePath: string;
  hostname: string;
  port: number;
  llm: LlmClient;
  mutex: SessionMutex;
  model: string;
}

export function startServer(opts: ServerOptions): { close: () => void } {
  if (opts.sqlitePath !== ":memory:") {
    mkdirSync(dirname(opts.sqlitePath), { recursive: true });
  }

  const db = openDatabase(opts.sqlitePath);
  const store = createSessionStore(db);
  const app = new Hono();

  registerRoutes(app, {
    store,
    llm: opts.llm,
    mutex: opts.mutex,
    model: opts.model,
    now: () => new Date(),
  });

  const server = serve(
    { fetch: app.fetch, hostname: opts.hostname, port: opts.port },
    (info) => {
      console.log(`listening on ${info.address}:${info.port}`);
    },
  );

  return {
    close() {
      server.close();
      db.close();
    },
  };
}
