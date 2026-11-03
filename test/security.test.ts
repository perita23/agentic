import { describe, expect, it } from "vitest";
import { assertRequestAllowed, hostnameOf, isAllowedHost, parseCookies, safeEqual, COOKIE_NAME, loadOrCreateToken } from "@/lib/server/security";
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
const auth = { host: "127.0.0.1:4317", cookie: `${COOKIE_NAME}=${TOKEN}` };

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
    expect(code(() => assertRequestAllowed(req("GET", auth), TOKEN))).toBe(200);
    expect(code(() => assertRequestAllowed(req("GET", { host: "127.0.0.1:4317", authorization: `Bearer ${TOKEN}` }), TOKEN))).toBe(200);
    expect(code(() => assertRequestAllowed(req("GET", { ...auth, host: "attacker.test" }), TOKEN))).toBe(421);
    expect(code(() => assertRequestAllowed(req("GET", { host: auth.host }), TOKEN))).toBe(401);
    expect(code(() => assertRequestAllowed(req("GET", { host: auth.host, cookie: `${COOKIE_NAME}=${"b".repeat(64)}` }), TOKEN))).toBe(401);
    const json = { ...auth, "content-type": "application/json" };
    expect(code(() => assertRequestAllowed(req("POST", json), TOKEN))).toBe(200);
    expect(code(() => assertRequestAllowed(req("POST", { ...json, origin: "http://127.0.0.1:4317" }), TOKEN))).toBe(200);
    expect(code(() => assertRequestAllowed(req("POST", { ...json, origin: "https://evil.example" }), TOKEN))).toBe(403);
    expect(code(() => assertRequestAllowed(req("POST", { ...json, origin: "null" }), TOKEN))).toBe(403);
    expect(code(() => assertRequestAllowed(req("POST", { ...json, "sec-fetch-site": "cross-site" }), TOKEN))).toBe(403);
    expect(code(() => assertRequestAllowed(req("POST", { ...auth, "content-type": "text/plain" }), TOKEN))).toBe(415);
    expect(code(() => assertRequestAllowed(req("POST", { ...auth, "content-type": "application/x-www-form-urlencoded" }), TOKEN))).toBe(415);
    expect(code(() => assertRequestAllowed(req("DELETE", auth), TOKEN))).toBe(200);
    expect(code(() => assertRequestAllowed(req("DELETE", { ...auth, origin: "https://evil.example" }), TOKEN))).toBe(403);
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
