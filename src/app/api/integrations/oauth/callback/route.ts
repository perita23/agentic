import { publicRoute } from "@/lib/server/api";
import { audit } from "@/lib/server/audit";
import { HttpError } from "@/lib/server/util";

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function page(ok: boolean, title: string, detail: string) {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#e6e6e6;font:15px/1.5 -apple-system,BlinkMacSystemFont,sans-serif}
main{max-width:420px;padding:32px;border:1px solid #212121;border-radius:14px;background:#111;text-align:center}
h1{font-size:18px;margin:12px 0 6px}p{margin:0;color:#8a8a8a}.i{font-size:32px;color:${ok ? "#3ecf8e" : "#ff6b6b"}}</style></head>
<body><main><div class="i">${ok ? "✓" : "✕"}</div><h1>${esc(title)}</h1><p>${esc(detail)}</p></main></body></html>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

/**
 * Where Jira / Bitbucket send the browser back after login. It is public (the
 * session cookie is SameSite=Strict and not sent on this cross-site redirect):
 * the single-use, 10-minute, 256-bit `state` created by an authenticated
 * "Conectar" is what authorises it.
 */
export const GET = publicRoute(async ({ c, url }) => {
  try {
    const r = await c.oauth.callback(url.searchParams.get("state"), url.searchParams.get("code"), url.searchParams.get("error"));
    audit(c.config.dataDir, "integration.connected", { provider: r.provider });
    return page(true, `${r.provider} conectado`, `Cuenta: ${r.account}. Ya puedes cerrar esta pestaña y volver a Agentic.`);
  } catch (e) {
    return page(false, "No se pudo conectar", e instanceof HttpError ? e.message : "Error inesperado");
  }
});
