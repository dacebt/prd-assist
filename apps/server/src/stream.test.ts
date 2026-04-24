import { describe, it, expect } from "vitest";
import { createBufferedSink } from "./stream";

describe("createBufferedSink", () => {
  it("buffers events in order and getFinal returns last final content", () => {
    const buffered = createBufferedSink();

    buffered.sink({ kind: "thinking", agentRole: "orchestrator", content: "tick", at: "2026-04-21T00:00:00Z" });
    buffered.sink({ kind: "final", content: "done", at: "2026-04-21T00:00:01Z" });

    expect(buffered.events).toHaveLength(2);
    expect(buffered.events[0]).toMatchObject({ kind: "thinking", content: "tick" });
    expect(buffered.events[1]).toMatchObject({ kind: "final", content: "done" });
    expect(buffered.getFinal()).toBe("done");
  });
});
