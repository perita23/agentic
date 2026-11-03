import { NextResponse, type NextRequest } from "next/server";
import { getConfig } from "@/lib/server/config";
import { buildCsp, isAllowedHost, isAuthorized, loadOrCreateToken, SECURITY_HEADERS } from "@/lib/server/security";

/**
 * First line of defence for every request:
 *  1. Host allow-list (DNS-rebinding protection).
 *  2. Token auth (cookie set by /auth, or Bearer header).
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

  // The /auth route validates the token itself and sets the cookie.
  if (pathname === "/auth") return withHeaders(NextResponse.next());

  const token = loadOrCreateToken(getConfig().dataDir);
  if (!isAuthorized(request, token)) {
    if (pathname.startsWith("/api/")) {
      return withHeaders(Response.json({ error: "Unauthorized" }, { status: 401 }));
    }
    return withHeaders(
      new Response(UNAUTHORIZED_HTML, { status: 401, headers: { "content-type": "text/html; charset=utf-8" } }),
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    );
  }

  if (pathname.startsWith("/api/")) return withHeaders(NextResponse.next());

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, dev);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  return withHeaders(NextResponse.next({ request: { headers: requestHeaders } }), csp);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

const UNAUTHORIZED_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Agentic · acceso</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{background:#0d1117;color:#e6edf3;font:15px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:520px;padding:32px;border:1px solid #30363d;border-radius:12px;background:#161b22}
code{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:2px 6px}h1{font-size:20px;margin-top:0}</style></head>
<body><main><h1>🔒 Acceso protegido</h1><p>Agentic sólo acepta peticiones con el token local.</p>
<p>Abre el enlace que aparece en la terminal al ejecutar <code>npm start</code> (o <code>npm run dev</code>),
o ejecuta <code>npm run url</code> para volver a verlo.</p></main></body></html>`;
