import { startServer } from "./server";
import { createOpenAiLlmClient } from "./llm";
import { createSessionMutex } from "./mutex";

const SHUTDOWN_TIMEOUT_MS = 3000;

async function main(): Promise<void> {
  const sqlitePath = process.env["SQLITE_PATH"] ?? "./data/prd-assist.sqlite";
  const baseURL = process.env["LM_STUDIO_BASE_URL"] ?? "http://localhost:1234/v1";
  const model = process.env["LM_STUDIO_MODEL"] ?? "google/gemma-4-26b-a4b";

  const llm = createOpenAiLlmClient({ baseURL, apiKey: "lm-studio" });
  const mutex = createSessionMutex();

  const handle = await startServer({
    sqlitePath,
    hostname: "127.0.0.1",
    port: 5174,
    llm,
    mutex,
    model,
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`received ${signal}, shutting down`);
    const timer = setTimeout(() => {
      console.error(`shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms, force-exiting`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    handle.close().then(
      () => process.exit(0),
      (err) => {
        console.error("shutdown failed:", err);
        process.exit(1);
      },
    );
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});
