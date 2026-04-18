import NewSessionButton from "./NewSessionButton.js";
import SessionList from "./SessionList.js";

export default function Sidebar() {
  return (
    <aside className="w-64 shrink-0 border-r border-gray-200 bg-white flex flex-col">
      <div className="px-4 py-4 border-b border-gray-100">
        <h1 className="text-base font-bold text-gray-900">prd-assist</h1>
      </div>
      <NewSessionButton />
      <div className="overflow-y-auto flex-1">
        <SessionList />
      </div>
    </aside>
  );
}
