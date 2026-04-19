import type { Context } from "hono";
import type { ZodSchema } from "zod";

export type ParseResult<T> = { ok: true; data: T } | { ok: false; response: Response };

export async function parseBody<T>(c: Context, schema: ZodSchema<T>): Promise<ParseResult<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return {
      ok: false,
      response: c.json({ error: "invalid_request", details: ["invalid JSON"] }, 400),
    };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: c.json({ error: "invalid_request", details: result.error.issues }, 400),
    };
  }
  return { ok: true, data: result.data };
}

export function parseParam<T>(c: Context, schema: ZodSchema<T>): ParseResult<T> {
  const result = schema.safeParse(c.req.param());
  if (!result.success) {
    return {
      ok: false,
      response: c.json({ error: "session_not_found" }, 404),
    };
  }
  return { ok: true, data: result.data };
}

export function rejectOversizedPayload(c: Context, maxBytes: number): Response | null {
  const contentLength = c.req.raw.headers.get("content-length");
  if (contentLength !== null && parseInt(contentLength, 10) > maxBytes) {
    return c.json({ error: "payload_too_large" }, 413);
  }
  return null;
}
