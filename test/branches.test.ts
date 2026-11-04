import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { branchInfo, switchBranch } from "@/lib/server/branches";
import { tmpDir } from "./helpers";

const sh = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, encoding: "utf8" });

function repo() {
  const dir = tmpDir("branches-");
  sh(dir, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "a.txt"), "uno\n");
  sh(dir, "add", ".");
  sh(dir, "commit", "-q", "-m", "init");
  sh(dir, "branch", "feat/x");
  return dir;
}

describe("branch switching", () => {
  it("reports the current branch, the others and uncommitted files", async () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, "b.txt"), "x");
    expect(await branchInfo(dir)).toMatchObject({ isRepo: true, current: "main", detached: false, local: expect.arrayContaining(["main", "feat/x"]), dirty: 1 });
    expect((await branchInfo(tmpDir("nogit-"))).isRepo).toBe(false);
  });

  it("switches to an existing branch and creates new ones", async () => {
    const dir = repo();
    expect((await switchBranch(dir, { branch: "feat/x" })).current).toBe("feat/x");
    expect((await switchBranch(dir, { branch: "nueva", create: true })).current).toBe("nueva");
    await expect(switchBranch(dir, { branch: "nueva", create: true })).rejects.toThrow(/Ya existe/);
    await expect(switchBranch(dir, { branch: "no-existe" })).rejects.toThrow(/No existe/);
  });

  it("refuses names that could be flags or traversals", async () => {
    const dir = repo();
    for (const branch of ["--orphan", "-f", "a..b", "x.lock", "/abs", "a b"]) await expect(switchBranch(dir, { branch })).rejects.toThrow();
  });

  it("never discards your changes: git refuses and nothing moves", async () => {
    const dir = repo();
    sh(dir, "switch", "-q", "feat/x");
    fs.writeFileSync(path.join(dir, "a.txt"), "cambiado en feat\n");
    sh(dir, "commit", "-qam", "feat change");
    sh(dir, "switch", "-q", "main");
    fs.writeFileSync(path.join(dir, "a.txt"), "sin commit\n");
    await expect(switchBranch(dir, { branch: "feat/x" })).rejects.toThrow(/sin commit que se perderían/);
    expect((await branchInfo(dir)).current).toBe("main");
    expect(fs.readFileSync(path.join(dir, "a.txt"), "utf8")).toBe("sin commit\n");
  });
});
