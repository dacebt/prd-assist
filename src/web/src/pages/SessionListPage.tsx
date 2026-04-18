import Sidebar from "../components/Sidebar.js";

export default function SessionListPage() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex items-center justify-center bg-gray-50">
        <p className="text-gray-400 text-sm italic">Select or create a session.</p>
      </main>
    </div>
  );
}
