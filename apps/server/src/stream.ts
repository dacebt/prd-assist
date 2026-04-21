import type { AgentRole } from "./config";

export type StreamEvent =
  | { kind: "thinking"; agentRole: AgentRole; content: string; at: string }
  | { kind: "final"; content: string; at: string };

export type StreamSink = (event: StreamEvent) => void;

export interface BufferedSink {
  sink: StreamSink;
  events: readonly StreamEvent[];
  getFinal(): string | null;
}

export function createBufferedSink(): BufferedSink {
  const buffer: StreamEvent[] = [];

  const sink: StreamSink = (event) => {
    buffer.push(event);
    const role = event.kind === "thinking" ? event.agentRole : "final";
    console.warn(`stream [${role}] ${event.kind}: ${event.content.slice(0, 120)}`);
  };

  return {
    sink,
    get events(): readonly StreamEvent[] {
      return buffer;
    },
    getFinal(): string | null {
      for (let i = buffer.length - 1; i >= 0; i--) {
        const event = buffer[i];
        if (event !== undefined && event.kind === "final") {
          return event.content;
        }
      }
      return null;
    },
  };
}
