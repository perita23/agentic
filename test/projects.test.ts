import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectService } from "@/lib/server/projects";
import { SessionIndex } from "@/lib/server/sessions";
import { JsonStore } from "@/lib/server/store";
import { makeClaudeHome, tmpDir } from "./helpers";

function gitRepo() {
  const dir = tmpDir("repo-");
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  g("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "vitest" }, dependencies: { a: "1" } }));
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# Reglas");
  g("add", ".");
  g("commit", "-qm", "first");
  fs.writeFileSync(path.join(dir, "new.txt"), "x");
  return dir;
}

describe("ProjectService", () => {
  it("discovers projects from sessions and merges registered ones", () => {
    const cwd = tmpDir();
    const { home } = makeClaudeHome(cwd);
    const svc = new ProjectService(new JsonStore(tmpDir()), new SessionIndex(home));
    let list = svc.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ path: cwd, registered: false, sessionCount: 2, activeSessions: 1 });
    const p = svc.create({ path: cwd, name: "Mi proyecto", tags: ["web"] });
    list = svc.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Mi proyecto", registered: true, sessionCount: 2 });
    expect(() => svc.create({ path: cwd })).toThrow(/already/);
    svc.update(p.id, { pinned: true });
    expect(() => svc.update(p.id, { path: "/etc" })).toThrow();
    svc.remove(p.id);
    expect(svc.list()[0].registered).toBe(false);
  });

  it("returns git/CLAUDE.md/package info and refuses unknown paths", async () => {
    const repo = gitRepo();
    const svc = new ProjectService(new JsonStore(tmpDir()), new SessionIndex("/nonexistent"));
    await expect(svc.info(repo)).rejects.toMatchObject({ status: 404 });
    svc.create({ path: repo });
    const info = await svc.info(fs.realpathSync(repo));
    expect(info.git).toMatchObject({ branch: "main", changes: 1, commitCount: 1 });
    expect(info.git!.lastCommit!.subject).toBe("first");
    expect(info.claudeMd).toBe("# Reglas");
    expect(info.scripts).toEqual({ test: "vitest" });
    expect(info.stack).toContain("JavaScript/TypeScript");
  });

  it("does not execute repo-configured fsmonitor hooks (malicious repo)", async () => {
    const repo = gitRepo();
    const marker = path.join(tmpDir(), "pwned");
    const hook = path.join(repo, "evil.sh");
    fs.writeFileSync(hook, `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
    execFileSync("git", ["config", "core.fsmonitor", hook], { cwd: repo });
    const svc = new ProjectService(new JsonStore(tmpDir()), new SessionIndex("/nonexistent"));
    svc.create({ path: repo });
    await svc.info(fs.realpathSync(repo));
    expect(fs.existsSync(marker)).toBe(false);
  });
});
