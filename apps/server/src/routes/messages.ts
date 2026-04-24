import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { parseBody, parseParam, rejectOversizedPayload } from "../middleware/validate";
import { handleTurn, type TurnDeps } from "../turn";
import type { StreamEvent } from "../stream";
import type { TurnConfig } from "../config";
import { IdParamSchema, type RouteDeps } from "./index";

const PostMessageBodySchema = z.object({
  text: z
    .string()
    .refine((s) => s.trim().length >= 1, { message: "text must not be empty after trimming" })
    .refine((s) => s.trim().length <= 10000, {
      message: "text must be at most 10000 characters after trimming",
    }),
});

const MAX_PAYLOAD_BYTES = 64 * 1024;

export function register(app: Hono, deps: RouteDeps, turnConfig: Omit<TurnConfig, "models">): void {
  const turnDeps: TurnDeps = {
    store: deps.store,
    llm: deps.llm,
    mcp: deps.mcp,
    mutex: deps.mutex,
    now: deps.now,
    config: { models: deps.models, ...turnConfig },
  };

  app.post("/api/sessions/:id/messages", async (c) => {
    const oversized = rejectOversizedPayload(c, MAX_PAYLOAD_BYTES);
    if (oversized) return oversized;

    const param = parseParam(c, IdParamSchema);
    if (!param.ok) return param.response;

    const body = await parseBody(c, PostMessageBodySchema);
    if (!body.ok) return body.response;

    return streamSSE(c, async (stream) => {
      try {
        await handleTurn({
          sessionId: param.data.id,
          userText: body.data.text,
          deps: turnDeps,
          sink: (event: StreamEvent) => {
            void stream.writeSSE({
              event: event.kind,
              data: JSON.stringify(event),
            });
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        const errorCode =
          err instanceof Error && err.name === "SessionBusyError"
            ? "session_busy"
            : err instanceof Error && err.name === "SessionNotFoundError"
              ? "session_not_found"
              : "internal";
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ error: errorCode, message }),
        });
      }
    });
  });
}
