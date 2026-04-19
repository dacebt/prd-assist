import { z } from "zod";
import { SECTION_KEYS_ARRAY } from "./sections";

export const SectionStatusSchema = z.enum(["empty", "draft", "confirmed"]);

export const SectionKeySchema = z.enum(SECTION_KEYS_ARRAY);

export const SectionSchema = z.object({
  content: z.string(),
  updatedAt: z.string(),
  status: SectionStatusSchema,
});

export const PrdSchema = z.object({
  vision: SectionSchema,
  problem: SectionSchema,
  targetUsers: SectionSchema,
  goals: SectionSchema,
  coreFeatures: SectionSchema,
  outOfScope: SectionSchema,
  openQuestions: SectionSchema,
});

export const ChatMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), content: z.string(), at: z.string() }),
  z.object({ role: z.literal("assistant"), content: z.string(), at: z.string() }),
]);

export const SessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messages: z.array(ChatMessageSchema),
  prd: PrdSchema,
});

export const SessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.string(),
});

export const SessionListSchema = z.array(SessionSummarySchema);
