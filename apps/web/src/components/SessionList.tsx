import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchSessions } from "../api";
import type { SessionSummary } from "@prd-assist/shared";

type ListState =
  | { status: "loading" }
  | { status: "loaded"; sessions: SessionSummary[] }
  | { status: "error"; message: string };

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function SessionRow({ s }: { s: SessionSummary }) {
  return (
    <li>
      <Link
        to={`/sessions/${s.id}`}
        className="block px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
      >
        <p className="text-sm font-medium text-gray-800 truncate dark:text-gray-100">
          {s.title || "(untitled)"}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {s.id.slice(-8)} · {relativeTime(s.updatedAt)}
        </p>
      </Link>
    </li>
  );
}

function SessionErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="px-6 py-4">
      <p className="text-sm text-red-500 dark:text-red-400">{message}</p>
      <button
        onClick={onRetry}
        className="mt-2 text-sm text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        Retry
      </button>
    </div>
  );
}

function SessionEmptyState() {
  return (
    <p className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
      No sessions yet — use the New session button above to create one.
    </p>
  );
}

export default function SessionList() {
  const [state, setState] = useState<ListState>({ status: "loading" });

  const load = useCallback((mode: "initial" | "refresh") => {
    if (mode === "initial") setState({ status: "loading" });
    fetchSessions()
      .then((sessions) => setState({ status: "loaded", sessions }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Unknown error";
        setState({ status: "error", message });
      });
  }, []);

  useEffect(() => {
    load("initial");
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") load("refresh");
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [load]);

  if (state.status === "loading") {
    return (
      <p className="text-sm text-gray-400 italic px-6 py-4 dark:text-gray-500">
        Loading sessions…
      </p>
    );
  }

  if (state.status === "error") {
    return <SessionErrorState message={state.message} onRetry={() => load("initial")} />;
  }

  if (state.sessions.length === 0) {
    return <SessionEmptyState />;
  }

  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {state.sessions.map((s) => (
        <SessionRow key={s.id} s={s} />
      ))}
    </ul>
  );
}
