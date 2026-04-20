import { useEffect } from "react";
import { useParams } from "react-router-dom";
import type { Session } from "@prd-assist/shared";
import TopBar from "../components/TopBar";
import ChatPane from "../components/ChatPane";
import PrdPane from "../components/PrdPane";
import ResizeHandle from "../components/ResizeHandle";
import { usePrdPanel, PRD_MIN } from "../hooks/usePrdPanel";
import type { PrdPanel } from "../hooks/usePrdPanel";
import { useSessionState } from "../hooks/useSessionState";
import type { SessionLoadState } from "../hooks/useSessionState";

interface SessionContentProps {
  session: Session;
  panel: PrdPanel;
  turnInFlight: boolean;
  onBeforeSend: () => void;
  onAfterSend: (optimistic: Session | undefined) => void;
}

function SessionContent({
  session,
  panel,
  turnInFlight,
  onBeforeSend,
  onAfterSend,
}: SessionContentProps) {
  const chat = (
    <ChatPane
      session={session}
      inFlight={turnInFlight}
      onBeforeSend={onBeforeSend}
      onAfterSend={onAfterSend}
    />
  );

  if (!panel.open) {
    return <div className="h-full flex-1">{chat}</div>;
  }

  return (
    <>
      <div className="h-full flex-1 min-w-0">{chat}</div>
      <ResizeHandle
        ariaLabel="Resize PRD panel"
        valueNow={panel.width}
        valueMin={PRD_MIN}
        valueMax={panel.maxWidth}
        onResize={(dx) => panel.setWidth(panel.width - dx)}
      />
      <div
        style={{ width: panel.width }}
        className="h-full shrink-0 overflow-hidden bg-gray-50 dark:bg-gray-950"
      >
        <PrdPane prd={session.prd} />
      </div>
    </>
  );
}

function resolveTitle(state: SessionLoadState): string {
  if (state.status === "loading") return "Loading…";
  if (state.status === "error") return "Session not found";
  return state.session.title || "(untitled)";
}

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const panel = usePrdPanel();
  const { state, turnInFlight, handleBeforeSend, handleAfterSend } = useSessionState(id);

  const resolvedTitle = resolveTitle(state);

  useEffect(() => {
    document.title = `${resolvedTitle} · prd-assist`;
  }, [resolvedTitle]);

  useEffect(() => {
    return () => {
      document.title = "prd-assist";
    };
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        title={resolvedTitle}
        prdOpen={panel.open}
        prdCanOpen={panel.canOpen}
        onTogglePrd={panel.toggle}
      />
      <div className="flex flex-1 overflow-hidden">
        {state.status === "loaded" ? (
          <SessionContent
            session={state.session}
            panel={panel}
            turnInFlight={turnInFlight}
            onBeforeSend={handleBeforeSend}
            onAfterSend={handleAfterSend}
          />
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
    </div>
  );
}
