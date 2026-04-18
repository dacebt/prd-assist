import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  role: "user" | "assistant";
  content: string;
}

export default function MessageBubble({ role, content }: Props) {
  const isUser = role === "user";
  return (
    <div className={`flex mb-3 ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? "bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100"
            : "bg-blue-50 text-gray-900 border border-blue-100 dark:bg-blue-950/40 dark:text-gray-100 dark:border-blue-900"
        }`}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
