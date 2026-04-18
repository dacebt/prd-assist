import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { openDatabase } from "../server/db.js";
import { createSessionStore } from "../server/sessions.js";
import { createTools } from "./tools.js";
import { dispatchTool } from "./dispatch.js";

function seed(): { db: Database.Database; sessionId: string } {
  const db = openDatabase(":memory:");
  const store = createSessionStore(db);
  const session = store.createSession(new Date("2026-01-01T00:00:00.000Z"));
  return { db, sessionId: session.id };
}

describe("dispatchTool wire format", () => {
  it("wraps a real get_prd invocation as { content: [{type:'text', text:<json>}], isError: false }", () => {
    const { db, sessionId } = seed();
    const tools = createTools(db);

    const envelope = dispatchTool(tools, "get_prd", { session_id: sessionId });

    expect(envelope.isError).toBe(false);
    expect(envelope.content).toHaveLength(1);
    expect(envelope.content[0].type).toBe("text");
    expect(typeof envelope.content[0].text).toBe("string");

    const parsed = JSON.parse(envelope.content[0].text) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "coreFeatures",
        "goals",
        "openQuestions",
        "outOfScope",
        "problem",
        "targetUsers",
        "vision",
      ].sort(),
    );
  });

  it("wraps structured errors with isError: false (errors carried in the JSON body)", () => {
    const { db, sessionId } = seed();
    const tools = createTools(db);

    const envelope = dispatchTool(tools, "update_section", {
      session_id: sessionId,
      key: "risks",
      content: "whatever",
    });

    expect(envelope.isError).toBe(false);
    const parsed = JSON.parse(envelope.content[0].text) as { error: string };
    expect(parsed.error).toBe("unknown_section_key");
  });

  it("wraps unknown tool names with unknown_tool in the JSON body (not in the MCP error channel)", () => {
    const { db } = seed();
    const tools = createTools(db);

    const envelope = dispatchTool(tools, "nonexistent_tool", {});

    expect(envelope.isError).toBe(false);
    const parsed = JSON.parse(envelope.content[0].text) as { error: string; name: string };
    expect(parsed.error).toBe("unknown_tool");
    expect(parsed.name).toBe("nonexistent_tool");
  });
});
