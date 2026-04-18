import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchSession } from "../api.js";
import type { Session } from "../../../shared/types.js";
import Sidebar from "../components/Sidebar.js";
import ChatPane from "../components/ChatPane.js";
import PrdPane from "../components/PrdPane.js";

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; session: Session }
  | { status: "error"; message: string };

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });

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

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-1 overflow-hidden">
        {state.status === "loaded" ? (
          <>
            <ChatPane session={state.session} />
            <div className="flex-1 overflow-y-auto bg-gray-50">
              <PrdPane prd={state.session.prd} />
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto bg-gray-50 p-4">
            {state.status === "loading" && (
              <p className="text-sm text-gray-400 italic">Loading…</p>
            )}
            {state.status === "error" && (
              <p className="text-sm text-red-500">{state.message}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
