import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createSession } from "../api";

export default function NewSessionButton() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    try {
      const { id } = await createSession();
      navigate(`/sessions/${id}`);
    } catch (err) {
      console.error("Failed to create session", err);
      setLoading(false);
    }
  }

  return (
    <button
      onClick={() => {
        void handleClick();
      }}
      disabled={loading}
      className="mx-4 my-3 w-[calc(100%-2rem)] rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
    >
      {loading ? "Creating…" : "New session"}
    </button>
  );
}
