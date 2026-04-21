import { describe, it, expect } from "vitest";
import { openDatabase } from "./db";
import { initialPrd, createSessionStore } from "./sessions";
import { SECTION_KEYS } from "@prd-assist/shared";
import type { PRD, SectionKey } from "@prd-assist/shared";

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
    expect(list[0]?.exchangeCount).toBe(0);
    expect(list[0]?.sectionsConfirmed).toBe(0);
    expect(list[1]?.exchangeCount).toBe(0);
    expect(list[1]?.sectionsConfirmed).toBe(0);
  });

  it("exchangeCount counts only user messages", () => {
    const db = openDatabase(":memory:");
    const store = createSessionStore(db);
    const now = new Date("2026-02-01T00:00:00.000Z");
    const ts = now.toISOString();

    const session = store.createSession(now);
    const withMessages = {
      ...session,
      updatedAt: ts,
      messages: [
        { role: "user" as const, content: "hi", at: ts },
        { role: "assistant" as const, content: "hello", at: ts },
        { role: "user" as const, content: "next", at: ts },
        { role: "assistant" as const, content: "sure", at: ts },
        { role: "user" as const, content: "done", at: ts },
      ],
    };
    store.persistAssistantMessage(withMessages);

    const list = store.listSessions();
    const summary = list.find((s) => s.id === session.id);
    expect(summary?.exchangeCount).toBe(3);
  });

  it("deleteSession removes existing row", () => {
    const db = openDatabase(":memory:");
    const store = createSessionStore(db);
    const session = store.createSession(new Date("2026-03-01T00:00:00.000Z"));

    store.deleteSession(session.id);

    expect(store.getSession(session.id)).toBeNull();
    expect(store.listSessions().some((s) => s.id === session.id)).toBe(false);
  });

  it("deleteSession on unknown id is no-op", () => {
    const db = openDatabase(":memory:");
    const store = createSessionStore(db);
    store.createSession(new Date("2026-03-01T00:00:00.000Z"));

    expect(() => store.deleteSession("no-such-id")).not.toThrow();
    expect(store.listSessions()).toHaveLength(1);
  });

  it("sectionsConfirmed counts sections with status confirmed", () => {
    const db = openDatabase(":memory:");
    const store = createSessionStore(db);
    const now = new Date("2026-02-01T00:00:00.000Z");
    const ts = now.toISOString();

    const session = store.createSession(now);

    const confirmedKeys: SectionKey[] = ["vision", "problem", "goals"];
    const prd: PRD = { ...session.prd };
    for (const key of confirmedKeys) {
      prd[key] = { ...prd[key], status: "confirmed" };
    }
    db.prepare("UPDATE sessions SET prd_json = ? WHERE id = ?").run(
      JSON.stringify(prd),
      session.id,
    );

    const list = store.listSessions();
    const summary = list.find((s) => s.id === session.id);
    expect(summary?.sectionsConfirmed).toBe(3);
    expect(summary?.createdAt).toBe(ts);
  });
});
