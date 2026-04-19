import type { Session } from "@prd-assist/shared";

interface StartPollingOpts {
  active: boolean;
  sessionId: string | undefined;
  fetchFn: (id: string) => Promise<Session>;
  onUpdate: (session: Session) => void;
  intervalMs: number;
}

/**
 * Starts a polling loop that calls fetchFn every intervalMs and invokes onUpdate
 * on each successful response. Returns a cancel function.
 *
 * Cancellation gates out any in-flight fetch result: if the interval is cancelled
 * while a fetch is in flight, the response is discarded and onUpdate is not called.
 *
 * When active is false or sessionId is undefined, returns a no-op cancel immediately.
 * First poll fires at t+intervalMs (trailing edge); SessionPage handles the initial fetch.
 */
export function startPolling(opts: StartPollingOpts): () => void {
  const { active, sessionId, fetchFn, onUpdate, intervalMs } = opts;

  if (!active || !sessionId) {
    return () => undefined;
  }

  let cancelled = false;

  const id = setInterval(() => {
    if (cancelled) return;

    fetchFn(sessionId)
      .then((session) => {
        if (!cancelled) {
          onUpdate(session);
        }
      })
      .catch(() => {
        console.error("useSessionPolling: fetch failed, will retry");
      });
  }, intervalMs);

  return () => {
    cancelled = true;
    clearInterval(id);
  };
}
