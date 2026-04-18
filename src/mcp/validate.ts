import { z } from "zod";
import { SECTION_KEYS } from "../shared/sections.js";

// zod.enum requires a non-empty tuple literal — derive from SECTION_KEYS at type level.
export const SECTION_KEYS_ARRAY = SECTION_KEYS as unknown as [
  "vision",
  "problem",
  "targetUsers",
  "goals",
  "coreFeatures",
  "outOfScope",
  "openQuestions",
];

export const SectionKeySchema = z.enum(SECTION_KEYS_ARRAY);

export const SectionStatusSchema = z.enum(["empty", "draft", "confirmed"]);
