import type { SectionKey } from "./types";

export const SECTION_KEYS: readonly SectionKey[] = [
  "vision",
  "problem",
  "targetUsers",
  "goals",
  "coreFeatures",
  "outOfScope",
  "openQuestions",
];

export const SECTION_LABELS: Record<SectionKey, string> = {
  vision: "Vision",
  problem: "Problem",
  targetUsers: "Target Users",
  goals: "Goals",
  coreFeatures: "Core Features",
  outOfScope: "Out of Scope",
  openQuestions: "Open Questions",
};

export const SECTION_KEYS_ARRAY = SECTION_KEYS as unknown as [
  "vision",
  "problem",
  "targetUsers",
  "goals",
  "coreFeatures",
  "outOfScope",
  "openQuestions",
];
