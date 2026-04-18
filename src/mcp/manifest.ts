import { SECTION_KEYS_ARRAY } from "./validate.js";

const KEY_ENUM = [...SECTION_KEYS_ARRAY] as [
  "vision",
  "problem",
  "targetUsers",
  "goals",
  "coreFeatures",
  "outOfScope",
  "openQuestions",
];

export const TOOLS_MANIFEST = [
  {
    name: "get_prd",
    description:
      "Read the full PRD with all seven sections, their current content, status, and last-updated timestamp. Call this as the first tool call of every turn so you have fresh content before deciding what to do.",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string" } },
      required: ["session_id"],
      additionalProperties: false,
    },
  },
  {
    name: "update_section",
    description:
      "Write new content to one PRD section. Preserve existing content verbatim unless the user has explicitly asked in this turn to change or remove specific parts. Set user_requested_revision=true only when the user has explicitly asked in this turn to revise a section whose status is already confirmed. Unknown section keys are rejected.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        key: { type: "string", enum: KEY_ENUM },
        content: { type: "string", maxLength: 10000 },
        status: { type: "string", enum: ["empty", "draft", "confirmed"] },
        user_requested_revision: { type: "boolean" },
      },
      required: ["session_id", "key", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "list_empty_sections",
    description:
      "Return the keys of sections whose status is empty. Use this to decide which sections still need user input.",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string" } },
      required: ["session_id"],
      additionalProperties: false,
    },
  },
  {
    name: "mark_confirmed",
    description:
      "Mark a section as confirmed after the user has reviewed its content in this conversation and has explicitly agreed it is complete. Do not call this on a section whose content is empty. Do not call this without explicit user confirmation in the current turn.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        key: { type: "string", enum: KEY_ENUM },
      },
      required: ["session_id", "key"],
      additionalProperties: false,
    },
  },
] as const;
