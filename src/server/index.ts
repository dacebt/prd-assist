import { startServer } from "./server";
import { createOpenAiLlmClient } from "./llm";
import { createSessionMutex } from "./mutex";

async function main(): Promise<void> {
  const sqlitePath = process.env["SQLITE_PATH"] ?? "./data/prd-assist.sqlite";
  const baseURL = process.env["LM_STUDIO_BASE_URL"] ?? "http://localhost:1234/v1";
  const model = process.env["LM_STUDIO_MODEL"] ?? "google/gemma-4-26b-a4b";

  const llm = createOpenAiLlmClient({ baseURL, apiKey: "lm-studio" });
  const mutex = createSessionMutex();

  await startServer({ sqlitePath, hostname: "127.0.0.1", port: 5174, llm, mutex, model });
}

main().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});
