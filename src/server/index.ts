import { serve } from "@hono/node-server";
import { Hono } from "hono";

function main(): void {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true }));

  serve(
    { fetch: app.fetch, hostname: "127.0.0.1", port: 5174 },
    (info) => {
      console.log(`listening on ${info.address}:${info.port}`);
    },
  );
}

main();
