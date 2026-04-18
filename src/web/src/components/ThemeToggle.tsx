import { useTheme } from "../hooks/useTheme.js";

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Toggle dark mode"
      onClick={toggle}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        isDark ? "bg-slate-700" : "bg-sky-300"
      }`}
    >
      <span
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transform transition-transform ${
          isDark ? "translate-x-5" : "translate-x-0.5"
        }`}
      >
        {isDark ? (
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-slate-700" fill="currentColor">
            <path d="M15.5 13.5A6 6 0 0 1 7.5 5a.75.75 0 0 0-1.02-.77A7.5 7.5 0 1 0 16.27 14.52a.75.75 0 0 0-.77-1.02Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-amber-500" fill="currentColor">
            <circle cx="10" cy="10" r="3.5" />
            <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="10" y1="1.5" x2="10" y2="3.5" />
              <line x1="10" y1="16.5" x2="10" y2="18.5" />
              <line x1="1.5" y1="10" x2="3.5" y2="10" />
              <line x1="16.5" y1="10" x2="18.5" y2="10" />
              <line x1="3.8" y1="3.8" x2="5.2" y2="5.2" />
              <line x1="14.8" y1="14.8" x2="16.2" y2="16.2" />
              <line x1="3.8" y1="16.2" x2="5.2" y2="14.8" />
              <line x1="14.8" y1="5.2" x2="16.2" y2="3.8" />
            </g>
          </svg>
        )}
      </span>
    </button>
  );
}
