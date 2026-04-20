import type { createTools } from "./tools";

export type ToolResultEnvelope = {
  content: [{ type: "text"; text: string }];
  isError: false;
};

export function dispatchTool(
  tools: ReturnType<typeof createTools>,
  name: string,
  args: Record<string, unknown>,
): ToolResultEnvelope {
  let result: unknown;
  if (name === "get_prd") {
    result = tools.get_prd(args as Parameters<typeof tools.get_prd>[0]);
  } else if (name === "update_section") {
    result = tools.update_section(args as Parameters<typeof tools.update_section>[0]);
  } else if (name === "list_empty_sections") {
    result = tools.list_empty_sections(args as Parameters<typeof tools.list_empty_sections>[0]);
  } else if (name === "mark_confirmed") {
    result = tools.mark_confirmed(args as Parameters<typeof tools.mark_confirmed>[0]);
  } else {
    result = { error: "unknown_tool", name };
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    isError: false,
  };
}
