import { useCreateSession } from "../hooks/useCreateSession";

export default function NewSessionButton() {
  const { create, loading } = useCreateSession();

  return (
    <button
      onClick={() => void create()}
      disabled={loading}
      className="rounded-md bg-blue-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-50"
    >
      {loading ? "Creating…" : "New session"}
    </button>
  );
}
