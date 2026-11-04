import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readAuth, SESSION_COOKIE, validateSession } from "./auth";
import { HttpError } from "./util";

const TOKEN_RE = /^[0-9a-f]{64}$/;

/** Load the access token from `<dataDir>/token` or create one (mode 0600). */
export function loadOrCreateToken(dataDir: string): string {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const f = path.join(dataDir, "token");
  try {
    const t = fs.readFileSync(f, "utf8").trim();
    if (TOKEN_RE.test(t)) return t;
  } catch {}
  const t = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(f, t, { mode: 0o600 });
  return t;
}

export function safeEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

/** Hostnames accepted in Host / Origin (blocks DNS-rebinding attacks). */
export function allowedHostnames(): Set<string> {
  const s = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  for (const h of (process.env.AGENTIC_ALLOWED_HOSTS || "").split(",")) if (h.trim()) s.add(h.trim().toLowerCase());
  return s;
}

/** Hostname part of a `Host` header value (`[::1]:3000` -> `[::1]`). */
export function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0];
}

export function isAllowedHost(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  return allowedHostnames().has(hostnameOf(hostHeader));
}

export interface RequestLike {
  method: string;
  headers: { get(name: string): string | null };
}

export interface AuthContext {
  token: string;
  dataDir: string;
}

/**
 * A request is authenticated by a valid server-side session cookie, or by the
 * master token as a Bearer header (scripts/CLI) unless passkeys are required.
 */
export function isAuthorized(req: RequestLike, ctx: AuthContext): boolean {
  const header = req.headers.get("authorization") || "";
  if (header.startsWith("Bearer ") && !readAuth(ctx.dataDir).requirePasskey && safeEqual(header.slice(7).trim(), ctx.token)) return true;
  return !!validateSession(ctx.dataDir, parseCookies(req.headers.get("cookie"))[SESSION_COOKIE]);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Throws unless the request may proceed: allowed Host, authenticated, and for
 * state-changing methods same-origin + JSON body (CSRF defence; JSON cannot be
 * sent cross-origin by a plain HTML form without a CORS preflight).
 */
export function assertRequestAllowed(req: RequestLike, ctx: AuthContext | null) {
  if (!isAllowedHost(req.headers.get("host"))) throw new HttpError(421, "Host not allowed");
  // ctx === null: public endpoint (login ceremony); every other check still applies.
  if (ctx && !isAuthorized(req, ctx)) throw new HttpError(401, "Unauthorized: inicia sesión en /login");
  if (SAFE_METHODS.has(req.method)) return;

  const origin = req.headers.get("origin");
  if (origin !== null) {
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      throw new HttpError(403, "Cross-origin request blocked");
    }
    if (origin === "null" || !isAllowedHost(host)) throw new HttpError(403, "Cross-origin request blocked");
  }
  const sfs = req.headers.get("sec-fetch-site");
  if (sfs && sfs !== "same-origin" && sfs !== "none") throw new HttpError(403, "Cross-site request blocked");
  if (req.method !== "DELETE") {
    const ct = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (ct !== "application/json") throw new HttpError(415, "Content-Type must be application/json");
  }
}

/** `remoteImages`: only the Mail page, whose sandboxed frames show the pictures of emails (https only). */
export function buildCsp(nonce: string, dev: boolean, remoteImages = false): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are needed by Radix / Motion positioning.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data:${remoteImages ? " https:" : ""}`,
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
