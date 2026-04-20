/**
 * Tests for the pure startPolling function.
 * React hook tests are omitted: useSessionPolling is a thin useEffect wrapper
 * around startPolling with no logic of its own, and the node vitest environment
 * cannot render React hooks. The pure function covers all start/stop/interval
 * behavior the spec requires.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startPolling } from "./polling";
import type { Session } from "@prd-assist/shared";

const STUB_SESSION: Session = {
  id: "s1",
  title: "Test",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  messages: [],
  prd: {
    vision: { content: "", status: "empty", updatedAt: "" },
    problem: { content: "", status: "empty", updatedAt: "" },
    targetUsers: { content: "", status: "empty", updatedAt: "" },
    goals: { content: "", status: "empty", updatedAt: "" },
    coreFeatures: { content: "", status: "empty", updatedAt: "" },
    outOfScope: { content: "", status: "empty", updatedAt: "" },
    openQuestions: { content: "", status: "empty", updatedAt: "" },
  },
};

describe("startPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not fetch when active is false", async () => {
    const fetchFn = vi.fn().mockResolvedValue(STUB_SESSION);
    const onUpdate = vi.fn();

    startPolling({ active: false, sessionId: "s1", fetchFn, onUpdate, intervalMs: 500 });

    await vi.advanceTimersByTimeAsync(2000);

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not fetch when sessionId is undefined", async () => {
    const fetchFn = vi.fn().mockResolvedValue(STUB_SESSION);
    const onUpdate = vi.fn();

    startPolling({ active: true, sessionId: undefined, fetchFn, onUpdate, intervalMs: 500 });

    await vi.advanceTimersByTimeAsync(2000);

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("fetches approximately once per 500ms when active", async () => {
    const fetchFn = vi.fn().mockResolvedValue(STUB_SESSION);
    const onUpdate = vi.fn();

    startPolling({ active: true, sessionId: "s1", fetchFn, onUpdate, intervalMs: 500 });

    await vi.advanceTimersByTimeAsync(1500);

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(onUpdate).toHaveBeenCalledTimes(3);
    expect(onUpdate).toHaveBeenCalledWith(STUB_SESSION);
  });

  it("fires first poll at t+500ms, not immediately (trailing edge)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(STUB_SESSION);
    const onUpdate = vi.fn();

    startPolling({ active: true, sessionId: "s1", fetchFn, onUpdate, intervalMs: 500 });

    await vi.advanceTimersByTimeAsync(499);
    expect(fetchFn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("stops fetching after cancel is called", async () => {
    const fetchFn = vi.fn().mockResolvedValue(STUB_SESSION);
    const onUpdate = vi.fn();

    const cancel = startPolling({
      active: true,
      sessionId: "s1",
      fetchFn,
      onUpdate,
      intervalMs: 500,
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    cancel();

    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("discards in-flight fetch result after cancel", async () => {
    let resolve!: (v: Session) => void;
    const fetchFn = vi.fn().mockReturnValue(
      new Promise<Session>((res) => {
        resolve = res;
      }),
    );
    const onUpdate = vi.fn();

    const cancel = startPolling({
      active: true,
      sessionId: "s1",
      fetchFn,
      onUpdate,
      intervalMs: 500,
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    cancel();

    resolve(STUB_SESSION);
    await vi.advanceTimersByTimeAsync(0);

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("does not stop polling when a fetch fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchFn = vi.fn().mockRejectedValue(new Error("network error"));
    const onUpdate = vi.fn();

    startPolling({ active: true, sessionId: "s1", fetchFn, onUpdate, intervalMs: 500 });

    await vi.advanceTimersByTimeAsync(1500);

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(onUpdate).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
