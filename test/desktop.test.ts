import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { readAuth, validateSession } from "@/lib/server/auth";
import { tmpDir } from "./helpers";

const require = createRequire(import.meta.url);
const { createDesktopSession } = require("../desktop/lib/session.cjs");
const { mergePaths, pickPort, waitForPort } = require("../desktop/lib/env.cjs");
const { compareVersions, pickAsset, verifySha512 } = require("../desktop/lib/updater.cjs");

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
