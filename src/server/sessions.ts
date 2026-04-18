import Database from "better-sqlite3";
import { z } from "zod";
import type { PRD, Section, Session, SessionSummary } from "../shared/types.js";
import { SECTION_KEYS } from "../shared/sections.js";

const SectionSchema = z.object({
  content: z.string(),
  updatedAt: z.string(),
  status: z.enum(["empty", "draft", "confirmed"]),
});

const PrdSchema = z.object({
  vision: SectionSchema,
  problem: SectionSchema,
  targetUsers: SectionSchema,
  goals: SectionSchema,
  coreFeatures: SectionSchema,
  outOfScope: SectionSchema,
  openQuestions: SectionSchema,
});

const ChatMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), content: z.string(), at: z.string() }),
  z.object({ role: z.literal("assistant"), content: z.string(), at: z.string() }),
]);

const MessagesSchema = z.array(ChatMessageSchema);

const SessionRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  messages_json: z.string(),
  prd_json: z.string(),
});

const SessionSummaryRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  updated_at: z.string(),
});

export interface SessionStore {
  createSession(now: Date): Session;
  listSessions(): SessionSummary[];
  getSession(id: string): Session | null;
}

export function initialPrd(now: Date): PRD {
  const ts = now.toISOString();
  const emptySection: Section = { content: "", status: "empty", updatedAt: ts };
  const prd: PRD = {} as PRD;
  for (const key of SECTION_KEYS) {
    prd[key] = { ...emptySection };
  }
  return prd;
}

export function createSessionStore(db: Database.Database): SessionStore {
  const insert = db.prepare(
    "INSERT INTO sessions (id, title, created_at, updated_at, messages_json, prd_json) VALUES (?, ?, ?, ?, ?, ?)",
  );

  const listStmt = db.prepare(
    "SELECT id, title, updated_at FROM sessions ORDER BY updated_at DESC",
  );

  const getStmt = db.prepare(
    "SELECT id, title, created_at, updated_at, messages_json, prd_json FROM sessions WHERE id = ?",
  );

  return {
    createSession(now: Date): Session {
      const id = crypto.randomUUID();
      const ts = now.toISOString();
      const prd = initialPrd(now);
      const messages_json = "[]";
      const prd_json = JSON.stringify(prd);
      insert.run(id, "", ts, ts, messages_json, prd_json);
      return { id, title: "", createdAt: ts, updatedAt: ts, messages: [], prd };
    },

    listSessions(): SessionSummary[] {
      const rows = listStmt.all();
      return rows.map((row) => {
        const parsed = SessionSummaryRowSchema.parse(row);
        return { id: parsed.id, title: parsed.title, updatedAt: parsed.updated_at };
      });
    },

    getSession(id: string): Session | null {
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
    },
  };
}
