import { startServer } from "./server.js";
import { createOpenAiLlmClient } from "./llm.js";
import { createSessionMutex } from "./mutex.js";

function main(): void {
  const sqlitePath = process.env["SQLITE_PATH"] ?? "./data/prd-assist.sqlite";
  const baseURL = process.env["LM_STUDIO_BASE_URL"] ?? "http://localhost:1234/v1";
  const model = process.env["LM_STUDIO_MODEL"] ?? "google/gemma-4-26b-a4b";

  const llm = createOpenAiLlmClient({ baseURL, apiKey: "lm-studio" });
  const mutex = createSessionMutex();

  startServer({ sqlitePath, hostname: "127.0.0.1", port: 5174, llm, mutex, model });
}

main();
