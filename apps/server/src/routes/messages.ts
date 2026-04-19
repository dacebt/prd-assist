import type { Hono } from "hono";
import { z } from "zod";
import { withBody, withParam } from "../middleware/validate";
import { mapErrorToResponse } from "../middleware/errors";
import { handleTurn, type TurnDeps } from "../turn";
import type { InternalRouteDeps } from "./index";

const IdParamSchema = z.object({
  id: z.string().min(1),
});

const PostMessageBodySchema = z.object({
  text: z
    .string()
    .refine((s) => s.trim().length >= 1, { message: "text must not be empty after trimming" })
    .refine((s) => s.trim().length <= 10000, {
      message: "text must be at most 10000 characters after trimming",
    }),
});

const MAX_PAYLOAD_BYTES = 64 * 1024;

export function register(app: Hono, deps: InternalRouteDeps): void {
  const turnDeps: TurnDeps = {
    store: deps.store,
    llm: deps.llm,
    mcp: deps.mcp,
    mutex: deps.mutex,
    now: deps.now,
    config: {
      model: deps.model,
      ...deps.turnConfig,
    },
  };

  app.post(
    "/api/sessions/:id/messages",
    async (c, next) => {
      const contentLength = c.req.raw.headers.get("content-length");
      if (contentLength !== null && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
        return c.json({ error: "payload_too_large" }, 413);
      }
      await next();
    },
    withParam(IdParamSchema),
    withBody(PostMessageBodySchema),
    async (c) => {
      const { id } = c.get("param") as z.infer<typeof IdParamSchema>;
      const { text } = c.get("body") as z.infer<typeof PostMessageBodySchema>;
      try {
        const reply = await handleTurn({ sessionId: id, userText: text, deps: turnDeps });
        return c.json({ reply });
      } catch (err) {
        return mapErrorToResponse(c, err);
      }
    },
  );
}
