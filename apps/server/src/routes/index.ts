import type { Hono } from "hono";
import { z } from "zod";
import type { SessionStore } from "../sessions";
import type { LlmClient } from "../llm";
import type { McpClient } from "../mcpClient";
import type { SessionMutex } from "../mutex";
import { TURN_DEFAULTS, type TurnConfig } from "../config";
import { register as registerHealth } from "./health";
import { register as registerSessions } from "./sessions";
import { register as registerMessages } from "./messages";

export interface RouteDeps {
  store: SessionStore;
  llm: LlmClient;
  mcp: McpClient;
  mutex: SessionMutex;
  model: string;
  now: () => Date;
  turnConfig?: Omit<TurnConfig, "model">;
}

export const IdParamSchema = z.object({
  id: z.string().min(1),
});

export function registerRoutes(app: Hono, deps: RouteDeps): void {
  const turnConfig = deps.turnConfig ?? TURN_DEFAULTS;
  registerHealth(app);
  registerSessions(app, deps);
  registerMessages(app, deps, turnConfig);
}
