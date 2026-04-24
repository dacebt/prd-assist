import type { AgentRole } from "./config";

export type StreamEvent =
  | { kind: "thinking"; agentRole: AgentRole; content: string; at: string }
  | { kind: "final"; content: string; at: string };

export type StreamSink = (event: StreamEvent) => void;
