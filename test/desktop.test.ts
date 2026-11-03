import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readAuth, validateSession } from "@/lib/server/auth";
import { tmpDir } from "./helpers";

const require = createRequire(import.meta.url);
const { createDesktopSession } = require("../desktop/lib/session.cjs");
const { mergePaths, pickPort, waitForPort } = require("../desktop/lib/env.cjs");
const { checkForUpdate, compareVersions, pickAsset, verifySha512 } = require("../desktop/lib/updater.cjs");

describe("desktop session", () => {
  it("creates a session the server accepts, storing only its hash", () => {
    const d = tmpDir();
    const sid = createDesktopSession(d, { touchId: true });
    expect(validateSession(d, sid)).toMatchObject({ method: "desktop", userAgent: "Agentic Desktop" });
    expect(fs.readFileSync(path.join(d, "auth.json"), "utf8")).not.toContain(sid);
    expect(fs.statSync(path.join(d, "auth.json")).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(path.join(d, "audit.log"), "utf8")).toContain("desktop-touchid");
  });

  it("refuses to open a session without Touch ID when passkeys are required", () => {
    const d = tmpDir();
    fs.writeFileSync(path.join(d, "auth.json"), JSON.stringify({ userId: "u", requirePasskey: true, sessions: [], passkeys: [] }));
    expect(() => createDesktopSession(d, { touchId: false })).toThrow(/Touch ID es obligatorio/);
    const sid = createDesktopSession(d, { touchId: true });
    expect(validateSession(d, sid)?.method).toBe("desktop");
    expect(readAuth(d).requirePasskey).toBe(true);
  });
});

describe("desktop env helpers", () => {
  it("merges PATH lists without duplicates", () => {
    expect(mergePaths("/a:/b", "/b:/c", "")).toBe("/a:/b:/c");
  });
  it("picks a free port and waits for it", async () => {
    const port = await pickPort(0);
    expect(port).toBeGreaterThan(0);
    const net = await import("node:net");
    const srv = net.createServer().listen(port, "127.0.0.1");
    await waitForPort(port, "127.0.0.1", 2000);
    srv.close();
    await expect(waitForPort(1, "127.0.0.1", 300)).rejects.toThrow(/no arrancó/);
  });
});

describe("updater", () => {
  it("compares versions semantically", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBe(1);
  });

  const manifest = `version: 0.10.0
files:
  - url: Agentic-0.10.0-arm64-mac.zip
    sha512: AAAA
    size: 100
  - url: Agentic-0.10.0-mac.zip
    sha512: BBBB
    size: 200
  - url: Agentic-0.10.0-arm64.dmg
    sha512: CCCC
path: Agentic-0.10.0-mac.zip
sha512: BBBB
releaseDate: '2026-11-03T10:00:00.000Z'
`;

  it("picks the zip for the running architecture", () => {
    expect(pickAsset(manifest, "arm64")).toEqual({ version: "0.10.0", file: "Agentic-0.10.0-arm64-mac.zip", sha512: "AAAA", size: 100 });
    expect(pickAsset(manifest, "x64")).toMatchObject({ file: "Agentic-0.10.0-mac.zip", sha512: "BBBB" });
  });

  it("rejects malformed manifests and dangerous file names", () => {
    expect(() => pickAsset("not: [valid", "arm64")).toThrow();
    expect(() => pickAsset("version: 1\nfiles: []\n", "arm64")).toThrow(/no incluye/);
    expect(() => pickAsset("version: 1\nfiles:\n  - url: ../../evil.zip\n    sha512: A\n", "x64")).toThrow(/no válido/);
    // YAML tags cannot instantiate anything (FAILSAFE schema).
    expect(() => pickAsset("version: !!js/function 'x'\nfiles: []\n", "x64")).toThrow();
  });

  it("verifies SHA-512 in constant time", async () => {
    const d = tmpDir();
    const f = path.join(d, "a.zip");
    fs.writeFileSync(f, "contenido");
    const good = crypto.createHash("sha512").update("contenido").digest("base64");
    expect(await verifySha512(f, good)).toBe(true);
    expect(await verifySha512(f, crypto.createHash("sha512").update("otro").digest("base64"))).toBe(false);
    expect(await verifySha512(f, "short")).toBe(false);
  });
});

