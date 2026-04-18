import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { LlmToolDescriptor } from "./llm.js";

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface McpClient {
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: unknown): Promise<unknown>;
  close(): Promise<void>;
}

export function mcpToolsToOpenAi(
  tools: readonly McpToolDescriptor[],
): LlmToolDescriptor[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

export async function createMcpClient(sqlitePath?: string): Promise<McpClient> {
  const command = resolve(process.cwd(), "node_modules/.bin/tsx");
  const args = [resolve(process.cwd(), "src/mcp/index.ts")];

  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (sqlitePath !== undefined) {
    env["SQLITE_PATH"] = sqlitePath;
  }

  const transport = new StdioClientTransport({
    command,
    args,
    env,
  });

  transport.onclose = () => {
    console.error("mcp_child_exited");
    process.exit(1);
  };

  const client = new Client(
    { name: "prd-assist-backend", version: "0.1.0" },
    { capabilities: {} },
  );

  await client.connect(transport);

  const toolsResult = await client.listTools();
  const cachedTools: McpToolDescriptor[] = toolsResult.tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: t.inputSchema,
  }));

  return {
    listTools(): Promise<McpToolDescriptor[]> {
      return Promise.resolve(cachedTools);
    },

    async callTool(name: string, args: unknown): Promise<unknown> {
      const result = await client.callTool({
        name,
        arguments: args as Record<string, unknown>,
      });

      const content = result.content as Array<{ type: string; text?: string }>;
      const first = content[0];
      if (first === undefined || first.type !== "text" || typeof first.text !== "string") {
        throw new Error(`Unexpected MCP result shape for tool "${name}"`);
      }
      return JSON.parse(first.text) as unknown;
    },

    async close(): Promise<void> {
      delete transport.onclose;
      await transport.close();
    },
  };
}
