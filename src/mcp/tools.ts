import type Database from "better-sqlite3";
import { z } from "zod";
import type { PRD, Section, SectionKey } from "../shared/types.js";
import { SECTION_KEYS } from "../shared/sections.js";
import { SectionKeySchema, SectionStatusSchema, SECTION_KEYS_ARRAY } from "./validate.js";

const MAX_CONTENT_LENGTH = 10000;

const PrdRowSchema = z.object({
  prd_json: z.string(),
});

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

type GetPrdArgs = { session_id: string };
type UpdateSectionArgs = {
  session_id: string;
  key: string;
  content: string;
  status?: string;
  user_requested_revision?: boolean;
};
type ListEmptySectionsArgs = { session_id: string };
type MarkConfirmedArgs = { session_id: string; key: string };

type SessionNotFoundError = { error: "session_not_found"; session_id: string };
type UnknownSectionKeyError = { error: "unknown_section_key"; valid_keys: string[] };
type InvalidStatusError = { error: "invalid_status"; valid_statuses: string[] };
type ContentTooLongError = { error: "content_too_long"; max: number; got: number };
type SectionConfirmedError = { error: "section_confirmed"; key: string; hint: string };
type CannotConfirmEmptyError = { error: "cannot_confirm_empty_section"; key: string };

function sessionNotFound(session_id: string): SessionNotFoundError {
  return { error: "session_not_found", session_id };
}

function parsePrd(db: Database.Database, sessionId: string): PRD | SessionNotFoundError {
  const row = db
    .prepare("SELECT prd_json FROM sessions WHERE id = ?")
    .get(sessionId);
  if (row === undefined) return sessionNotFound(sessionId);
  const parsed = PrdRowSchema.parse(row);
  return PrdSchema.parse(JSON.parse(parsed.prd_json));
}

function writePrd(db: Database.Database, sessionId: string, prd: PRD): void {
  db.prepare("UPDATE sessions SET prd_json = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(prd),
    new Date().toISOString(),
    sessionId,
  );
}

export function createTools(db: Database.Database) {
  function get_prd(args: GetPrdArgs): PRD | SessionNotFoundError {
    return parsePrd(db, args.session_id);
  }

  function update_section(
    args: UpdateSectionArgs,
  ): Section | UnknownSectionKeyError | InvalidStatusError | ContentTooLongError | SectionConfirmedError | SessionNotFoundError {
    const keyResult = SectionKeySchema.safeParse(args.key);
    if (!keyResult.success) {
      return { error: "unknown_section_key", valid_keys: [...SECTION_KEYS_ARRAY] };
    }

    if (typeof args.content !== "string" || args.content.length > MAX_CONTENT_LENGTH) {
      return { error: "content_too_long", max: MAX_CONTENT_LENGTH, got: args.content.length };
    }

    let validatedStatus: Section["status"] | undefined;
    if (args.status !== undefined) {
      const statusResult = SectionStatusSchema.safeParse(args.status);
      if (!statusResult.success) {
        return { error: "invalid_status", valid_statuses: ["empty", "draft", "confirmed"] };
      }
      validatedStatus = statusResult.data;
    }

    const prdOrError = parsePrd(db, args.session_id);
    if ("error" in prdOrError) return prdOrError;
    const prd = prdOrError;

    const key = keyResult.data as SectionKey;
    const section = prd[key];

    if (section.status === "confirmed" && args.user_requested_revision !== true) {
      return {
        error: "section_confirmed",
        key: args.key,
        hint: "set user_requested_revision=true when the user has explicitly asked in this turn to revise this section",
      };
    }

    const updatedSection: Section = {
      content: args.content,
      status: validatedStatus ?? "draft",
      updatedAt: new Date().toISOString(),
    };
    prd[key] = updatedSection;
    writePrd(db, args.session_id, prd);
    return updatedSection;
  }

  function list_empty_sections(
    args: ListEmptySectionsArgs,
  ): SectionKey[] | SessionNotFoundError {
    const prdOrError = parsePrd(db, args.session_id);
    if ("error" in prdOrError) return prdOrError;
    const prd = prdOrError;
    return SECTION_KEYS.filter((k) => prd[k].status === "empty");
  }

  function mark_confirmed(
    args: MarkConfirmedArgs,
  ): Section | UnknownSectionKeyError | CannotConfirmEmptyError | SessionNotFoundError {
    const keyResult = SectionKeySchema.safeParse(args.key);
    if (!keyResult.success) {
      return { error: "unknown_section_key", valid_keys: [...SECTION_KEYS_ARRAY] };
    }

    const prdOrError = parsePrd(db, args.session_id);
    if ("error" in prdOrError) return prdOrError;
    const prd = prdOrError;

    const key = keyResult.data as SectionKey;
    const section = prd[key];

    if (section.content.trim().length === 0) {
      return { error: "cannot_confirm_empty_section", key: args.key };
    }

    const updatedSection: Section = {
      content: section.content,
      status: "confirmed",
      updatedAt: new Date().toISOString(),
    };
    prd[key] = updatedSection;
    writePrd(db, args.session_id, prd);
    return updatedSection;
  }

  return { get_prd, update_section, list_empty_sections, mark_confirmed };
}
