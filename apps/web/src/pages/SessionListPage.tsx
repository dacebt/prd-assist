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

      <div className="mx-auto flex w-full max-w-3xl flex-1 min-h-0 flex-col gap-6 overflow-hidden px-6 py-6">
        <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          prd-assist helps you write product requirements documents by conversation. Each session is
          a chat that drafts a PRD — vision, problem, users, goals, features, scope, and open
          questions — as you talk through it.
        </p>

        <div className="flex justify-end">
          <NewSessionButton />
        </div>

        <main className="flex-1 min-h-0 overflow-y-auto rounded border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <SessionList />
        </main>
      </div>
    </div>
  );
}
