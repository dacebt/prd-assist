import { describe, it, expect } from "vitest";
import type { StreamEvent } from "./stream";

describe("StreamEvent type", () => {
  it("thinking event has required fields", () => {
    const event: StreamEvent = {
      kind: "thinking",
      agentRole: "orchestrator",
      content: "tick",
      at: "2026-04-21T00:00:00Z",
    };
    expect(event.kind).toBe("thinking");
    expect(event.agentRole).toBe("orchestrator");
  });

  it("final event has required fields", () => {
    const event: StreamEvent = { kind: "final", content: "done", at: "2026-04-21T00:00:01Z" };
    expect(event.kind).toBe("final");
    expect(event.content).toBe("done");
  });
});
