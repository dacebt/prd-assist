import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { openDatabase, SchemaVersionCorruptError } from "./db";

function tempDbPath(): string {
  return path.join(os.tmpdir(), `prd-assist-test-${crypto.randomUUID()}.sqlite`);
}

describe("openDatabase migrations", () => {
  it("fresh DB has prd_summary column and schema_version at 1", () => {
    const db = openDatabase(":memory:");

    const cols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{
      name: string;
      type: string;
    }>;
    const summaryCol = cols.find((c) => c.name === "prd_summary");
    expect(summaryCol).toBeDefined();
    expect(summaryCol?.type).toBe("TEXT");

    const version = db
      .prepare("SELECT version FROM schema_version WHERE id = 1")
      .get() as { version: number };
    expect(version.version).toBe(1);

    const count = db
      .prepare("SELECT COUNT(*) as count FROM schema_version")
      .get() as { count: number };
    expect(count.count).toBe(1);

    db.close();
  });

  it("pre-S2 DB (no prd_summary, no schema_version) is migrated on open", () => {
    const dbPath = tempDbPath();
    try {
      // Simulate a pre-S2 DB: sessions table without prd_summary, no schema_version
      const raw = new Database(dbPath);
      raw.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          messages_json TEXT NOT NULL DEFAULT '[]',
          prd_json TEXT NOT NULL
        );
        INSERT INTO sessions (id, title, created_at, updated_at, messages_json, prd_json)
        VALUES ('existing-row', 'Test', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '[]', '{}');
      `);
      raw.close();

      const db = openDatabase(dbPath);

      const cols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
      expect(cols.some((c) => c.name === "prd_summary")).toBe(true);

      const version = db
        .prepare("SELECT version FROM schema_version WHERE id = 1")
        .get() as { version: number };
      expect(version.version).toBe(1);

      // Existing row preserved with prd_summary NULL
      const row = db
        .prepare("SELECT prd_summary FROM sessions WHERE id = 'existing-row'")
        .get() as { prd_summary: null };
      expect(row.prd_summary).toBeNull();

      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });

  it("migration is idempotent across restarts", () => {
    const dbPath = tempDbPath();
    try {
      const db1 = openDatabase(dbPath);
      db1.close();

      const db2 = openDatabase(dbPath);
      const version = db2
        .prepare("SELECT version FROM schema_version WHERE id = 1")
        .get() as { version: number };
      expect(version.version).toBe(1);

      const count = db2
        .prepare("SELECT COUNT(*) as count FROM schema_version")
        .get() as { count: number };
      expect(count.count).toBe(1);

      db2.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });

  it("corrupt schema_version (2 rows) throws SchemaVersionCorruptError", () => {
    const dbPath = tempDbPath();
    try {
      // First open to get to v1
      const db1 = openDatabase(dbPath);
      db1.close();

      // Bypass CHECK constraint by recreating the table with two rows
      const raw = new Database(dbPath);
      raw.exec(`
        DROP TABLE schema_version;
        CREATE TABLE schema_version (id INTEGER PRIMARY KEY, version INTEGER NOT NULL);
        INSERT INTO schema_version VALUES (1, 1);
        INSERT INTO schema_version VALUES (2, 1);
      `);
      raw.close();

      expect(() => openDatabase(dbPath)).toThrow(SchemaVersionCorruptError);
      expect(() => openDatabase(dbPath)).toThrow("schema_version has 2 rows");
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });
});
