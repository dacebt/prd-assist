import type { Context, MiddlewareHandler } from "hono";
import type { ZodSchema } from "zod";

export function withBody<T>(schema: ZodSchema<T>): MiddlewareHandler<{
  Variables: { body: T };
}> {
  return async (c, next) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request", details: ["invalid JSON"] }, 400);
    }
    const result = schema.safeParse(raw);
    if (!result.success) {
      return c.json({ error: "invalid_request", details: result.error.issues }, 400);
    }
    c.set("body", result.data);
    await next();
  };
}

export function withParam<T>(schema: ZodSchema<T>): MiddlewareHandler<{
  Variables: { param: T };
}> {
  return async (c: Context, next) => {
    const result = schema.safeParse(c.req.param());
    if (!result.success) {
      return c.json({ error: "session_not_found" }, 404);
    }
    c.set("param", result.data);
    await next();
  };
}
