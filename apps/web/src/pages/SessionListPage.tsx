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
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          <span className="h-3 w-3 rounded-sm bg-gradient-to-br from-blue-500 to-indigo-600" aria-hidden="true" />
          prd-assist
        </h1>
        <ThemeToggle />
      </header>

      <div className="mx-auto flex w-full max-w-4xl flex-1 min-h-0 flex-col gap-8 overflow-hidden px-6 py-10">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-3xl">
              Draft PRDs by conversation.
            </h2>
            <p className="mt-3 max-w-prose text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              Each session is a chat that drafts a PRD — vision, problem, users, goals, features,
              scope, and open questions — as you talk through it.
            </p>
          </div>
          <div className="shrink-0 pt-1">
            <NewSessionButton />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
              Recent sessions
            </h3>
          </div>
          <main className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <SessionList />
          </main>
        </div>
      </div>
    </div>
  );
}
