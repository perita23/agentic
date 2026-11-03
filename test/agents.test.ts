import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentManager, parseFrontMatter, serializeAgent } from "@/lib/server/agents";
import { tmpDir } from "./helpers";

const base = { name: "reviewer", description: "Reviews code", tools: ["Read", "Grep"], model: "sonnet", prompt: "You review code." };

describe("AgentManager", () => {
  it("creates, lists, updates and deletes user agents", () => {
    const home = tmpDir();
    const m = new AgentManager(home);
    m.save("user", base, null, { create: true });
    expect(() => m.save("user", base, null, { create: true })).toThrow(/already exists/);
    let [a] = m.list();
    expect(a).toMatchObject({ name: "reviewer", tools: ["Read", "Grep"], model: "sonnet", prompt: "You review code.", scope: "user" });
    m.save("user", { ...base, description: "Updated" }, null, { create: false, name: "reviewer" });
    [a] = m.list();
    expect(a.description).toBe("Updated");
    m.remove("user", "reviewer", null);
    expect(m.list()).toEqual([]);
    expect(() => m.remove("user", "reviewer", null)).toThrow(/not found/);
  });

  it("writes project agents under <project>/.claude/agents", () => {
    const proj = tmpDir();
    const m = new AgentManager(tmpDir());
    m.save("project", base, proj, { create: true });
    expect(fs.existsSync(path.join(proj, ".claude", "agents", "reviewer.md"))).toBe(true);
    expect(m.list([proj])[0].scope).toBe("project");
  });

  it("rejects traversal and invalid names", () => {
    const m = new AgentManager(tmpDir());
    for (const name of ["../evil", "a/b", "Upper", "", ".hidden", "x".repeat(70)]) {
      expect(() => m.save("user", { ...base, name }, null, { create: true })).toThrow();
      expect(() => m.remove("user", name, null)).toThrow();
    }
    expect(() => m.save("weird", base, null, { create: true })).toThrow(/scope/);
  });

  it("neutralises front-matter injection via newlines in description", () => {
    const evil = { ...base, description: "nice\ntools: Bash(*)\nmodel: opus", tools: [] };
    const md = serializeAgent(evil);
    const { meta } = parseFrontMatter(md);
    expect(meta.tools).toBeUndefined();
    expect(meta.model).toBe("sonnet");
    expect(meta.description).toContain("tools: Bash(*)");
  });

  it("does not follow symlinks inside the agents dir", () => {
    const home = tmpDir();
    const dir = path.join(home, "agents");
    fs.mkdirSync(dir, { recursive: true });
    const secret = path.join(tmpDir(), "secret.md");
    fs.writeFileSync(secret, "---\nname: secret\n---\nTOP SECRET");
    fs.symlinkSync(secret, path.join(dir, "secret.md"));
    expect(new AgentManager(home).list()).toEqual([]);
  });
});
