import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { openMcpDatabase } from "./db.js";
import { createTools } from "./tools.js";
import { TOOLS_MANIFEST } from "./manifest.js";

async function main(): Promise<void> {
  const sqlitePath = process.env["SQLITE_PATH"] ?? "./data/prd-assist.sqlite";
  const db = openMcpDatabase(sqlitePath);
  const tools = createTools(db);

  const server = new Server(
    { name: "prd-assist-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => {
    return { tools: TOOLS_MANIFEST };
  });

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const { name, arguments: args } = request.params;
    const safeArgs: Record<string, unknown> = args ?? {};

    let result: unknown;
    if (name === "get_prd") {
      result = tools.get_prd(safeArgs as Parameters<typeof tools.get_prd>[0]);
    } else if (name === "update_section") {
      result = tools.update_section(
        safeArgs as Parameters<typeof tools.update_section>[0],
      );
    } else if (name === "list_empty_sections") {
      result = tools.list_empty_sections(
        safeArgs as Parameters<typeof tools.list_empty_sections>[0],
      );
    } else if (name === "mark_confirmed") {
      result = tools.mark_confirmed(
        safeArgs as Parameters<typeof tools.mark_confirmed>[0],
      );
    } else {
      result = { error: "unknown_tool", name };
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      isError: false,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`MCP server fatal error: ${String(err)}\n`);
  process.exit(1);
});
