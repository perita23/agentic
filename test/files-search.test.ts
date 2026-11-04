import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { projectFiles, searchFiles } from "@/lib/server/files";
import { tmpDir } from "./helpers";

describe("@file autocomplete", () => {
  it("ranks basename matches first, finds folders and in-order fuzzy matches", () => {
    const files = ["src/", "src/app/", "src/app/user-service.ts", "src/lib/service.ts", "docs/services-overview.md", "README.md"];
    expect(searchFiles(files, "service").map((f) => f.path)).toEqual(["src/lib/service.ts", "docs/services-overview.md", "src/app/user-service.ts"]);
    expect(searchFiles(files, "usrsrv")[0].path).toBe("src/app/user-service.ts");
    expect(searchFiles(files, "src/app/")[0]).toEqual({ path: "src/app/", dir: true });
    expect(searchFiles(files, "zzz")).toEqual([]);
    expect(searchFiles(files, "", 3)).toHaveLength(3);
  });

  it("lists git files (tracked and new, not ignored) plus their folders", async () => {
    const dir = tmpDir("files-");
    execFileSync("git", ["init", "-q"], { cwd: dir });
    fs.mkdirSync(path.join(dir, "src/deep"), { recursive: true });
    fs.mkdirSync(path.join(dir, "node_modules/x"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
    fs.writeFileSync(path.join(dir, "src/deep/a.ts"), "x");
    fs.writeFileSync(path.join(dir, "node_modules/x/b.js"), "x");
    const files = await projectFiles(dir);
    expect(files).toContain("src/deep/a.ts");
    expect(files).toContain("src/deep/");
    expect(files.some((f) => f.includes("node_modules"))).toBe(false);
  });

  it("falls back to a bounded walk outside git", async () => {
    const dir = tmpDir("files-nogit-");
    fs.mkdirSync(path.join(dir, "a/node_modules"), { recursive: true });
    fs.writeFileSync(path.join(dir, "a/one.txt"), "x");
    fs.writeFileSync(path.join(dir, "a/node_modules/skip.txt"), "x");
    const files = await projectFiles(dir);
    expect(files).toContain("a/one.txt");
    expect(files.some((f) => f.includes("skip.txt"))).toBe(false);
  });
});
