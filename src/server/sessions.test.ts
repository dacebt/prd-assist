import { describe, it, expect } from "vitest";
import { openDatabase } from "./db.js";
import { initialPrd, createSessionStore } from "./sessions.js";
import { SECTION_KEYS } from "../shared/sections.js";

describe("initialPrd", () => {
  it("returns all 7 sections with empty content and empty status", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const prd = initialPrd(now);

    expect(Object.keys(prd)).toHaveLength(7);
    for (const key of SECTION_KEYS) {
      expect(prd[key]).toEqual({
        content: "",
        status: "empty",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    }
  });
});

describe("createSessionStore", () => {
  it("create → getSession round-trip returns identical session", () => {
    const db = openDatabase(":memory:");
    const store = createSessionStore(db);
    const now = new Date("2026-01-15T10:00:00.000Z");

    const created = store.createSession(now);
    const retrieved = store.getSession(created.id);

    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(created.id);
    expect(retrieved?.title).toBe("");
    expect(retrieved?.createdAt).toBe(now.toISOString());
    expect(retrieved?.updatedAt).toBe(now.toISOString());
    expect(retrieved?.messages).toEqual([]);
    expect(retrieved?.prd).toEqual(created.prd);
  });

  it("getSession returns null for unknown id", () => {
    const db = openDatabase(":memory:");
    const store = createSessionStore(db);
    expect(store.getSession("no-such-id")).toBeNull();
  });

  it("listSessions orders by updatedAt DESC", () => {
    const db = openDatabase(":memory:");
    const store = createSessionStore(db);

    const first = store.createSession(new Date("2026-01-01T09:00:00.000Z"));
    const second = store.createSession(new Date("2026-01-01T11:00:00.000Z"));

    const list = store.listSessions();
    expect(list).toHaveLength(2);
    expect(list[0]?.id).toBe(second.id);
    expect(list[1]?.id).toBe(first.id);
  });
});
