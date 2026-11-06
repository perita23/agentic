import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createContext } from "@/lib/server/context";
import { FAKE_CLAUDE, tmpDir } from "./helpers";

const ID = "3f2b8a10-5c4d-4e6f-8a7b-9c0d1e2f3a4b";
const LIVE = "7a1c2d3e-4f50-4a61-8b72-0c9d8e7f6a5b";

function setup() {
  const claudeHome = tmpDir();
  const dataDir = tmpDir();
  const dir = path.join(claudeHome, "projects", "-tmp-demo");
  fs.mkdirSync(dir, { recursive: true });
  const line = (o: object) => JSON.stringify(o) + "\n";
  for (const id of [ID, LIVE]) fs.writeFileSync(path.join(dir, `${id}.jsonl`), line({ type: "user", cwd: "/tmp/demo", timestamp: new Date().toISOString(), message: { role: "user", content: `Sesión ${id.slice(0, 4)}` } }));
  fs.mkdirSync(path.join(dir, ID, "subagents"), { recursive: true });
  fs.writeFileSync(path.join(dir, ID, "subagents", "a.jsonl"), "{}\n");
  const c = createContext({ dataDir, claudeHome, claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 2, maxLogBytes: 1e6 });
  return { c, claudeHome, dir };
}

describe("session trash", () => {
  it("moves a session (and its folder) to the trash and restores it", () => {
    const { c, dir } = setup();
    const item = c.trash.remove(ID);
    expect(item).toMatchObject({ id: ID, title: expect.stringContaining("Sesión 3f2b"), cwd: "/tmp/demo" });
    expect(fs.existsSync(path.join(dir, `${ID}.jsonl`))).toBe(false);
    expect(fs.existsSync(path.join(dir, ID))).toBe(false);
    expect(c.sessions.list().some((s) => s.id === ID)).toBe(false);
    expect(c.trash.list().map((i) => i.id)).toEqual([ID]);

    c.trash.restore(ID);
    expect(fs.existsSync(path.join(dir, `${ID}.jsonl`))).toBe(true);
    expect(fs.existsSync(path.join(dir, ID, "subagents", "a.jsonl"))).toBe(true);
    expect(c.trash.list()).toEqual([]);
    expect(c.sessions.list().some((s) => s.id === ID)).toBe(true);
  });

  it("never touches a running session and validates ids", () => {
    const { c, claudeHome, dir } = setup();
    fs.mkdirSync(path.join(claudeHome, "sessions"), { recursive: true });
    fs.writeFileSync(path.join(claudeHome, "sessions", `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: LIVE, cwd: "/tmp/demo", status: "busy", startedAt: Date.now(), updatedAt: Date.now() }));
    expect(() => c.trash.remove(LIVE)).toThrow(/en marcha/);
    expect(fs.existsSync(path.join(dir, `${LIVE}.jsonl`))).toBe(true);
    expect(() => c.trash.remove("../../etc/passwd")).toThrow(/invalid/);
    expect(() => c.trash.remove("00000000-0000-4000-8000-000000000000")).toThrow(/no encontrada/);
    expect(() => c.trash.restore(ID)).toThrow(/papelera/);
  });

  it("refuses to restore over an existing session, purges for good and expires old entries", () => {
    const { c, dir } = setup();
    c.trash.remove(ID);
    fs.writeFileSync(path.join(dir, `${ID}.jsonl`), "{}\n");
    expect(() => c.trash.restore(ID)).toThrow(/Ya existe/);
    c.trash.purge(ID);
    expect(c.trash.list()).toEqual([]);

    fs.rmSync(path.join(dir, `${ID}.jsonl`));
    fs.writeFileSync(path.join(dir, `${ID}.jsonl`), "{}\n");
    c.trash.remove(ID);
    const meta = path.join(c.config.dataDir, "trash", "sessions", ID, "meta.json");
    const m = JSON.parse(fs.readFileSync(meta, "utf8"));
    fs.writeFileSync(meta, JSON.stringify({ ...m, deletedAt: new Date(Date.now() - 31 * 86_400_000).toISOString() }));
    expect(c.trash.list()).toEqual([]); // 31 days old: gone
    expect(fs.existsSync(path.dirname(meta))).toBe(false);
  });
});

describe("menu preferences", () => {
  it("stores hidden menu items but never Dashboard or Ajustes", () => {
    const { c } = setup();
    expect(c.prefs.get()).toEqual({ hiddenNav: [], island: { enabled: true, working: true, alerts: true }, voice: { enabled: true, holdSpace: true, lang: "auto", autoSend: false } });
    expect(c.prefs.set({ hiddenNav: ["/mcp", "/", "/settings", "/mcp", "/jira"] }).hiddenNav).toEqual(["/mcp", "/jira"]);
    expect(c.prefs.set({ voice: { lang: "en-US", autoSend: true } }).voice).toEqual({ enabled: true, holdSpace: true, lang: "en-US", autoSend: true });
    expect(() => c.prefs.set({ voice: { lang: "no es un idioma" } })).toThrow();
    expect(c.prefs.set({ island: { enabled: false } })).toMatchObject({ hiddenNav: ["/mcp", "/jira"], island: { enabled: false, working: true, alerts: true } });
    expect(c.prefs.get().hiddenNav).toEqual(["/mcp", "/jira"]);
    expect(() => c.prefs.set({ hiddenNav: ["javascript:alert(1)"] })).toThrow();
    expect(Object.keys(c.backups.snapshot().collections)).toContain("prefs");
  });
});
