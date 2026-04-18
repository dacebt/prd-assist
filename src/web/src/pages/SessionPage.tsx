import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchSession } from "../api.js";
import type { Session } from "../../../shared/types.js";
import Sidebar from "../components/Sidebar.js";
import ChatPane from "../components/ChatPane.js";
import PrdPane from "../components/PrdPane.js";
import ResizeHandle from "../components/ResizeHandle.js";
import { useSessionPolling } from "../hooks/useSessionPolling.js";
import { usePanelLayout, PRD_MIN, CHAT_MIN } from "../hooks/usePanelLayout.js";

const HANDLE_WIDTH = 4;

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; session: Session }
  | { status: "error"; message: string };

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [turnInFlight, setTurnInFlight] = useState(false);
  const layout = usePanelLayout();

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

  function handleAfterSend(optimistic: Session | undefined) {
    setTurnInFlight(false);
    if (optimistic) {
      setState({ status: "loaded", session: optimistic });
    }
    if (id) {
      fetchSession(id)
        .then((fresh) => setState({ status: "loaded", session: fresh }))
        .catch(() => undefined);
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <div style={{ width: layout.sidebarWidth }} className="h-full shrink-0">
        <Sidebar />
      </div>
      <ResizeHandle
        ariaLabel="Resize sessions sidebar"
        onResize={(dx) => {
          const prdAllowance = layout.prdOpen ? PRD_MIN + HANDLE_WIDTH : 0;
          const maxSidebar = Math.max(
            0,
            window.innerWidth - CHAT_MIN - prdAllowance - HANDLE_WIDTH,
          );
          const next = Math.min(layout.sidebarWidth + dx, maxSidebar);
          layout.setSidebarWidth(next);
        }}
      />

      {state.status === "loaded" ? (
        <>
          {layout.prdOpen ? (
            <>
              <div style={{ width: layout.chatWidth }} className="h-full shrink-0">
                <ChatPane
                  session={state.session}
                  inFlight={turnInFlight}
                  onBeforeSend={handleBeforeSend}
                  onAfterSend={handleAfterSend}
                />
              </div>
              <ResizeHandle
                ariaLabel="Resize chat panel"
                onResize={(dx) => {
                  const maxChat = Math.max(
                    0,
                    window.innerWidth - layout.sidebarWidth - PRD_MIN - HANDLE_WIDTH * 2,
                  );
                  const next = Math.min(layout.chatWidth + dx, maxChat);
                  layout.setChatWidth(next);
                }}
              />
              <div className="h-full flex-1 overflow-hidden bg-gray-50 dark:bg-gray-950">
                <PrdPane prd={state.session.prd} onClose={layout.togglePrd} />
              </div>
            </>
          ) : (
            <>
              <div className="h-full flex-1">
                <ChatPane
                  session={state.session}
                  inFlight={turnInFlight}
                  onBeforeSend={handleBeforeSend}
                  onAfterSend={handleAfterSend}
                />
              </div>
              <button
                type="button"
                onClick={layout.togglePrd}
                aria-label="Open PRD panel"
                className="h-full shrink-0 border-l border-gray-200 bg-gray-50 px-2 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-100"
              >
                PRD ›
              </button>
            </>
          )}
        </>
      ) : (
        <div className="flex-1 overflow-y-auto bg-gray-50 p-4 dark:bg-gray-950">
          {state.status === "loading" && (
            <p className="text-sm text-gray-400 italic dark:text-gray-500">Loading…</p>
          )}
          {state.status === "error" && (
            <p className="text-sm text-red-500 dark:text-red-400">{state.message}</p>
          )}
        </div>
      )}
    </div>
  );
}
