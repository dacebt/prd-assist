import { Link } from "react-router-dom";
import ThemeToggle from "./ThemeToggle";

interface Props {
  title: string;
  prdOpen: boolean;
  prdCanOpen: boolean;
  onTogglePrd: () => void;
}

export default function TopBar({ title, prdOpen, prdCanOpen, onTogglePrd }: Props) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-6 dark:border-gray-800 dark:bg-gray-900">
      <Link
        to="/"
        className="shrink-0 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
      >
        ← Sessions
      </Link>
      <h1
        className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-gray-100"
        title={title}
      >
        {title}
      </h1>
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={onTogglePrd}
          disabled={!prdCanOpen}
          title={!prdCanOpen ? "PRD requires a wider viewport (≥720px)" : undefined}
          className="rounded px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {prdOpen ? "Hide PRD" : "Show PRD"}
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}