describe("update sources", () => {
  const manifest = "version: 0.11.0\nfiles:\n  - url: Agentic-0.11.0-arm64-mac.zip\n    sha512: abc\n    size: 10\npath: Agentic-0.11.0-arm64-mac.zip\nsha512: abc\n";
  const release = (repo: string) => ({ tag_name: "v0.11.0", assets: [{ name: "latest-mac.yml", url: `https://api.github.com/repos/perita23/${repo}/releases/assets/1` }] });
  afterEach(() => vi.unstubAllGlobals());

  function stub(publicExists: boolean) {
    const calls: { url: string; auth: string | null }[] = [];
    vi.stubGlobal("fetch", async (u: URL, init: { headers?: Record<string, string> }) => {
      const url = String(u);
      calls.push({ url, auth: init?.headers?.authorization ?? null });
      if (url.endsWith("/agentic-releases/releases/latest")) return publicExists ? Response.json(release("agentic-releases")) : new Response("", { status: 404 });
      if (url.endsWith("/agentic/releases/latest")) return Response.json(release("agentic"));
      if (url.includes("/releases/assets/")) return new Response(manifest);
      return new Response("", { status: 500 });
    });
    return calls;
  }

  it("uses the public releases repository without sending the token", async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "integrations.json"), JSON.stringify({ github: { token: "secret" } }));
    const calls = stub(true);
    const u = await checkForUpdate({ currentVersion: "0.10.0", arch: "arm64", dataDir: dir });
    expect(u.repo).toBe("agentic-releases");
    expect(calls.every((c) => c.auth === null)).toBe(true);
    expect(calls.some((c) => c.url.includes("/agentic/"))).toBe(false);
  });

  it("falls back to the private repository with the token when the public one is missing", async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "integrations.json"), JSON.stringify({ github: { token: "secret" } }));
    const calls = stub(false);
    const u = await checkForUpdate({ currentVersion: "0.10.0", arch: "arm64", dataDir: dir });
    expect(u.repo).toBe("agentic");
    expect(calls.find((c) => c.url.includes("/agentic-releases/"))?.auth).toBeNull();
    expect(calls.find((c) => c.url.endsWith("/agentic/releases/latest"))?.auth).toBe("Bearer secret");
  });
});

describe("desktop app lock", () => {
  const lock = require("../desktop/lib/lock.cjs");

  it("creates the password once, stores only a scrypt hash and verifies it", () => {
    const d = tmpDir();
    expect(lock.hasPassword(d)).toBe(false);
    expect(() => lock.createPassword(d, "corta")).toThrow(/al menos 8/);
    lock.createPassword(d, "contraseña-larga");
    expect(lock.hasPassword(d)).toBe(true);
    const raw = fs.readFileSync(path.join(d, "desktop-lock.json"), "utf8");
    expect(raw).not.toContain("contraseña-larga");
    expect(fs.statSync(path.join(d, "desktop-lock.json")).mode & 0o777).toBe(0o600);
    expect(lock.verifyPassword(d, "contraseña-larga")).toBe(true);
    expect(lock.verifyPassword(d, "otra-cosa-123")).toBe(false);
    expect(() => lock.createPassword(d, "sobrescribir-123")).toThrow(/Ya hay/);
  });

  it("changes the password only with the current one and toggles Touch ID", () => {
    const d = tmpDir();
    expect(() => lock.setTouchId(d, true)).toThrow(/contraseña/);
    lock.createPassword(d, "primera-clave");
    expect(() => lock.changePassword(d, "mal", "segunda-clave")).toThrow(/actual/);
    lock.changePassword(d, "primera-clave", "segunda-clave");
    expect(lock.verifyPassword(d, "segunda-clave")).toBe(true);
    expect(lock.touchIdEnabled(d)).toBe(false);
    lock.setTouchId(d, true);
    expect(lock.touchIdEnabled(d)).toBe(true);
    expect(lock.verifyPassword(d, "segunda-clave")).toBe(true);
  });

  it("slows down repeated wrong guesses", () => {
    const l = lock.createLimiter();
    for (let i = 0; i < 4; i++) l.fail();
    expect(() => l.check()).not.toThrow();
    l.fail();
    expect(() => l.check()).toThrow(/Espera/);
    l.reset();
    expect(() => l.check()).not.toThrow();
  });

  it("opens a desktop session after a password unlock even when Touch ID is required", () => {
    const d = tmpDir();
    fs.writeFileSync(path.join(d, "auth.json"), JSON.stringify({ userId: "u", requirePasskey: true, sessions: [], passkeys: [] }));
    const sid = createDesktopSession(d, { touchId: false, password: true });
    expect(validateSession(d, sid)?.method).toBe("desktop");
    expect(fs.readFileSync(path.join(d, "audit.log"), "utf8")).toContain("desktop-password");
    expect(() => createDesktopSession(d, { touchId: false })).toThrow(/obligatorio/);
  });
});
