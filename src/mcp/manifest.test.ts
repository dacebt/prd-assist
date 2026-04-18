import { describe, it, expect } from "vitest";
import { TOOLS_MANIFEST } from "./manifest.js";
import { SECTION_KEYS_ARRAY } from "./validate.js";

const EXPECTED_SECTION_KEYS = [...SECTION_KEYS_ARRAY];

describe("TOOLS_MANIFEST", () => {
  it("exposes exactly four tool names", () => {
    const names = TOOLS_MANIFEST.map((t) => t.name);
    expect(names).toHaveLength(4);
    expect(names).toEqual(["get_prd", "update_section", "list_empty_sections", "mark_confirmed"]);
  });

  it("get_prd description matches spec verbatim", () => {
    const tool = TOOLS_MANIFEST.find((t) => t.name === "get_prd");
    expect(tool?.description).toBe(
      "Read the full PRD with all seven sections, their current content, status, and last-updated timestamp. Call this as the first tool call of every turn so you have fresh content before deciding what to do.",
    );
  });

  it("update_section description matches spec verbatim", () => {
    const tool = TOOLS_MANIFEST.find((t) => t.name === "update_section");
    expect(tool?.description).toBe(
      "Write new content to one PRD section. Preserve existing content verbatim unless the user has explicitly asked in this turn to change or remove specific parts. Set user_requested_revision=true only when the user has explicitly asked in this turn to revise a section whose status is already confirmed. Unknown section keys are rejected.",
    );
  });

  it("list_empty_sections description matches spec verbatim", () => {
    const tool = TOOLS_MANIFEST.find((t) => t.name === "list_empty_sections");
    expect(tool?.description).toBe(
      "Return the keys of sections whose status is empty. Use this to decide which sections still need user input.",
    );
  });

  it("mark_confirmed description matches spec verbatim", () => {
    const tool = TOOLS_MANIFEST.find((t) => t.name === "mark_confirmed");
    expect(tool?.description).toBe(
      "Mark a section as confirmed after the user has reviewed its content in this conversation and has explicitly agreed it is complete. Do not call this on a section whose content is empty. Do not call this without explicit user confirmation in the current turn.",
    );
  });

  it("update_section inputSchema.properties.key enum contains all seven section keys in declared order", () => {
    const tool = TOOLS_MANIFEST.find((t) => t.name === "update_section");
    const keyProp = (tool?.inputSchema as { properties: { key: { enum: string[] } } })
      .properties.key;
    expect(keyProp.enum).toEqual(EXPECTED_SECTION_KEYS);
  });

  it("mark_confirmed inputSchema.properties.key enum contains all seven section keys in declared order", () => {
    const tool = TOOLS_MANIFEST.find((t) => t.name === "mark_confirmed");
    const keyProp = (tool?.inputSchema as { properties: { key: { enum: string[] } } })
      .properties.key;
    expect(keyProp.enum).toEqual(EXPECTED_SECTION_KEYS);
  });
});
