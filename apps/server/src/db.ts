import Database from "better-sqlite3";

export class SchemaVersionCorruptError extends Error {
  constructor(rowCount: number) {
    super(`schema_version has ${rowCount} rows`);
    this.name = "SchemaVersionCorruptError";
  }
}

const MIGRATIONS: Array<{ target: number; up: string }> = [
  { target: 1, up: "ALTER TABLE sessions ADD COLUMN prd_summary TEXT" },
];

function runMigrations(db: Database.Database): void {
  const countRow = db.prepare("SELECT COUNT(*) as count FROM schema_version").get() as {
    count: number;
  };
  if (countRow.count > 1) {
    throw new SchemaVersionCorruptError(countRow.count);
  }

  let currentVersion: number;
  if (countRow.count === 0) {
    db.prepare("INSERT INTO schema_version (id, version) VALUES (1, 0)").run();
    currentVersion = 0;
  } else {
    const versionRow = db
      .prepare("SELECT version FROM schema_version WHERE id = 1")
      .get() as { version: number };
    currentVersion = versionRow.version;
  }

  for (const migration of MIGRATIONS) {
    if (currentVersion >= migration.target) continue;

    db.transaction(() => {
      try {
        db.exec(migration.up);
      } catch (err) {
        if (
          err instanceof Error &&
          "code" in err &&
          (err as NodeJS.ErrnoException).code === "SQLITE_ERROR" &&
          /duplicate column name/i.test(err.message)
        ) {
          // fresh DB already has the column from CREATE TABLE DDL; safe to skip
        } else {
          throw err;
        }
      }
      db.prepare("UPDATE schema_version SET version = ? WHERE id = 1").run(migration.target);
      currentVersion = migration.target;
    })();
  }
}

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
      prd_json TEXT NOT NULL,
      prd_summary TEXT
    );
    CREATE INDEX IF NOT EXISTS sessions_updated_at_idx ON sessions(updated_at DESC);
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL
    );
  `);
  runMigrations(db);
  return db;
}
