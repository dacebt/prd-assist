import { useEffect, useRef, useState } from "react";
import type { Session } from "@prd-assist/shared";
import { sendMessage } from "../api";
import MessageBubble from "./MessageBubble";
import ThinkingRow from "./ThinkingRow";

interface Props {
  session: Session;
  inFlight: boolean;
  onBeforeSend: () => void;
  onAfterSend: () => void;
}

interface ThinkingEntry {
  agentRole: string;
  content: string;
}

interface MessageListProps {
  messages: Session["messages"];
  currentThinking: ThinkingEntry | null;
  bottomRef: React.RefObject<HTMLDivElement>;
}

function MessageList({ messages, currentThinking, bottomRef }: MessageListProps) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      {messages.map((msg) => (
        <MessageBubble key={msg.at} role={msg.role} content={msg.content} />
      ))}
      {currentThinking && <ThinkingRow agentRole={currentThinking.agentRole} />}
      <div ref={bottomRef} />
    </div>
  );
}

interface ComposerProps {
  text: string;
  error: string | null;
  inFlight: boolean;
  onTextChange: (value: string) => void;
  onSubmit: () => void;
}

function Composer({ text, error, inFlight, onTextChange, onSubmit }: ComposerProps) {
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <div className="border-t border-gray-200 p-3 dark:border-gray-800">
      {error !== null && <p className="text-red-500 dark:text-red-400 text-xs mb-2">{error}</p>}
      <textarea
        className="w-full border border-gray-300 rounded p-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
        rows={3}
        placeholder="Type a message… (Cmd/Ctrl+Enter to send)"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={inFlight}
        autoFocus
      />
      <button
        className="mt-2 w-full bg-blue-500 hover:bg-blue-600 text-white text-sm rounded py-1.5 disabled:opacity-50"
        onClick={onSubmit}
        disabled={inFlight || text.trim().length === 0}
      >
        {inFlight ? "Sending…" : "Send"}
      </button>
    </div>
  );
}

export default function ChatPane({ session, inFlight, onBeforeSend, onAfterSend }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [currentThinking, setCurrentThinking] = useState<ThinkingEntry | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.messages, currentThinking]);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || inFlight) return;
    onBeforeSend();
    setError(null);
    setText("");

    try {
      await sendMessage(session.id, trimmed, {
        onThinking: ({ agentRole, content }) => {
          setCurrentThinking({ agentRole, content });
        },
        onFinal: () => {
          setCurrentThinking(null);
        },
      });

      onAfterSend();
    } catch (err) {
      setCurrentThinking(null);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(`Send failed: ${msg}`);
      onAfterSend();
    }
  }

  return (
    <div className="h-full w-full bg-white flex flex-col dark:bg-gray-900">
      <MessageList messages={session.messages} currentThinking={currentThinking} bottomRef={bottomRef} />
      <Composer
        text={text}
        error={error}
        inFlight={inFlight}
        onTextChange={setText}
        onSubmit={() => void submit()}
      />
    </div>
  );
}
