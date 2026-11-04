import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createContext } from "@/lib/server/context";
import { conflicts, permissionsSchema } from "@/lib/server/permissions";
import { FAKE_CLAUDE, tmpDir } from "./helpers";

function setup() {
  const claudeHome = tmpDir();
  const project = tmpDir();
  const c = createContext({ dataDir: tmpDir(), claudeHome, claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 2, maxLogBytes: 1e6 });
  c.projects.create({ path: project, name: "demo" });
  return { c, claudeHome, project: fs.realpathSync(project) };
}

describe("Claude Code permissions", () => {
  it("reads and writes only the permissions block, keeping other settings", () => {
    const { c, claudeHome } = setup();
    const file = path.join(claudeHome, "settings.json");
    fs.writeFileSync(file, JSON.stringify({ model: "opus", permissions: { allow: ["Bash(ls)"], extra: 1 } }));
    expect(c.permissions.get({ scope: "user" }).permissions.allow).toEqual(["Bash(ls)"]);
    const res = c.permissions.save({ scope: "user", permissions: { allow: ["Bash(npm run test:*)", "Bash(npm run test:*)"], deny: ["Read(./.env)"], defaultMode: "acceptEdits" } });
    expect(res.permissions).toMatchObject({ allow: ["Bash(npm run test:*)"], deny: ["Read(./.env)"], ask: [], defaultMode: "acceptEdits" });
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(saved.model).toBe("opus");
    expect(saved.permissions).toEqual({ allow: ["Bash(npm run test:*)"], deny: ["Read(./.env)"], defaultMode: "acceptEdits", extra: 1 });
  });

  it("writes project and local files only for known projects", () => {
    const { c, project } = setup();
    c.permissions.save({ scope: "local", projectPath: project, permissions: { ask: ["Bash(git push:*)"] } });
    expect(JSON.parse(fs.readFileSync(path.join(project, ".claude", "settings.local.json"), "utf8")).permissions.ask).toEqual(["Bash(git push:*)"]);
    expect(() => c.permissions.save({ scope: "project", projectPath: "/etc", permissions: {} })).toThrow(/desconocido/);
  });

  it("refuses to overwrite invalid JSON and validates rules", () => {
    const { c, claudeHome } = setup();
    fs.writeFileSync(path.join(claudeHome, "settings.json"), "{ nope");
    expect(() => c.permissions.save({ scope: "user", permissions: {} })).toThrow(/JSON/);
    expect(() => permissionsSchema.parse({ allow: ["rm -rf /"] })).toThrow();
    expect(() => permissionsSchema.parse({ defaultMode: "yolo" })).toThrow();
    expect(conflicts(permissionsSchema.parse({ allow: ["Edit"], deny: ["Edit"] }))).toEqual(["Edit"]);
  });
});
