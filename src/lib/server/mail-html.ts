/**
 * Make an email's HTML safe to show. The real barrier is the sandboxed iframe it is shown in (no scripts, no
 * same-origin, no forms) plus the page's CSP; this strips the obviously active parts as a second layer and makes
 * every link open outside the app.
 */
const MAX_HTML = 800_000;

export function sanitizeEmailHtml(html: string): string | undefined {
  if (!html || html.length > MAX_HTML) return undefined;
  let h = html;
  // Active / document-level elements.
  h = h.replace(/<(script|style[^>]*\bsrc\b|iframe|frame|frameset|object|embed|applet|form|template)\b[\s\S]*?<\/\1\s*>/gi, "");
  h = h.replace(/<(script|iframe|frame|object|embed|applet|base|link|meta|input|button|textarea|select)\b[^>]*\/?>/gi, (m) => (/^<meta\b[^>]*charset/i.test(m) ? m : ""));
  // Event handlers and script URLs.
  h = h.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  h = h.replace(/\b(href|src|xlink:href|action|formaction)\s*=\s*("|')?\s*(javascript|vbscript|data:text\/html)[^"'>\s]*/gi, '$1=$2#');
  // Links always open in a new window, without access to this one.
  h = h.replace(/<a\b([^>]*)>/gi, (_m, attrs: string) => `<a${attrs.replace(/\s+(target|rel)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")} target="_blank" rel="noopener noreferrer">`);
  return h;
}

/** The document shown inside the sandboxed iframe. */
export function emailDocument(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{background:#fff;color:#111}body{margin:0;padding:12px;font:14px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}</style></head><body>${body}</body></html>`;
}

const IMG_TYPES = /^image\/(png|jpe?g|gif|webp)$/i;

/** Embedded pictures (cid:) become data: URIs so they show without any request. */
export function inlineCidImages(html: string, attachments: { cid?: string; contentType?: string; content?: Buffer; size?: number }[]): string {
  let budget = 4 * 1024 * 1024;
  const byCid = new Map<string, string>();
  for (const a of attachments) {
    if (!a.cid || !a.content || !a.contentType || !IMG_TYPES.test(a.contentType)) continue;
    if (a.content.length > 1_500_000 || a.content.length > budget) continue;
    budget -= a.content.length;
    byCid.set(a.cid.replace(/^<|>$/g, ""), `data:${a.contentType.toLowerCase()};base64,${a.content.toString("base64")}`);
  }
  if (!byCid.size) return html;
  return html.replace(/cid:([^"'\s>)]+)/gi, (m, id: string) => byCid.get(decodeURIComponent(id)) ?? m);
}
