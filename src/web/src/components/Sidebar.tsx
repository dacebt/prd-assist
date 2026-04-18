import NewSessionButton from "./NewSessionButton.js";
import SessionList from "./SessionList.js";
import ThemeToggle from "./ThemeToggle.js";

export default function Sidebar() {
  return (
    <aside className="w-64 shrink-0 border-r border-gray-200 bg-white flex flex-col dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100 dark:border-gray-800">
        <h1 className="text-base font-bold text-gray-900 dark:text-gray-100">prd-assist</h1>
        <ThemeToggle />
      </div>
      <NewSessionButton />
      <div className="overflow-y-auto flex-1">
        <SessionList />
      </div>
    </aside>
  );
}
