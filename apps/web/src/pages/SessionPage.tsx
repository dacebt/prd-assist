import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchSession } from "../api";
import type { Session } from "@prd-assist/shared";
import Sidebar from "../components/Sidebar";
import ChatPane from "../components/ChatPane";
import PrdPane from "../components/PrdPane";
import ResizeHandle from "../components/ResizeHandle";
import { useSessionPolling } from "../hooks/useSessionPolling";
import { usePanelLayout, PRD_MIN, CHAT_MIN } from "../hooks/usePanelLayout";

const HANDLE_WIDTH = 4;

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; session: Session }
  | { status: "error"; message: string };

interface SessionViewProps {
  session: Session;
  turnInFlight: boolean;
  onBeforeSend: () => void;
  onAfterSend: (optimistic: Session | undefined) => void;
}

interface ContentAreaProps {
  chatPane: React.ReactNode;
  session: Session;
  layout: ReturnType<typeof usePanelLayout>;
}

function ContentArea({ chatPane, session, layout }: ContentAreaProps) {
  if (layout.prdOpen) {
    return (
      <>
        <div style={{ width: layout.chatWidth }} className="h-full shrink-0">
          {chatPane}
        </div>
        <ResizeHandle
          ariaLabel="Resize chat panel"
          onResize={(dx) => {
            const maxChat = Math.max(
              0,
              window.innerWidth - layout.sidebarWidth - PRD_MIN - HANDLE_WIDTH * 2,
            );
            layout.setChatWidth(Math.min(layout.chatWidth + dx, maxChat));
          }}
        />
        <div className="h-full flex-1 overflow-hidden bg-gray-50 dark:bg-gray-950">
          <PrdPane prd={session.prd} onClose={layout.togglePrd} />
        </div>
      </>
    );
  }
  return (
    <>
      <div className="h-full flex-1">{chatPane}</div>
      <button
        type="button"
        onClick={layout.togglePrd}
        aria-label="Open PRD panel"
        className="h-full shrink-0 border-l border-gray-200 bg-gray-50 px-2 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-100"
      >
        PRD ›
      </button>
    </>
  );
}

function SessionView({ session, turnInFlight, onBeforeSend, onAfterSend }: SessionViewProps) {
  const layout = usePanelLayout();
  const chatPane = (
    <ChatPane
      session={session}
      inFlight={turnInFlight}
      onBeforeSend={onBeforeSend}
      onAfterSend={onAfterSend}
    />
  );
  return (
    <>
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
          layout.setSidebarWidth(Math.min(layout.sidebarWidth + dx, maxSidebar));
        }}
      />
      <ContentArea chatPane={chatPane} session={session} layout={layout} />
    </>
  );
}

function LoadingOrErrorView({ state }: { state: Exclude<LoadState, { status: "loaded" }> }) {
  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 p-4 dark:bg-gray-950">
      {state.status === "loading" && (
        <p className="text-sm text-gray-400 italic dark:text-gray-500">Loading…</p>
      )}
      {state.status === "error" && (
        <p className="text-sm text-red-500 dark:text-red-400">{state.message}</p>
      )}
    </div>
  );
}

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });
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

  function handleAfterSend(optimistic: Session | undefined) {
    setTurnInFlight(false);
    if (optimistic) setState({ status: "loaded", session: optimistic });
    if (id) {
      fetchSession(id)
        .then((fresh) => setState({ status: "loaded", session: fresh }))
        .catch(() => undefined);
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {state.status === "loaded" ? (
        <SessionView
          session={state.session}
          turnInFlight={turnInFlight}
          onBeforeSend={handleBeforeSend}
          onAfterSend={handleAfterSend}
        />
      ) : (
        <LoadingOrErrorView state={state} />
      )}
    </div>
  );
}
