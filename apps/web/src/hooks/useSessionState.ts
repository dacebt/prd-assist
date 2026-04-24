import { useEffect, useState } from "react";
import { fetchSession } from "../api";
import type { Session } from "@prd-assist/shared";
import { useSessionPolling } from "./useSessionPolling";

export type SessionLoadState =
  | { status: "loading" }
  | { status: "loaded"; session: Session }
  | { status: "error"; message: string };

interface SessionState {
  state: SessionLoadState;
  turnInFlight: boolean;
  handleBeforeSend: () => void;
  handleAfterSend: () => void;
}

/** Manages fetch, polling, and send-turn lifecycle for a single session. */
export function useSessionState(id: string | undefined): SessionState {
  const [state, setState] = useState<SessionLoadState>({ status: "loading" });
  const [turnInFlight, setTurnInFlight] = useState(false);

  useEffect(() => {
    if (!id) {
      setState({ status: "error", message: "No session id in URL" });
      return;
    }
    fetchSession(id)
      .then((session) => setState({ status: "loaded", session }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Unknown error";
        setState({ status: "error", message });
      });
  }, [id]);

  useSessionPolling({
    sessionId: id,
    active: turnInFlight,
    onUpdate: (session) => setState({ status: "loaded", session }),
  });

  function handleBeforeSend() {
    setTurnInFlight(true);
  }

  function handleAfterSend() {
    setTurnInFlight(false);
    if (id) {
      fetchSession(id)
        .then((fresh) => setState({ status: "loaded", session: fresh }))
        .catch(() => undefined);
    }
  }

  return { state, turnInFlight, handleBeforeSend, handleAfterSend };
}
