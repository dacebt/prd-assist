import { useCreateSession } from "../hooks/useCreateSession";

export default function NewSessionButton() {
  const { create, loading } = useCreateSession();

  return (
    <button
      onClick={() => void create()}
      disabled={loading}
      className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
    >
      {loading ? "Creating…" : "New session"}
    </button>
  );
}
