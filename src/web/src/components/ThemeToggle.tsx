import { useTheme } from "../hooks/useTheme.js";

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const label = theme === "dark" ? "Light" : "Dark";
  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${label} theme`}
      className="rounded border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
    >
      {label}
    </button>
  );
}
