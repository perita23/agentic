import { describe, expect, it } from "vitest";
import { assertRequestAllowed, hostnameOf, isAllowedHost, parseCookies, safeEqual, loadOrCreateToken } from "@/lib/server/security";
import { createSession, SESSION_COOKIE, updateAuth } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/util";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers";

const TOKEN = "a".repeat(64);
const req = (method: string, headers: Record<string, string>) => new Request("http://127.0.0.1:4317/api/x", { method, headers });
const code = (fn: () => void) => {
  try {
    fn();
    return 200;
  } catch (e) {
    return (e as HttpError).status;
  }
};
const DATA = tmpDir();
const SID = createSession(DATA, "token", "test");
const CTX = { token: TOKEN, dataDir: DATA };
const auth = { host: "127.0.0.1:4317", cookie: `${SESSION_COOKIE}=${SID}` };

describe("security", () => {
  it("parses hostnames incl. IPv6", () => {
    expect(hostnameOf("127.0.0.1:4317")).toBe("127.0.0.1");
    expect(hostnameOf("[::1]:4317")).toBe("[::1]");
    expect(hostnameOf("LOCALHOST")).toBe("localhost");
  });

  it("allows only loopback hosts (DNS rebinding)", () => {
    expect(isAllowedHost("localhost:3000")).toBe(true);
    expect(isAllowedHost("evil.com:4317")).toBe(false);
    expect(isAllowedHost("127.0.0.1.evil.com")).toBe(false);
    expect(isAllowedHost(null)).toBe(false);
  });

  it("constant-time token compare handles junk", () => {
    expect(safeEqual(TOKEN, TOKEN)).toBe(true);
    expect(safeEqual(TOKEN, TOKEN + "x")).toBe(false);
    expect(safeEqual(undefined, TOKEN)).toBe(false);
  });

  it("parses cookies defensively", () => {
    expect(parseCookies("a=1; b=%ZZ; =x; c")).toEqual({ a: "1", b: "%ZZ" });
  });

  it("enforces host, auth, origin, fetch-site and content-type", () => {
    expect(code(() => assertRequestAllowed(req("GET", auth), CTX))).toBe(200);
    expect(code(() => assertRequestAllowed(req("GET", { host: "127.0.0.1:4317", authorization: `Bearer ${TOKEN}` }), CTX))).toBe(200);
    expect(code(() => assertRequestAllowed(req("GET", { ...auth, host: "attacker.test" }), CTX))).toBe(421);
    expect(code(() => assertRequestAllowed(req("GET", { host: auth.host }), CTX))).toBe(401);
    expect(code(() => assertRequestAllowed(req("GET", { host: auth.host, cookie: `agentic_token=${TOKEN}` }), CTX))).toBe(401);
    // requirePasskey disables the Bearer master token, but sessions keep working
    updateAuth(DATA, (st) => {
      st.requirePasskey = true;
    });
    expect(code(() => assertRequestAllowed(req("GET", { host: "127.0.0.1:4317", authorization: `Bearer ${TOKEN}` }), CTX))).toBe(401);
    expect(code(() => assertRequestAllowed(req("GET", auth), CTX))).toBe(200);
    updateAuth(DATA, (st) => {
      st.requirePasskey = false;
    });
    expect(code(() => assertRequestAllowed(req("GET", { host: auth.host, cookie: `${SESSION_COOKIE}=${"b".repeat(64)}` }), CTX))).toBe(401);
    const json = { ...auth, "content-type": "application/json" };
    expect(code(() => assertRequestAllowed(req("POST", json), CTX))).toBe(200);
    expect(code(() => assertRequestAllowed(req("POST", { ...json, origin: "http://127.0.0.1:4317" }), CTX))).toBe(200);
    expect(code(() => assertRequestAllowed(req("POST", { ...json, origin: "https://evil.example" }), CTX))).toBe(403);
    expect(code(() => assertRequestAllowed(req("POST", { ...json, origin: "null" }), CTX))).toBe(403);
    expect(code(() => assertRequestAllowed(req("POST", { ...json, "sec-fetch-site": "cross-site" }), CTX))).toBe(403);
    expect(code(() => assertRequestAllowed(req("POST", { ...auth, "content-type": "text/plain" }), CTX))).toBe(415);
    expect(code(() => assertRequestAllowed(req("POST", { ...auth, "content-type": "application/x-www-form-urlencoded" }), CTX))).toBe(415);
    expect(code(() => assertRequestAllowed(req("DELETE", auth), CTX))).toBe(200);
    expect(code(() => assertRequestAllowed(req("DELETE", { ...auth, origin: "https://evil.example" }), CTX))).toBe(403);
  });

  it("creates a 0600 token file and reuses it", () => {
    const d = tmpDir();
    const t = loadOrCreateToken(d);
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(loadOrCreateToken(d)).toBe(t);
    expect(fs.statSync(path.join(d, "token")).mode & 0o777).toBe(0o600);
    fs.writeFileSync(path.join(d, "token"), "weak");
    expect(loadOrCreateToken(d)).not.toBe("weak");
  });
});
