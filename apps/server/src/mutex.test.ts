import { describe, it, expect } from "vitest";
import { createSessionMutex } from "./mutex";

describe("createSessionMutex", () => {
  it("tryAcquire returns true for a fresh session id", () => {
    const mutex = createSessionMutex();
    expect(mutex.tryAcquire("session-1")).toBe(true);
  });

  it("release allows re-acquire after release", () => {
    const mutex = createSessionMutex();
    mutex.tryAcquire("session-1");
    mutex.release("session-1");
    expect(mutex.tryAcquire("session-1")).toBe(true);
  });

  it("double-acquire same id returns false on second attempt", () => {
    const mutex = createSessionMutex();
    expect(mutex.tryAcquire("session-1")).toBe(true);
    expect(mutex.tryAcquire("session-1")).toBe(false);
  });

  it("acquire then release then acquire succeeds", () => {
    const mutex = createSessionMutex();
    mutex.tryAcquire("session-1");
    mutex.release("session-1");
    expect(mutex.tryAcquire("session-1")).toBe(true);
  });

  it("different session ids are independent", () => {
    const mutex = createSessionMutex();
    mutex.tryAcquire("session-1");
    expect(mutex.tryAcquire("session-2")).toBe(true);
  });
});
