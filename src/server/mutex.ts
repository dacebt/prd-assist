export interface SessionMutex {
  tryAcquire(sessionId: string): boolean;
  release(sessionId: string): void;
}

export function createSessionMutex(): SessionMutex {
  const held = new Set<string>();

  return {
    tryAcquire(sessionId: string): boolean {
      if (held.has(sessionId)) return false;
      held.add(sessionId);
      return true;
    },

    release(sessionId: string): void {
      held.delete(sessionId);
    },
  };
}
