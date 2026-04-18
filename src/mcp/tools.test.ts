import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createTools } from "./tools.js";
import { SECTION_KEYS } from "../shared/sections.js";
import type { PRD, Section } from "../shared/types.js";

function openTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      messages_json TEXT NOT NULL DEFAULT '[]',
      prd_json TEXT NOT NULL
    );
  `);
  return db;
}

function makePrd(overrides: Partial<Record<string, Partial<Section>>> = {}): PRD {
  const ts = "2026-01-01T00:00:00.000Z";
  const base: Section = { content: "", status: "empty", updatedAt: ts };
  const prd = {} as PRD;
  for (const key of SECTION_KEYS) {
    const override = overrides[key];
    prd[key] = override ? { ...base, ...override } : { ...base };
  }
  return prd;
}

function seedSession(
  db: Database.Database,
  id: string,
  prd: PRD = makePrd(),
): void {
  db.prepare(
    "INSERT INTO sessions (id, title, created_at, updated_at, messages_json, prd_json) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, "", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "[]", JSON.stringify(prd));
}

let db: Database.Database;
let tools: ReturnType<typeof createTools>;
const SESSION_ID = "test-session-1";

beforeEach(() => {
  db = openTestDb();
  tools = createTools(db);
});

describe("get_prd", () => {
  it("returns full PRD for a known session", () => {
    seedSession(db, SESSION_ID);
    const result = tools.get_prd({ session_id: SESSION_ID });
    expect("error" in result).toBe(false);
    for (const key of SECTION_KEYS) {
      expect((result as PRD)[key]).toBeDefined();
    }
  });

  it("returns session_not_found for unknown session", () => {
    const result = tools.get_prd({ session_id: "nonexistent" });
    expect(result).toMatchObject({ error: "session_not_found", session_id: "nonexistent" });
  });
});

describe("update_section", () => {
  it("happy path: updates content and returns updated section", () => {
    seedSession(db, SESSION_ID);
    const result = tools.update_section({
      session_id: SESSION_ID,
      key: "vision",
      content: "A great product vision",
    });
    expect("error" in result).toBe(false);
    const section = result as Section;
    expect(section.content).toBe("A great product vision");
    expect(section.status).toBe("draft");
  });

  it("rejects unknown section key", () => {
    seedSession(db, SESSION_ID);
    const result = tools.update_section({
      session_id: SESSION_ID,
      key: "risks",
      content: "some content",
    });
    expect(result).toMatchObject({ error: "unknown_section_key" });
    expect((result as { valid_keys: string[] }).valid_keys).toContain("vision");
  });

  it("rejects content over 10000 characters", () => {
    seedSession(db, SESSION_ID);
    const result = tools.update_section({
      session_id: SESSION_ID,
      key: "vision",
      content: "a".repeat(10001),
    });
    expect(result).toMatchObject({ error: "content_too_long", max: 10000, got: 10001 });
  });

  it("accepts content of exactly 10000 characters", () => {
    seedSession(db, SESSION_ID);
    const result = tools.update_section({
      session_id: SESSION_ID,
      key: "vision",
      content: "a".repeat(10000),
    });
    expect("error" in result).toBe(false);
  });

  it("rejects update on confirmed section without user_requested_revision", () => {
    seedSession(
      db,
      SESSION_ID,
      makePrd({ vision: { content: "original", status: "confirmed" } }),
    );
    const result = tools.update_section({
      session_id: SESSION_ID,
      key: "vision",
      content: "new content",
    });
    expect(result).toMatchObject({ error: "section_confirmed", key: "vision" });
  });

  it("allows update on confirmed section with user_requested_revision=true and drops status to draft", () => {
    seedSession(
      db,
      SESSION_ID,
      makePrd({ vision: { content: "original", status: "confirmed" } }),
    );
    const result = tools.update_section({
      session_id: SESSION_ID,
      key: "vision",
      content: "revised content",
      user_requested_revision: true,
    });
    expect("error" in result).toBe(false);
    const section = result as Section;
    expect(section.content).toBe("revised content");
    expect(section.status).toBe("draft");
  });

  it("rejects invalid status value with invalid_status error", () => {
    seedSession(db, SESSION_ID);
    const result = tools.update_section({
      session_id: SESSION_ID,
      key: "vision",
      content: "some content",
      status: "pending",
    });
    expect(result).toMatchObject({
      error: "invalid_status",
      valid_statuses: ["empty", "draft", "confirmed"],
    });
  });

  it("returns session_not_found for unknown session", () => {
    const result = tools.update_section({
      session_id: "nonexistent",
      key: "vision",
      content: "content",
    });
    expect(result).toMatchObject({ error: "session_not_found" });
  });
});

describe("list_empty_sections", () => {
  it("returns empty sections in declaration order", () => {
    seedSession(
      db,
      SESSION_ID,
      makePrd({
        vision: { content: "set", status: "draft" },
        goals: { content: "set", status: "draft" },
      }),
    );
    const result = tools.list_empty_sections({ session_id: SESSION_ID });
    expect(Array.isArray(result)).toBe(true);
    const keys = result as string[];
    expect(keys).not.toContain("vision");
    expect(keys).not.toContain("goals");
    expect(keys).toContain("problem");
    expect(keys).toContain("coreFeatures");

    const allEmpty = SECTION_KEYS.filter((k) => k !== "vision" && k !== "goals");
    expect(keys).toEqual(allEmpty);
  });

  it("returns session_not_found for unknown session", () => {
    const result = tools.list_empty_sections({ session_id: "nonexistent" });
    expect(result).toMatchObject({ error: "session_not_found" });
  });
});

describe("mark_confirmed", () => {
  it("happy path: sets status to confirmed and returns section", () => {
    seedSession(
      db,
      SESSION_ID,
      makePrd({ vision: { content: "A vision statement", status: "draft" } }),
    );
    const result = tools.mark_confirmed({ session_id: SESSION_ID, key: "vision" });
    expect("error" in result).toBe(false);
    expect((result as Section).status).toBe("confirmed");
    expect((result as Section).content).toBe("A vision statement");
  });

  it("rejects confirming an empty section", () => {
    seedSession(db, SESSION_ID);
    const result = tools.mark_confirmed({ session_id: SESSION_ID, key: "vision" });
    expect(result).toMatchObject({ error: "cannot_confirm_empty_section", key: "vision" });
  });

  it("rejects whitespace-only content", () => {
    seedSession(
      db,
      SESSION_ID,
      makePrd({ vision: { content: "   ", status: "draft" } }),
    );
    const result = tools.mark_confirmed({ session_id: SESSION_ID, key: "vision" });
    expect(result).toMatchObject({ error: "cannot_confirm_empty_section" });
  });

  it("rejects unknown section key", () => {
    seedSession(db, SESSION_ID);
    const result = tools.mark_confirmed({ session_id: SESSION_ID, key: "risks" });
    expect(result).toMatchObject({ error: "unknown_section_key" });
  });

  it("returns session_not_found for unknown session", () => {
    const result = tools.mark_confirmed({ session_id: "nonexistent", key: "vision" });
    expect(result).toMatchObject({ error: "session_not_found" });
  });
});
