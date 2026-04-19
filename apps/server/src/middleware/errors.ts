import type { Context } from "hono";
import { SessionBusyError, SessionNotFoundError } from "../turn";

export function mapErrorToResponse(c: Context, err: unknown) {
  if (err instanceof SessionBusyError) {
    return c.json({ error: "session_busy" }, 409);
  }
  if (err instanceof SessionNotFoundError) {
    return c.json({ error: "session_not_found" }, 404);
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error("unhandled route error:", err);
  return c.json({ error: "internal", message }, 500);
}
