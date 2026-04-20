import Sidebar from "../components/Sidebar";

export default function SessionListPage() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <p className="text-gray-400 text-sm italic dark:text-gray-500">
          Select or create a session.
        </p>
      </main>
    </div>
  );
}
