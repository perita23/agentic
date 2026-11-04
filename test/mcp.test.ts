import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createContext } from "@/lib/server/context";
import { buildMcpAddArgs, mcpAddSchema } from "@/lib/server/mcp";
import { FAKE_CLAUDE, tmpDir } from "./helpers";

afterEach(() => delete process.env.FAKE_CLAUDE_LOG);

function setup() {
  const root = tmpDir();
  const claudeHome = path.join(root, ".claude");
  fs.mkdirSync(claudeHome);
  const project = tmpDir();
  const c = createContext({ dataDir: tmpDir(), claudeHome, claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 2, maxLogBytes: 1e6 });
  c.projects.create({ path: project, name: "demo" });
  return { c, root, project: fs.realpathSync(project) };
}

describe("MCP servers", () => {
  it("lists user, local and project servers without exposing secret values", () => {
    const { c, root, project } = setup();
    fs.writeFileSync(
      path.join(root, ".claude.json"),
      JSON.stringify({
        mcpServers: { playwright: { command: "npx", args: ["-y", "@playwright/mcp"], env: { TOKEN: "secret-123" } } },
        projects: { [project]: { mcpServers: { docs: { type: "http", url: "https://user:pw@docs.example/mcp", headers: { Authorization: "Bearer xyz" } } } } },
      }),
    );
    fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({ mcpServers: { shared: { type: "sse", url: "https://sse.example/mcp" } } }));
    const list = c.mcp.list();
    expect(list.map((s) => [s.scope, s.name, s.type])).toEqual([
      ["local", "docs", "http"],
      ["project", "shared", "sse"],
      ["user", "playwright", "stdio"],
    ]);
    expect(list.find((s) => s.name === "playwright")?.envKeys).toEqual(["TOKEN"]);
    const json = JSON.stringify(list);
    for (const secret of ["secret-123", "Bearer xyz", "user:pw"]) expect(json).not.toContain(secret);
  });

  it("builds `claude mcp add` arguments for local and remote servers", () => {
    expect(buildMcpAddArgs(mcpAddSchema.parse({ name: "pw", command: "npx", args: ["-y", "@playwright/mcp"], env: { A: "1" } }))).toEqual(["mcp", "add", "--scope", "user", "--env", "A=1", "pw", "--", "npx", "-y", "@playwright/mcp"]);
    expect(buildMcpAddArgs(mcpAddSchema.parse({ name: "c7", type: "http", url: "https://mcp.context7.com/mcp", headers: { Authorization: "Bearer t" } }))).toEqual([
      "mcp",
      "add",
      "--scope",
      "user",
      "--transport",
      "http",
      "--header",
      "Authorization: Bearer t",
      "c7",
      "https://mcp.context7.com/mcp",
    ]);
    expect(() => mcpAddSchema.parse({ name: "x; rm -rf /", command: "npx" })).toThrow();
    expect(() => mcpAddSchema.parse({ name: "x", type: "http", url: "file:///etc/passwd" })).toThrow();
    expect(() => mcpAddSchema.parse({ name: "x", command: "npx", scope: "project" })).toThrow();
  });

  it("adds and removes through the claude CLI, in the right folder, and reports its errors", async () => {
    const { c, project } = setup();
    const log = path.join(tmpDir(), "calls.ndjson");
    process.env.FAKE_CLAUDE_LOG = log;
    await c.mcp.add({ name: "pw", command: "npx", args: ["-y", "@playwright/mcp"], scope: "project", projectPath: project });
    await c.mcp.remove({ name: "pw", scope: "project", projectPath: project });
    const calls = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(calls[0]).toMatchObject({ args: ["mcp", "add", "--scope", "project", "pw", "--", "npx", "-y", "@playwright/mcp"], cwd: project });
    expect(calls[1]).toMatchObject({ args: ["mcp", "remove", "--scope", "project", "pw"], cwd: project });
    await expect(c.mcp.add({ name: "broken", command: "npx" })).rejects.toThrow(/invalid MCP configuration/);
    await expect(c.mcp.add({ name: "pw", command: "npx", scope: "local", projectPath: "/not/a/project" })).rejects.toThrow(/Proyecto desconocido/);
  });
});
