import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { audit, hardenDataDir, readAudit } from "@/lib/server/audit";
import {
  assertNotRateLimited,
  createSession,
  putChallenge,
  readAuth,
  recordFailure,
  revokeOtherSessions,
  revokeSession,
  rpFromHost,
  sessionIdHash,
  takeChallenge,
  updateAuth,
  validateSession,
} from "@/lib/server/auth";
import { removePasskey, setRequirePasskey } from "@/lib/server/passkeys";
import { tmpDir } from "./helpers";

describe("server-side sessions", () => {
  it("stores only a hash of the session id, with 0600 permissions", () => {
    const d = tmpDir();
    const sid = createSession(d, "token", "Mozilla/5.0 Test");
    expect(sid).toMatch(/^[0-9a-f]{64}$/);
    const raw = fs.readFileSync(path.join(d, "auth.json"), "utf8");
    expect(raw).not.toContain(sid);
    expect(raw).toContain(sessionIdHash(sid));
    expect(fs.statSync(path.join(d, "auth.json")).mode & 0o777).toBe(0o600);
    expect(validateSession(d, sid)).toMatchObject({ method: "token" });
    expect(validateSession(d, "x".repeat(64))).toBeNull();
    expect(validateSession(d, undefined)).toBeNull();
  });

  it("expires idle and expired sessions, and supports revocation", () => {
    const d = tmpDir();
    const a = createSession(d, "token", "");
    const b = createSession(d, "passkey", "");
    const c = createSession(d, "token", "");
    updateAuth(d, (s) => {
      s.sessions[0].lastSeenAt = new Date(Date.now() - 8 * 86_400_000).toISOString(); // idle > 7 days
      s.sessions[1].expiresAt = new Date(Date.now() - 1000).toISOString();
    });
    expect(validateSession(d, a)).toBeNull();
    expect(validateSession(d, b)).toBeNull();
    expect(validateSession(d, c)).not.toBeNull();
    revokeSession(d, sessionIdHash(c));
    expect(validateSession(d, c)).toBeNull();
    expect(() => revokeSession(d, sessionIdHash(c))).toThrow(/no encontrada/);
    const e = createSession(d, "token", "");
    const f = createSession(d, "token", "");
    revokeOtherSessions(d, sessionIdHash(e));
    expect(validateSession(d, e)).not.toBeNull();
    expect(validateSession(d, f)).toBeNull();
  });

  it("only requires passkeys from a passkey session, ends token sessions, and protects the last passkey", () => {
    const d = tmpDir();
    const tokenSid = createSession(d, "token", "");
    expect(() => setRequirePasskey(d, true, validateSession(d, tokenSid))).toThrow(/Registra una passkey/);
    updateAuth(d, (s) => {
      s.passkeys.push({ id: "cred-1abcdefg", publicKey: "x", counter: 0, transports: ["internal"], name: "Touch ID", backedUp: false, createdAt: "", lastUsedAt: null });
    });
    expect(() => setRequirePasskey(d, true, validateSession(d, tokenSid))).toThrow(/Touch ID al menos una vez/);
    const pkSid = createSession(d, "passkey", "");
    setRequirePasskey(d, true, validateSession(d, pkSid));
    expect(readAuth(d).requirePasskey).toBe(true);
    expect(validateSession(d, tokenSid)).toBeNull(); // token sessions were closed
    expect(validateSession(d, pkSid)).not.toBeNull();
    expect(() => removePasskey(d, "cred-1abcdefg")).toThrow(/única passkey/);
    setRequirePasskey(d, false, null);
    removePasskey(d, "cred-1abcdefg");
    expect(readAuth(d).passkeys).toEqual([]);
    expect(readAudit(d).map((x) => x.event)).toEqual(["passkey.removed", "auth.requirePasskey", "auth.requirePasskey"]);
  });

  it("lets the macOS app (native Touch ID) require Touch ID without browser passkeys", () => {
    const d = tmpDir();
    const tokenSid = createSession(d, "token", "");
    const appSid = createSession(d, "desktop", "Agentic Desktop");
    expect(() => setRequirePasskey(d, true, validateSession(d, tokenSid))).toThrow(/Registra una passkey/);
    setRequirePasskey(d, true, validateSession(d, appSid));
    expect(readAuth(d).requirePasskey).toBe(true);
    expect(validateSession(d, tokenSid)).toBeNull();
    expect(validateSession(d, appSid)?.method).toBe("desktop");
  });
});

describe("challenges, rate limits and RP", () => {
  it("challenges are single-use and typed", () => {
    const id = putChallenge("abc", "login");
    expect(() => takeChallenge(id, "register")).toThrow(/caducado/);
    const id2 = putChallenge("abc", "login");
    expect(takeChallenge(id2, "login")).toBe("abc");
    expect(() => takeChallenge(id2, "login")).toThrow(/caducado/);
    expect(() => takeChallenge(undefined, "login")).toThrow();
  });

  it("rate limits repeated failures", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      assertNotRateLimited(key, 3);
      recordFailure(key);
    }
    expect(() => assertNotRateLimited(key, 3)).toThrow(/Demasiados intentos/);
  });

  it("requires localhost as relying party (WebAuthn rejects IPs)", () => {
    expect(rpFromHost("localhost:4317")).toEqual({ rpID: "localhost", origin: "http://localhost:4317" });
    expect(() => rpFromHost("127.0.0.1:4317")).toThrow(/http:\/\/localhost:4317/);
    expect(() => rpFromHost("evil.test")).toThrow();
  });
});

describe("audit log and data dir hardening", () => {
  it("appends JSON lines (0600) and reads newest first", () => {
    const d = tmpDir();
    audit(d, "a");
    audit(d, "b", { x: 1 });
    expect(readAudit(d)).toEqual([expect.objectContaining({ event: "b", detail: { x: 1 } }), expect.objectContaining({ event: "a" })]);
    expect(fs.statSync(path.join(d, "audit.log")).mode & 0o777).toBe(0o600);
  });

  it("tightens loose permissions on the data directory", () => {
    const d = tmpDir();
    fs.chmodSync(d, 0o755);
    fs.writeFileSync(path.join(d, "tasks.json"), "[]", { mode: 0o644 });
    fs.mkdirSync(path.join(d, "runs"), { mode: 0o777 });
    fs.writeFileSync(path.join(d, "runs", "x.ndjson"), "", { mode: 0o666 });
    hardenDataDir(d);
    expect(fs.statSync(d).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(d, "tasks.json")).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.join(d, "runs")).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(d, "runs", "x.ndjson")).mode & 0o777).toBe(0o600);
  });
});
