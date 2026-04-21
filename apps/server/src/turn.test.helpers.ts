import { vi } from "vitest";
import { type TurnDeps } from "./turn";
import type { LlmClient, AssistantMessage } from "./llm";
import type { McpClient, McpToolDescriptor } from "./mcpClient";
import type { SessionStore } from "./sessions";
import { initialPrd } from "./sessions";
import type { SessionMutex } from "./mutex";
import type { Session } from "@prd-assist/shared";
import { createSessionMutex } from "./mutex";

export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "test-session",
    title: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [],
    prd: initialPrd(new Date("2026-01-01T00:00:00.000Z")),
    ...overrides,
  };
}

export function makeStore(session: Session | null): SessionStore & {
  persistUserCalls: Session[];
  persistAssistantCalls: Session[];
} {
  const persistUserCalls: Session[] = [];
  const persistAssistantCalls: Session[] = [];
  return {
    createSession: vi.fn(),
    listSessions: vi.fn(),
    getSession: (_id: string) => session,
    deleteSession: vi.fn(),
    persistUserMessage(s: Session) {
      persistUserCalls.push({ ...s, messages: [...s.messages] });
    },
    persistAssistantMessage(s: Session) {
      persistAssistantCalls.push({ ...s, messages: [...s.messages] });
    },
    persistUserCalls,
    persistAssistantCalls,
  };
}

export function makeLlmClient(reply: string | (() => Promise<AssistantMessage>)): LlmClient {
  return {
    chat: () => {
      if (typeof reply === "string") {
        return Promise.resolve({ role: "assistant", content: reply });
      }
      return reply();
    },
  };
}

export function makeDefaultMcpClient(overrides: Partial<McpClient> = {}): McpClient {
  return {
    listTools: () => Promise.resolve([]),
    callTool: () => Promise.resolve({}),
    close: () => Promise.resolve(),
    ...overrides,
  };
}

export const MOCK_GET_PRD_TOOL: McpToolDescriptor = {
  name: "get_prd",
  description: "Read the PRD",
  inputSchema: { type: "object", properties: { session_id: { type: "string" } } },
};

export const MOCK_UPDATE_SECTION_TOOL: McpToolDescriptor = {
  name: "update_section",
  description: "Update a section",
  inputSchema: { type: "object", properties: { session_id: { type: "string" } } },
};

export function makeDeps(
  session: Session | null,
  llm: LlmClient,
  mutex: SessionMutex = createSessionMutex(),
  mcp: McpClient = makeDefaultMcpClient(),
): TurnDeps & { store: ReturnType<typeof makeStore> } {
  const store = makeStore(session);
  return {
    store,
    llm,
    mcp,
    mutex,
    now: () => new Date("2026-01-01T10:00:00.000Z"),
    config: {
      model: "test-model",
      maxIterations: 6,
      perCallTimeoutMs: 90_000,
      wallClockMs: 300_000,
    },
  };
}
