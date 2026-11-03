import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { git } from "@/lib/server/git";
import { RunManager, type Run } from "@/lib/server/runs";
import { JsonStore } from "@/lib/server/store";
import { FAKE_CLAUDE, tmpDir, waitFor } from "./helpers";

const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function repo() {
  const dir = tmpDir("diff-repo-");
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, env: ENV });
  g("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "tracked.txt"), "one\n");
  fs.writeFileSync(path.join(dir, "dirty-before.txt"), "a\n");
  fs.writeFileSync(path.join(dir, "old-name.txt"), "same content for rename detection\n".repeat(5));
  g("add", ".");
  g("commit", "-qm", "init");
  fs.writeFileSync(path.join(dir, "dirty-before.txt"), "a\nb\n"); // pre-existing change
  fs.writeFileSync(path.join(dir, "untracked-before.txt"), "x\n");
  return { dir, g };
}

function mgr() {
  const dataDir = tmpDir();
  return new RunManager(new JsonStore(dataDir), { dataDir, claudeBin: FAKE_CLAUDE, maxConcurrent: 2, maxLogBytes: 1e6 });
}
const done = (m: RunManager, id: string) => waitFor(() => (m.get(id).status !== "running" ? m.get(id) : null)) as Promise<Run>;

describe("run diff", () => {
  it("captures a baseline and reports what the run changed", async () => {
    const { dir, g } = repo();
    const m = mgr();
    const r = await m.start({ projectPath: dir, prompt: "EDIT please" });
    expect(r.git?.head).toMatch(/^[0-9a-f]{40}$/);
    expect(r.git?.preDirty).toEqual(["dirty-before.txt"]);
    expect(r.git?.preUntracked).toEqual(["untracked-before.txt"]);
    await done(m, r.id);
    g("add", "tracked.txt");
    g("commit", "-qm", "claude commit");

    const d = await m.diff(r.id);
    expect(d.available).toBe(true);
    const byFile = Object.fromEntries(d.files.map((f) => [f.file, f]));
    expect(byFile["tracked.txt"]).toMatchObject({ status: "M", additions: 1, deletions: 0, preExisting: false });
    expect(byFile["dirty-before.txt"].preExisting).toBe(true);
    expect(d.commits.map((c) => c.subject)).toEqual(["claude commit"]);
    // An unstaged rename shows up as a deletion plus a new untracked file.
    expect(byFile["old-name.txt"].status).toBe("D");
    expect(d.newFiles.map((f) => f.file).sort()).toEqual(["created-by-claude.txt", "new-name.txt"]);
    expect(d.newFiles.find((f) => f.file === "created-by-claude.txt")?.content).toBe("hello from claude\n");
    expect(d.newFiles.some((f) => f.file === "untracked-before.txt")).toBe(false);
    expect(d.patch).toContain("+line added by claude");
    // The baseline must not have touched the repo (no stash entries, same status).
    expect(execFileSync("git", ["stash", "list"], { cwd: dir }).toString()).toBe("");
  });

  it("does not misattribute files when the untracked set is huge", async () => {
    const { dir } = repo();
    const big = path.join(dir, "vendor");
    fs.mkdirSync(big);
    for (let i = 0; i < 5001; i++) fs.writeFileSync(path.join(big, `f${i}`), "");
    const m = mgr();
    const r = await m.start({ projectPath: dir, prompt: "EDIT" });
    expect(r.git).toMatchObject({ untrackedUnknown: true, preUntracked: [] });
    await done(m, r.id);
    const d = await m.diff(r.id);
    expect(d.newFiles).toEqual([]);
    expect(d.files.some((f) => f.file === "tracked.txt")).toBe(true);
  });

  it("reports runs outside a git repository as unavailable", async () => {
    const m = mgr();
    const r = await m.start({ projectPath: tmpDir(), prompt: "x" });
    expect(r.git).toBeNull();
    await done(m, r.id);
    expect((await m.diff(r.id)).available).toBe(false);
  });

  it("never runs filters/textconv/diff drivers configured by a hostile repo", async () => {
    const { dir, g } = repo();
    const marker = path.join(tmpDir(), "pwned");
    fs.mkdirSync(path.join(dir, ".git", "info"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".git", "info", "attributes"), "*.txt filter=evil diff=evil\n");
    fs.writeFileSync(path.join(dir, ".gitattributes"), "*.txt filter=evil2 diff=evil2\n");
    for (const [k, v] of [
      ["filter.evil.clean", `touch ${marker}; cat`],
      ["filter.evil.process", `touch ${marker}`],
      ["filter.evil2.clean", `touch ${marker}; cat`],
      ["diff.evil.textconv", `touch ${marker}; cat`],
      ["diff.evil2.command", `touch ${marker}`],
      ["core.fsmonitor", `touch ${marker}; false`],
      ["core.pager", `touch ${marker}; cat`],
    ])
      g("config", k, v);
    // Make the index stale so git must re-read (and would normally filter) files.
    const old = new Date("2001-01-01");
    for (const f of ["tracked.txt", "dirty-before.txt"]) fs.utimesSync(path.join(dir, f), old, old);

    const m = mgr();
    const r = await m.start({ projectPath: dir, prompt: "EDIT" });
    await done(m, r.id);
    const d = await m.diff(r.id);
    expect(d.available).toBe(true);
    expect(d.patch).toContain("+line added by claude");
    expect(await git(dir, ["status", "--porcelain"])).not.toBeNull();
    expect(fs.existsSync(marker)).toBe(false);
  });
});
