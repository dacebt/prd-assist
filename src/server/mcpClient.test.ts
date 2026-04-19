import { describe, it, expect } from "vitest";
import { mcpToolsToOpenAi, type McpToolDescriptor } from "./mcpClient";

describe("mcpToolsToOpenAi", () => {
  it("maps each MCP tool descriptor to an OpenAI function-tool entry with parameters == inputSchema", () => {
    const schema = {
      type: "object",
      properties: { session_id: { type: "string" } },
      required: ["session_id"],
      additionalProperties: false,
    };
    const input: McpToolDescriptor[] = [
      { name: "get_prd", description: "Read the PRD.", inputSchema: schema },
    ];

    const output = mcpToolsToOpenAi(input);

    expect(output).toEqual([
      {
        type: "function",
        function: {
          name: "get_prd",
          description: "Read the PRD.",
          parameters: schema,
        },
      },
    ]);
    expect(output[0]?.function.parameters).toBe(schema);
  });

  it("preserves order and passes multiple tools through", () => {
    const input: McpToolDescriptor[] = [
      { name: "a", description: "first", inputSchema: { type: "object" } },
      { name: "b", description: "second", inputSchema: { type: "object" } },
      { name: "c", description: "third", inputSchema: { type: "object" } },
    ];

    const output = mcpToolsToOpenAi(input);

    expect(output.map((t) => t.function.name)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(mcpToolsToOpenAi([])).toEqual([]);
  });
});
