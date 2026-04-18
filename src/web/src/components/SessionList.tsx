import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchSessions } from "../api.js";
import type { SessionSummary } from "../../../shared/types.js";

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

export default function SessionList() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    fetchSessions()
      .then(setSessions)
      .catch(console.error);
  }, []);

  if (sessions.length === 0) {
    return <p className="text-sm text-gray-400 italic px-4 py-2">No sessions yet.</p>;
  }

  return (
    <ul className="divide-y divide-gray-100">
      {sessions.map((s) => (
        <li
          key={s.id}
          className="px-4 py-3 cursor-pointer hover:bg-gray-50"
          onClick={() => navigate(`/sessions/${s.id}`)}
        >
          <p className="text-sm font-medium text-gray-800 truncate">
            {s.title || "(untitled)"}
          </p>
          <p className="text-xs text-gray-400">{relativeTime(s.updatedAt)}</p>
        </li>
      ))}
    </ul>
  );
}
