import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { deleteSession, fetchSessions } from "../api";
import type { SessionSummary } from "@prd-assist/shared";

type ListState =
  | { status: "loading" }
  | { status: "loaded"; sessions: SessionSummary[] }
  | { status: "error"; message: string };

type PendingDelete = {
  id: string;
  phase: "confirm" | "deleting" | "error";
  message?: string;
};

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

function useDeleteSession(load: (mode: "initial" | "refresh") => void) {
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  useEffect(() => {
    if (pendingDelete === null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPendingDelete(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pendingDelete]);

  const handleTrash = useCallback((id: string) => {
    setPendingDelete({ id, phase: "confirm" });
  }, []);

  const handleCancel = useCallback(() => setPendingDelete(null), []);

  const handleConfirm = useCallback(
    (id: string) => {
      setPendingDelete((prev) => (prev?.id === id ? { id, phase: "deleting" } : prev));
      deleteSession(id)
        .then(() => {
          setPendingDelete((prev) => (prev?.id === id ? null : prev));
          load("refresh");
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : "Unknown error";
          setPendingDelete((prev) =>
            prev?.id === id
              ? { id, phase: "error", message: `Delete failed: ${msg}` }
              : prev,
          );
        });
    },
    [load],
  );

  const handleRetry = useCallback((id: string) => handleConfirm(id), [handleConfirm]);

  return { pendingDelete, handleTrash, handleCancel, handleConfirm, handleRetry };
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5Zm0 1.5h2.5c.69 0 1.25.56 1.25 1.25v.31a43.35 43.35 0 0 0-5 0v-.31C7.5 3.06 8.06 2.5 8.75 2.5ZM10 8a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 8Zm-1.75.75a.75.75 0 0 0-1.5 0v4.5a.75.75 0 0 0 1.5 0v-4.5Zm4.25-.75a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 12.5 8Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

const clusterBase = "absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1";
const redBtn = "rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950";
const mutedBtn = "rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800";

function ConfirmCluster({
  isDeleting,
  onConfirm,
  onCancel,
}: {
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={clusterBase}>
      <button
        type="button"
        disabled={isDeleting}
        autoFocus={!isDeleting}
        onClick={onConfirm}
        className={`${redBtn} disabled:opacity-50`}
      >
        {isDeleting ? "Deleting…" : "Delete"}
      </button>
      <button type="button" disabled={isDeleting} onClick={onCancel} className={`${mutedBtn} disabled:opacity-50`}>
        Cancel
      </button>
    </div>
  );
}

function ErrorCluster({
  message,
  onRetry,
  onCancel,
}: {
  message: string | undefined;
  onRetry: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={clusterBase}>
      <span className="max-w-[180px] truncate text-xs text-red-500 dark:text-red-400">
        {message}
      </span>
      <button type="button" onClick={onRetry} className={redBtn}>
        Retry
      </button>
      <button type="button" onClick={onCancel} className={mutedBtn}>
        Cancel
      </button>
    </div>
  );
}

type SessionRowActionsProps = {
  pending: PendingDelete | null;
  onTrash: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onRetry: () => void;
};

function SessionRowActions({ pending, onTrash, onConfirm, onCancel, onRetry }: SessionRowActionsProps) {
  if (pending === null) {
    return (
      <button
        type="button"
        aria-label="Delete session"
        onClick={onTrash}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500 group-focus-within:opacity-100 group-hover:opacity-100 dark:hover:bg-red-950 dark:hover:text-red-400"
      >
        <TrashIcon />
      </button>
    );
  }
  if (pending.phase === "confirm" || pending.phase === "deleting") {
    return (
      <ConfirmCluster
        isDeleting={pending.phase === "deleting"}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
  }
  return <ErrorCluster message={pending.message} onRetry={onRetry} onCancel={onCancel} />;
}

type SessionRowProps = {
  s: SessionSummary;
  pending: PendingDelete | null;
  onTrashClick: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onRetry: () => void;
};

function SessionRow({ s, pending, onTrashClick, onConfirm, onCancel, onRetry }: SessionRowProps) {
  const textBlock = (
    <>
      <p className="truncate pr-10 text-sm font-medium text-gray-800 dark:text-gray-100">
        {s.title || "(untitled)"}
      </p>
      <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
        {s.id.slice(-8)} · created {relativeTime(s.createdAt)} · updated {relativeTime(s.updatedAt)}
      </p>
      <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
        {s.exchangeCount} exchanges · {s.sectionsConfirmed}/7 confirmed
      </p>
    </>
  );

  return (
    <li className="group relative">
      {pending !== null ? (
        <div className="block px-6 py-4 bg-gray-50 dark:bg-gray-800">{textBlock}</div>
      ) : (
        <Link
          to={`/sessions/${s.id}`}
          className="block px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
        >
          {textBlock}
        </Link>
      )}
      <SessionRowActions
        pending={pending}
        onTrash={onTrashClick}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onRetry={onRetry}
      />
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
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [load]);

  const { pendingDelete, handleTrash, handleCancel, handleConfirm, handleRetry } =
    useDeleteSession(load);

  if (state.status === "loading") {
    return <p className="text-sm text-gray-400 italic px-6 py-4 dark:text-gray-500">Loading sessions…</p>;
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
        <SessionRow
          key={s.id}
          s={s}
          pending={pendingDelete?.id === s.id ? pendingDelete : null}
          onTrashClick={() => handleTrash(s.id)}
          onConfirm={() => handleConfirm(s.id)}
          onCancel={handleCancel}
          onRetry={() => handleRetry(s.id)}
        />
      ))}
    </ul>
  );
}
