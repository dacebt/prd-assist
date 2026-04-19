import type { Hono } from "hono";
import type { SessionStore } from "../sessions";
import type { LlmClient } from "../llm";
import type { McpClient } from "../mcpClient";
import type { SessionMutex } from "../mutex";
import { TURN_DEFAULTS } from "../config";
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
}

export interface InternalRouteDeps extends RouteDeps {
  turnConfig: typeof TURN_DEFAULTS;
}

export function registerRoutes(app: Hono, deps: RouteDeps): void {
  const internal: InternalRouteDeps = { ...deps, turnConfig: TURN_DEFAULTS };
  registerHealth(app);
  registerSessions(app, internal);
  registerMessages(app, internal);
}
