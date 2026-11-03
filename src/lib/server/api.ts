import { ctx, type Context } from "./context";
import { assertRequestAllowed } from "./security";
import { HttpError } from "./util";

const MAX_BODY = 1024 * 1024;

type Params = Record<string, string>;
type Handler = (args: { req: Request; params: Params; c: Context; url: URL; body: () => Promise<unknown> }) => unknown | Promise<unknown>;

async function readJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BODY) throw new HttpError(413, "Request body too large");
  const reader = req.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY) {
      await reader.cancel();
      throw new HttpError(413, "Request body too large");
    }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

const JSON_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: JSON_HEADERS });
}

/**
 * Wrap a Route Handler: authenticates (defence in depth, the proxy checks too),
 * validates Host/Origin/Content-Type, parses JSON lazily with a size cap and maps
 * errors to `{ error }` JSON without leaking stack traces.
 */
export function route(handler: Handler) {
  return async (req: Request, context: { params: Promise<Params> }) => {
    try {
      const c = ctx();
      assertRequestAllowed(req, c.token);
      const params = (await context?.params) ?? {};
      const result = await handler({ req, params, c, url: new URL(req.url), body: () => readJson(req) });
      if (result instanceof Response) return result;
      return json(result ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, details: e.details }, e.status);
      console.error("[agentic] unhandled API error", e);
      return json({ error: "Internal server error" }, 500);
    }
  };
}
