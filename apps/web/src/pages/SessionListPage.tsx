import { useEffect } from "react";
import NewSessionButton from "../components/NewSessionButton";
import SessionList from "../components/SessionList";
import ThemeToggle from "../components/ThemeToggle";

export default function SessionListPage() {
  useEffect(() => {
    document.title = "prd-assist";
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
        <h1 className="text-base font-bold text-gray-900 dark:text-gray-100">prd-assist</h1>
        <ThemeToggle />
      </header>
      <div className="border-b border-gray-200 px-6 py-3 dark:border-gray-800">
        <NewSessionButton />
      </div>
      <main className="flex-1 overflow-y-auto">
        <SessionList />
      </main>
    </div>
  );
}
