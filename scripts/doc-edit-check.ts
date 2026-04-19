import { existsSync, mkdirSync, rmSync } from "node:fs";
import { startServer } from "../src/server/server";
import { createOpenAiLlmClient } from "../src/server/llm";
import { createSessionMutex } from "../src/server/mutex";
import type { PRD } from "@prd-assist/shared";

const HARNESS_SQLITE = "./tmp/harness.sqlite";
const LM_STUDIO_BASE_URL = process.env["LM_STUDIO_BASE_URL"] ?? "http://localhost:1234/v1";
const LM_STUDIO_MODEL = process.env["LM_STUDIO_MODEL"] ?? "google/gemma-4-26b-a4b";
const LM_STUDIO_UNREACHABLE =
  "LM Studio not reachable — start it and load the configured model before running this script.";

async function waitForHealth(baseUrl: string, port: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 10_000) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Server health check timed out");
}

async function checkLmStudio(): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${LM_STUDIO_BASE_URL}/models`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`LM Studio responded with ${res.status}`);
  } catch {
    console.error(LM_STUDIO_UNREACHABLE);
    process.exit(2);
  }
}

async function postMessage(
  port: number,
  sessionId: string,
  text: string,
): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /messages failed: ${res.status} ${body}`);
  }
  const data = await res.json() as { reply: string };
  return data.reply;
}

async function main(): Promise<void> {
  if (existsSync(HARNESS_SQLITE)) {
    rmSync(HARNESS_SQLITE);
  }
  mkdirSync("./tmp", { recursive: true });

  await checkLmStudio();

  const llm = createOpenAiLlmClient({ baseURL: LM_STUDIO_BASE_URL, apiKey: "lm-studio" });
  const mutex = createSessionMutex();

  let serverHandle: Awaited<ReturnType<typeof startServer>>;
  try {
    serverHandle = await startServer({
      sqlitePath: HARNESS_SQLITE,
      hostname: "127.0.0.1",
      port: 0,
      llm,
      mutex,
      model: LM_STUDIO_MODEL,
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(2);
  }

  const { port, close } = serverHandle;

  try {
    await waitForHealth(LM_STUDIO_BASE_URL, port);

    const createRes = await fetch(`http://127.0.0.1:${port}/api/sessions`, { method: "POST" });
    if (!createRes.ok) throw new Error(`Failed to create session: ${createRes.status}`);
    const { id: sessionId } = await createRes.json() as { id: string };

    console.log(`Session ID: ${sessionId}`);

    console.log("\nTurn 1: Setting vision...");
    const reply1 = await postMessage(
      port,
      sessionId,
      "The product helps PMs draft PRDs with an AI assistant. Please put that in the vision.",
    );
    console.log("Turn 1 reply:", reply1);

    console.log("\nTurn 2: Adding core features...");
    const reply2 = await postMessage(
      port,
      sessionId,
      "Add to the core features: 1) real-time PRD pane. 2) section-by-section editing.",
    );
    console.log("Turn 2 reply:", reply2);

    console.log("\nTurn 3: Adding more core features...");
    const reply3 = await postMessage(
      port,
      sessionId,
      "Also add to core features: 3) session autosave.",
    );
    console.log("Turn 3 reply:", reply3);

    const sessionRes = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}`);
    if (!sessionRes.ok) throw new Error(`Failed to fetch session: ${sessionRes.status}`);
    const finalSession = await sessionRes.json() as { prd: PRD };
    const prd = finalSession.prd;

    const coreFeaturesContent = prd.coreFeatures?.content ?? "";
    const visionContent = prd.vision?.content ?? "";

    const bulletPattern = /^\s*(-|\*|\d+\.)\s+/m;
    const bulletLines = coreFeaturesContent.split("\n").filter((line) =>
      bulletPattern.test(line),
    );
    const bulletCount = bulletLines.length;

    console.log("\n=== HARNESS RESULTS ===");
    console.log("\nvision.content:");
    console.log(visionContent);
    console.log("\ncoreFeatures.content:");
    console.log(coreFeaturesContent);
    console.log(`\nBullet count in coreFeatures: ${bulletCount}`);
    console.log("\nFull PRD JSON:");
    console.log(JSON.stringify(prd, null, 2));
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error("Harness failed:", err);
  process.exit(2);
});
