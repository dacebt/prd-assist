import type Database from "better-sqlite3";
import { z } from "zod";
import type { PRD, Section, Session, SessionSummary } from "@prd-assist/shared";
import { SECTION_KEYS } from "@prd-assist/shared";
import { ChatMessageSchema, PrdSchema } from "@prd-assist/shared/schemas";

const MessagesSchema = z.array(ChatMessageSchema);

const SessionRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  messages_json: z.string(),
  prd_json: z.string(),
});

export interface SessionStore {
  createSession(now: Date): Session;
  listSessions(): SessionSummary[];
  getSession(id: string): Session | null;
  persistUserMessage(session: Session): void;
  persistAssistantMessage(session: Session): void;
}

export function initialPrd(now: Date): PRD {
  const ts = now.toISOString();
  const emptySection: Section = { content: "", status: "empty", updatedAt: ts };
  return Object.fromEntries(SECTION_KEYS.map((key) => [key, { ...emptySection }])) as PRD;
}

type Stmt = Database.Statement;

function sessionCreate(insert: Stmt, now: Date): Session {
  const id = crypto.randomUUID();
  const ts = now.toISOString();
  const prd = initialPrd(now);
  insert.run(id, "", ts, ts, "[]", JSON.stringify(prd));
  return { id, title: "", createdAt: ts, updatedAt: ts, messages: [], prd };
}

function deriveExchangeCount(messagesJson: string): number {
  const messages = MessagesSchema.parse(JSON.parse(messagesJson));
  return messages.filter((m) => m.role === "user").length;
}

function deriveSectionsConfirmed(prdJson: string): number {
  const prd = PrdSchema.parse(JSON.parse(prdJson));
  return SECTION_KEYS.filter((key) => prd[key].status === "confirmed").length;
}

function sessionList(listStmt: Stmt): SessionSummary[] {
  const rows = listStmt.all();
  return rows.map((row) => {
    const parsed = SessionRowSchema.parse(row);
    return {
      id: parsed.id,
      title: parsed.title,
      createdAt: parsed.created_at,
      updatedAt: parsed.updated_at,
      exchangeCount: deriveExchangeCount(parsed.messages_json),
      sectionsConfirmed: deriveSectionsConfirmed(parsed.prd_json),
    };
  });
}

function sessionGet(getStmt: Stmt, id: string): Session | null {
  const row = getStmt.get(id);
  if (row === undefined) return null;
  const parsed = SessionRowSchema.parse(row);
  const messages = MessagesSchema.parse(JSON.parse(parsed.messages_json));
  const prd = PrdSchema.parse(JSON.parse(parsed.prd_json));
  return {
    id: parsed.id,
    title: parsed.title,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
    messages,
    prd,
  };
}

function sessionPersistUser(persistUserStmt: Stmt, session: Session): void {
  persistUserStmt.run(
    JSON.stringify(session.messages),
    session.title,
    session.updatedAt,
    session.id,
  );
}

function sessionPersistAssistant(persistAssistantStmt: Stmt, session: Session): void {
  persistAssistantStmt.run(JSON.stringify(session.messages), session.updatedAt, session.id);
}

export function createSessionStore(db: Database.Database): SessionStore {
  const insert = db.prepare(
    "INSERT INTO sessions (id, title, created_at, updated_at, messages_json, prd_json) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const listStmt = db.prepare(
    "SELECT id, title, created_at, updated_at, messages_json, prd_json FROM sessions ORDER BY updated_at DESC",
  );
  const getStmt = db.prepare(
    "SELECT id, title, created_at, updated_at, messages_json, prd_json FROM sessions WHERE id = ?",
  );
  const persistUserStmt = db.prepare(
    "UPDATE sessions SET messages_json = ?, title = ?, updated_at = ? WHERE id = ?",
  );
  const persistAssistantStmt = db.prepare(
    "UPDATE sessions SET messages_json = ?, updated_at = ? WHERE id = ?",
  );

  return {
    createSession: (now) => sessionCreate(insert, now),
    listSessions: () => sessionList(listStmt),
    getSession: (id) => sessionGet(getStmt, id),
    persistUserMessage: (session) => sessionPersistUser(persistUserStmt, session),
    persistAssistantMessage: (session) => sessionPersistAssistant(persistAssistantStmt, session),
  };
}
