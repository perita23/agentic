import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createContext } from "@/lib/server/context";
import { FAKE_CLAUDE, tmpDir } from "./helpers";

function setup() {
  const project = fs.realpathSync(tmpDir("proj-"));
  const dataDir = tmpDir();
  const c = createContext({ dataDir, claudeHome: tmpDir(), claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 2, maxLogBytes: 1e6 });
  c.projects.create({ path: project, name: "demo" });
  c.tasks.create({ title: "Tarea A", projectPath: project });
  c.integrations.saveConnection("github", { token: "ghp_supersecret1234567890" });
  return { c, project, dataDir };
}

describe("backups", () => {
  it("exports Agentic data without credentials", () => {
    const { c } = setup();
    const snap = c.backups.snapshot();
    expect(snap.app).toBe("agentic");
    expect(Object.keys(snap.collections)).toEqual(expect.arrayContaining(["tasks", "projects"]));
    expect(JSON.stringify(snap)).not.toContain("ghp_supersecret");
    expect(snap.collections).not.toHaveProperty("integrations");
    // Collections that were never written stay absent and do not poison the cache.
    expect(snap.collections).not.toHaveProperty("schedules");
    expect(c.schedules.list()).toEqual([]);
  });

  it("restores a backup after saving a safety copy, and rejects foreign files", () => {
    const { c } = setup();
    const snap = c.backups.snapshot();
    c.tasks.create({ title: "Tarea B" });
    expect(c.tasks.list()).toHaveLength(2);
    const res = c.backups.restore(snap, false);
    expect(res.restored).toContain("tasks");
    expect(c.tasks.list().map((t) => t.title)).toEqual(["Tarea A"]);
    // The safety copy holds the data from before the restore.
    expect((c.backups.read(res.safetyCopy).collections.tasks as unknown[]).length).toBe(2);
    expect(() => c.backups.restore({ app: "otra", format: 1, version: "1", createdAt: "x", collections: {} }, false)).toThrow(/Agentic/);
    expect(() => c.backups.restore({ ...snap, collections: { tasks: "nope" } }, false)).toThrow(/tasks/);
    expect(() => c.backups.restore(snap, true)).toThrow(/en marcha/);
    expect(() => c.backups.read("../../etc/passwd")).toThrow();
  });

  it("keeps one automatic copy per day, the last 7", () => {
    const { c } = setup();
    for (let d = 1; d <= 10; d++) c.backups.autoBackup(new Date(Date.UTC(2026, 10, d, 12)));
    expect(c.backups.autoBackup(new Date(Date.UTC(2026, 10, 10, 18)))).toBeNull();
    const list = c.backups.list();
    expect(list.filter((b) => b.automatic)).toHaveLength(7);
    for (const b of list) expect(fs.statSync(path.join(c.backups.dir(), b.name)).mode & 0o077).toBe(0);
  });

  it("wipes everything (credentials included) but keeps login", () => {
    const { c, dataDir } = setup();
    c.backups.save("manual");
    const token = c.token;
    c.backups.wipe();
    expect(c.tasks.list()).toEqual([]);
    expect(c.integrations.status().github).toMatchObject({ configured: false });
    expect(fs.existsSync(path.join(dataDir, "integrations.json"))).toBe(false);
    expect(c.backups.list()).toHaveLength(1);
    expect(fs.readdirSync(dataDir).some((f) => f.includes("token"))).toBe(true);
    expect(c.token).toBe(token);
    c.backups.wipe({ includeBackups: true });
    expect(c.backups.list()).toHaveLength(0);
  });
});
