import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const { buildLockPage } = createRequire(import.meta.url)("../desktop/lib/lock-page.cjs");

describe("lock window page", () => {
  it("is self-contained (no file:// loads) with a nonce-only script policy", () => {
    const url: string = buildLockPage(path.join(__dirname, "../desktop"));
    expect(url.startsWith("data:text/html;charset=utf-8;base64,")).toBe(true);
    const html = Buffer.from(url.split(",")[1], "base64").toString("utf8");
    const nonce = /script-src 'nonce-([^']+)'/.exec(html)?.[1];
    expect(nonce).toBeTruthy();
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(html).not.toContain('src="lock.js"');
    expect(html).not.toContain("script-src 'self'");
    expect(html).toContain("agenticLock.onState"); // lock.js inlined
    expect(buildLockPage(path.join(__dirname, "../desktop"))).not.toBe(url); // fresh nonce per load
  });
});
