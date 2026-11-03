import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HttpError } from "./util";

/**
 * Server-side sessions and passkeys, persisted in `<dataDir>/auth.json` (0600).
 *
 * - Session ids are 256-bit random values; only their SHA-256 is stored, so a
 *   copy of auth.json cannot be replayed as a cookie.
 * - Sessions expire after 30 days, or 7 days without use.
 * - The master token only bootstraps a session (or authenticates API calls via
 *   Bearer) and is disabled entirely when `requirePasskey` is on.
 *
 * Read fresh from disk (mtime-cached) because proxy.ts and route handlers may
 * live in different module graphs and must agree on revocations.
 */

export const SESSION_COOKIE = "agentic_session";
export const CHALLENGE_COOKIE = "agentic_challenge";
const SESSION_TTL = 30 * 24 * 3600_000;
const SESSION_IDLE = 7 * 24 * 3600_000;
const TOUCH_EVERY = 5 * 60_000;
const MAX_SESSIONS = 50;

export interface StoredSession {
  idHash: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  /** desktop = opened by the macOS app after a native Touch ID check. */
  method: "token" | "passkey" | "desktop";
  userAgent: string;
}

export interface StoredPasskey {
  id: string; // base64url credential id
  publicKey: string; // base64url COSE key
  counter: number;
  transports: string[];
  name: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AuthState {
  userId: string; // base64url, stable WebAuthn user handle
  requirePasskey: boolean;
  sessions: StoredSession[];
  passkeys: StoredPasskey[];
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const nowIso = () => new Date().toISOString();

function file(dataDir: string) {
  return path.join(dataDir, "auth.json");
}

let cache: { file: string; mtimeMs: number; size: number; state: AuthState } | null = null;

export function readAuth(dataDir: string): AuthState {
  const f = file(dataDir);
  try {
    const st = fs.statSync(f);
    if (cache && cache.file === f && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.state;
    const state = JSON.parse(fs.readFileSync(f, "utf8")) as AuthState;
    cache = { file: f, mtimeMs: st.mtimeMs, size: st.size, state };
    return state;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.warn("[agentic] auth.json unreadable; starting with no sessions");
    return { userId: crypto.randomBytes(16).toString("base64url"), requirePasskey: false, sessions: [], passkeys: [] };
  }
}

export function writeAuth(dataDir: string, state: AuthState) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const f = file(dataDir);
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, f);
  cache = null;
}

export function updateAuth(dataDir: string, fn: (s: AuthState) => void): AuthState {
  const s = structuredClone(readAuth(dataDir));
  fn(s);
  writeAuth(dataDir, s);
  return s;
}

/** Create a session; returns the raw id for the cookie (never stored). */
export function createSession(dataDir: string, method: StoredSession["method"], userAgent: string): string {
  const raw = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  updateAuth(dataDir, (s) => {
    s.sessions = s.sessions.filter((x) => Date.parse(x.expiresAt) > now && now - Date.parse(x.lastSeenAt) < SESSION_IDLE);
    s.sessions.push({
      idHash: sha256(raw),
      createdAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL).toISOString(),
      method,
      userAgent: userAgent.slice(0, 200),
    });
    s.sessions = s.sessions.slice(-MAX_SESSIONS);
  });
  return raw;
}

/** Validate a raw session id; refreshes lastSeenAt at most every 5 minutes. */
export function validateSession(dataDir: string, raw: string | undefined | null): StoredSession | null {
  if (!raw || !/^[0-9a-f]{64}$/.test(raw)) return null;
  const h = sha256(raw);
  const s = readAuth(dataDir).sessions.find((x) => crypto.timingSafeEqual(Buffer.from(x.idHash), Buffer.from(h)));
  if (!s) return null;
  const now = Date.now();
  if (Date.parse(s.expiresAt) <= now || now - Date.parse(s.lastSeenAt) >= SESSION_IDLE) return null;
  if (now - Date.parse(s.lastSeenAt) > TOUCH_EVERY) {
    try {
      updateAuth(dataDir, (st) => {
        const x = st.sessions.find((y) => y.idHash === h);
        if (x) x.lastSeenAt = new Date(now).toISOString();
      });
    } catch {}
  }
  return s;
}

export function sessionIdHash(raw: string) {
  return sha256(raw);
}

export function revokeSession(dataDir: string, idHash: string) {
  let found = false;
  updateAuth(dataDir, (s) => {
    const before = s.sessions.length;
    s.sessions = s.sessions.filter((x) => x.idHash !== idHash);
    found = s.sessions.length < before;
  });
  if (!found) throw new HttpError(404, "Sesión no encontrada");
}

export function revokeOtherSessions(dataDir: string, keepHash: string) {
  updateAuth(dataDir, (s) => {
    s.sessions = s.sessions.filter((x) => x.idHash === keepHash);
  });
}

// ---------- WebAuthn challenges (single use, 5 minutes) ----------

const g = globalThis as unknown as { __agenticChallenges?: Map<string, { challenge: string; kind: "register" | "login"; expires: number }> };
const challenges: Map<string, { challenge: string; kind: "register" | "login"; expires: number }> = (g.__agenticChallenges ??= new Map());

export function putChallenge(challenge: string, kind: "register" | "login"): string {
  const now = Date.now();
  for (const [k, v] of challenges) if (v.expires < now) challenges.delete(k);
  if (challenges.size > 1000) challenges.clear();
  const id = crypto.randomBytes(16).toString("hex");
  challenges.set(id, { challenge, kind, expires: now + 5 * 60_000 });
  return id;
}

export function takeChallenge(id: string | undefined, kind: "register" | "login"): string {
  const c = id ? challenges.get(id) : undefined;
  if (id) challenges.delete(id);
  if (!c || c.kind !== kind || c.expires < Date.now()) throw new HttpError(400, "El reto ha caducado; vuelve a intentarlo");
  return c.challenge;
}

// ---------- rate limiting (failed attempts per client) ----------

const rlHolder = globalThis as unknown as { __agenticRate?: Map<string, number[]> };
const rl: Map<string, number[]> = (rlHolder.__agenticRate ??= new Map<string, number[]>());

/** Throws 429 if `key` had `max` failures in the last `windowMs`. */
export function assertNotRateLimited(key: string, max = 10, windowMs = 60_000) {
  const now = Date.now();
  const hits = (rl.get(key) ?? []).filter((t) => now - t < windowMs);
  rl.set(key, hits);
  if (hits.length >= max) throw new HttpError(429, "Demasiados intentos fallidos; espera un minuto");
}

export function recordFailure(key: string) {
  const hits = rl.get(key) ?? [];
  hits.push(Date.now());
  rl.set(key, hits.slice(-100));
}

/** WebAuthn needs a domain: refuse IP hosts with a helpful message. */
export function rpFromHost(hostHeader: string | null): { rpID: string; origin: string } {
  const host = (hostHeader ?? "").toLowerCase();
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  if (hostname !== "localhost") {
    const port = host.split(":").pop();
    throw new HttpError(400, `Touch ID / passkeys necesitan abrir Agentic en http://localhost${port && port !== host ? `:${port}` : ""} (no en una IP)`);
  }
  return { rpID: "localhost", origin: `http://${host}` };
}

export const SESSION_COOKIE_OPTS = { httpOnly: true, sameSite: "strict" as const, path: "/", maxAge: SESSION_TTL / 1000, secure: false };
export { nowIso as authNow };
