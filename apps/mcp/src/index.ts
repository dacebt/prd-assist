import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { openMcpDatabase } from "./db";
import { createTools } from "./tools";
import { TOOLS_MANIFEST } from "./manifest";
import { dispatchTool } from "./dispatch";

async function main(): Promise<void> {
  const sqlitePath = process.env["SQLITE_PATH"] ?? "./data/prd-assist.sqlite";
  const db = openMcpDatabase(sqlitePath);

  const tableCheck = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
    .get();
  if (tableCheck === undefined) {
    process.stderr.write(
      JSON.stringify({
        error: "schema_not_initialized",
        hint: "start apps/server first",
      }) + "\n",
    );
    process.exit(2);
  }

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
    return dispatchTool(tools, name, args ?? {});
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`MCP server fatal error: ${String(err)}\n`);
  process.exit(1);
});
