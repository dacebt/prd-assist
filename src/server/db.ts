import Database from "better-sqlite3";

export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      messages_json TEXT NOT NULL DEFAULT '[]',
      prd_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_updated_at_idx ON sessions(updated_at DESC);
  `);
  return db;
}
