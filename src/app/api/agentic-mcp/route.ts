import { handleRpc } from "@/lib/server/agentic-mcp";
import { route } from "@/lib/server/api";
import { HttpError } from "@/lib/server/util";

/**
 * Agentic's own MCP server (streamable HTTP, answering in plain JSON): the tools Claude uses to look into Agentic.
 * It is "public" for the session machinery because it has its own token, checked here (never the master one).
 */
export const POST = route(
  async ({ c, req, body }) => {
    if (!c.agenticMcp.authorized(req.headers.get("authorization"))) throw new HttpError(401, "Unauthorized");
    if (!c.agenticMcp.get().enabled) throw new HttpError(403, "Las herramientas de Agentic para Claude están desactivadas");
    const msg = await body();
    if (Array.isArray(msg)) {
      const out = (await Promise.all(msg.slice(0, 20).map((m) => handleRpc(c, m)))).filter(Boolean);
      return out.length ? out : new Response(null, { status: 202 });
    }
    const out = await handleRpc(c, msg);
    return out ?? new Response(null, { status: 202 });
  },
  { public: true },
);

const NOT_ALLOWED = () => new Response("Method Not Allowed: this server answers POST", { status: 405, headers: { Allow: "POST" } });
export const GET = route(NOT_ALLOWED, { public: true });
export const DELETE = route(NOT_ALLOWED, { public: true });
