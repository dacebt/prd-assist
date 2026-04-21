import { describe, it, expect } from "vitest";
import { buildSupervisorPrompt } from "./supervisor";

const RULE_1 =
  "1. Before calling `update_section` on any section, you must know the section's current content. Call `get_prd` as the first tool call of every turn if you do not already have fresh PRD content from a tool result in this turn.";

const RULE_2 =
  "2. When updating a section, preserve all existing content in that section verbatim unless the user has explicitly asked in this turn to change or remove specific parts. Never rephrase, normalize, tighten, or improve prose that was not the subject of the user's request.";

const RULE_3 =
  "3. Do not call `update_section` on a section whose status is `confirmed` unless the user in this turn has explicitly asked to revise that section. When you do, set `user_requested_revision=true`.";

const RULE_4 =
  "4. Do not call `mark_confirmed` on a section whose content is empty. Do not call `mark_confirmed` on a section unless the user has reviewed the content in this conversation and has explicitly agreed it is complete.";

const RULE_5 =
  "5. Emit tool calls in the native OpenAI `tool_calls` format. Do not narrate tool calls as text in your assistant content.";

describe("buildSupervisorPrompt", () => {
  it("contains rule 1 verbatim", () => {
    expect(buildSupervisorPrompt()).toContain(RULE_1);
  });

  it("contains rule 2 verbatim", () => {
    expect(buildSupervisorPrompt()).toContain(RULE_2);
  });

  it("contains rule 3 verbatim", () => {
    expect(buildSupervisorPrompt()).toContain(RULE_3);
  });

  it("contains rule 4 verbatim", () => {
    expect(buildSupervisorPrompt()).toContain(RULE_4);
  });

  it("contains rule 5 verbatim", () => {
    expect(buildSupervisorPrompt()).toContain(RULE_5);
  });
});
