import { NextResponse, type NextRequest } from "next/server";
import { getConfig } from "@/lib/server/config";
import { buildCsp, isAllowedHost, isAuthorized, loadOrCreateToken, SECURITY_HEADERS } from "@/lib/server/security";

/** Reachable without a session: the login page, the passkey login ceremony, the OAuth redirect (authorised by its single-use state) and Agentic's own MCP endpoint (it checks its own token). */
const PUBLIC = new Set(["/auth", "/login", "/api/auth/status", "/api/auth/passkey/login/options", "/api/auth/passkey/login/verify", "/api/integrations/oauth/callback", "/api/agentic-mcp"]);

/**
 * First line of defence for every request:
 *  1. Host allow-list (DNS-rebinding protection).
 *  2. Session auth (server-side session cookie, or Bearer master token).
 *  3. Per-request CSP nonce + hardening headers on every response.
 * Route handlers re-check auth/Origin themselves (defence in depth).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const dev = process.env.NODE_ENV === "development";

  const withHeaders = (res: NextResponse | Response, csp?: string) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
    if (csp) res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  if (!isAllowedHost(request.headers.get("host"))) {
    return withHeaders(new Response("Host not allowed", { status: 421, headers: { "content-type": "text/plain" } }));
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, dev, pathname === "/mail");
  const page = () => {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
    return withHeaders(NextResponse.next({ request: { headers: requestHeaders } }), csp);
  };

  if (PUBLIC.has(pathname)) return pathname.startsWith("/api/") || pathname === "/auth" ? withHeaders(NextResponse.next()) : page();

  const { dataDir } = getConfig();
  if (!isAuthorized(request, { token: loadOrCreateToken(dataDir), dataDir })) {
    if (pathname.startsWith("/api/")) return withHeaders(Response.json({ error: "Unauthorized" }, { status: 401 }));
    const login = new URL("/login", `http://${request.headers.get("host")}`);
    if (pathname !== "/") login.searchParams.set("next", pathname);
    return withHeaders(NextResponse.redirect(login, 303));
  }

  if (pathname.startsWith("/api/")) return withHeaders(NextResponse.next());
  return page();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)"],
};
