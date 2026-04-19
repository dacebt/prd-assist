import { useEffect, useRef } from "react";
import type { Session } from "@prd-assist/shared";
import { fetchSession } from "../api";
import { startPolling } from "./polling";

interface UseSessionPollingOpts {
  sessionId: string | undefined;
  active: boolean;
  onUpdate: (session: Session) => void;
}

/**
 * Thin useEffect wrapper around startPolling. Restarts when active or sessionId changes.
 * Holds onUpdate in a ref so the effect dep array is stable — a new function reference
 * from SessionPage (e.g. an inline arrow) does not tear down and restart the interval.
 */
export function useSessionPolling(opts: UseSessionPollingOpts): void {
  const { sessionId, active } = opts;
  const onUpdateRef = useRef(opts.onUpdate);
  onUpdateRef.current = opts.onUpdate;

  useEffect(() => {
    const cancel = startPolling({
      active,
      sessionId,
      fetchFn: fetchSession,
      onUpdate: (session) => onUpdateRef.current(session),
      intervalMs: 500,
    });
    return cancel;
  }, [active, sessionId]);
}
