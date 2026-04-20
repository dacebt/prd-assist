import type { Hono } from "hono";
import { z } from "zod";
import { parseBody, parseParam, rejectOversizedPayload } from "../middleware/validate";
import { mapErrorToResponse } from "../middleware/errors";
import { handleTurn, type TurnDeps } from "../turn";
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

export function register(app: Hono, deps: RouteDeps, turnConfig: Omit<TurnConfig, "model">): void {
  const turnDeps: TurnDeps = {
    store: deps.store,
    llm: deps.llm,
    mcp: deps.mcp,
    mutex: deps.mutex,
    now: deps.now,
    config: { model: deps.model, ...turnConfig },
  };

  app.post("/api/sessions/:id/messages", async (c) => {
    const oversized = rejectOversizedPayload(c, MAX_PAYLOAD_BYTES);
    if (oversized) return oversized;

    const param = parseParam(c, IdParamSchema);
    if (!param.ok) return param.response;

    const body = await parseBody(c, PostMessageBodySchema);
    if (!body.ok) return body.response;

    try {
      const reply = await handleTurn({
        sessionId: param.data.id,
        userText: body.data.text,
        deps: turnDeps,
      });
      return c.json({ reply });
    } catch (err) {
      return mapErrorToResponse(c, err);
    }
  });
}
