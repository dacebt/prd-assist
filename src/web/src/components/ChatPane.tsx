import { useEffect, useRef, useState } from "react";
import type { Session } from "../../../shared/types.js";
import { sendMessage } from "../api.js";
import MessageBubble from "./MessageBubble.js";

interface Props {
  session: Session;
  inFlight: boolean;
  onBeforeSend: () => void;
  onAfterSend: (optimistic: Session | undefined) => void;
}

export default function ChatPane({ session, inFlight, onBeforeSend, onAfterSend }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.messages]);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || inFlight) return;

    onBeforeSend();
    setError(null);

    try {
      const reply = await sendMessage(session.id, trimmed);
      setText("");
      const optimistic: Session = {
        ...session,
        messages: [
          ...session.messages,
          { role: "user", content: trimmed, at: new Date().toISOString() },
          { role: "assistant", content: reply, at: new Date().toISOString() },
        ],
      };
      onAfterSend(optimistic);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(`Send failed: ${msg}`);
      onAfterSend(undefined);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="w-[400px] shrink-0 border-r border-gray-200 bg-white flex flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        {session.messages.map((msg) => (
          <MessageBubble key={msg.at} role={msg.role} content={msg.content} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-gray-200 p-3">
        {error !== null && (
          <p className="text-red-500 text-xs mb-2">{error}</p>
        )}
        <textarea
          className="w-full border border-gray-300 rounded p-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
          rows={3}
          placeholder="Type a message… (Cmd/Ctrl+Enter to send)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={inFlight}
        />
        <button
          className="mt-2 w-full bg-blue-500 hover:bg-blue-600 text-white text-sm rounded py-1.5 disabled:opacity-50"
          onClick={() => void submit()}
          disabled={inFlight || text.trim().length === 0}
        >
          {inFlight ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
