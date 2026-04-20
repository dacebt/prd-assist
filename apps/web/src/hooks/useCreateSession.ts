import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createSession } from "../api";

export function useCreateSession(): { create: () => Promise<void>; loading: boolean } {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  async function create() {
    if (loading) return;
    setLoading(true);
    try {
      const { id } = await createSession();
      navigate(`/sessions/${id}`);
    } catch (err) {
      console.error("Failed to create session", err);
    } finally {
      setLoading(false);
    }
  }

  return { create, loading };
}
