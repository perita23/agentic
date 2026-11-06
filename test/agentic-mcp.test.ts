import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { enabledTools, handleRpc, TOOLS } from "@/lib/server/agentic-mcp";
import { createContext } from "@/lib/server/context";
import { buildClaudeArgs } from "@/lib/server/runs";
import { FAKE_CLAUDE, tmpDir } from "./helpers";

function setup() {
  const claudeHome = tmpDir();
  const dataDir = tmpDir();
  const c = createContext({ dataDir, claudeHome, claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 2, maxLogBytes: 1e6 });
  return { c, dataDir };
}
const rpc = async (c: ReturnType<typeof setup>["c"], method: string, params?: object, id: number | undefined = 1) => (await handleRpc(c, { jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method, params })) as { result?: Record<string, unknown>; error?: { code: number; message: string } } | null;
const call = async (c: ReturnType<typeof setup>["c"], name: string, args: object = {}) => {
  const r = (await rpc(c, "tools/call", { name, arguments: args }))!;
  const out = r.result as { content: { text: string }[]; isError?: boolean } | undefined;
  return { error: r.error, isError: !!out?.isError, text: out?.content[0]?.text ?? "", json: () => JSON.parse(out!.content[0]!.text) };
};
function vault() {
  const v = fs.realpathSync(tmpDir());
  fs.mkdirSync(path.join(v, ".obsidian"));
  return v;
}

describe("Agentic's MCP server: protocol", () => {
  it("answers initialize with the client's version and its tools capability", async () => {
    const { c } = setup();
    const r = (await rpc(c, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "x", version: "1" } }))!;
    expect(r.result).toMatchObject({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "agentic" } });
    expect(((await rpc(c, "initialize", { protocolVersion: "1999-01-01" }))!.result as { protocolVersion: string }).protocolVersion).toBe("2025-06-18");
  });

  it("takes notifications without answering, and refuses what it does not know", async () => {
    const { c } = setup();
    expect(await rpc(c, "notifications/initialized", undefined, undefined)).toBeNull();
    expect((await rpc(c, "ping"))!.result).toEqual({});
    expect((await rpc(c, "no/existe"))!.error?.code).toBe(-32601);
    expect(((await handleRpc(c, { nope: true })) as { error: { code: number } }).error.code).toBe(-32600);
  });

  it("lists tools with JSON schemas and read-only hints", async () => {
    const { c } = setup();
    const tools = (await rpc(c, "tools/list"))!.result!.tools as { name: string; description: string; inputSchema: { type: string; $schema?: string }; annotations: { readOnlyHint: boolean } }[];
    expect(tools.length).toBeGreaterThan(10);
    for (const t of tools) {
      expect(t.name).toMatch(/^agentic_[a-z_]+$/);
      expect(t.inputSchema.type).toBe("object");
      expect(t.inputSchema.$schema).toBeUndefined();
      expect(t.annotations.readOnlyHint).toBe(true);
    }
  });
});

describe("what the person has allowed", () => {
  it("starts read-only, without the mail", () => {
    const { c } = setup();
    const names = enabledTools(c.agenticMcp.get()).map((t) => t.name);
    expect(names).toContain("agentic_tasks");
    expect(names).toContain("agentic_obsidian_search");
    expect(names).not.toContain("agentic_mail_list");
    expect(names).not.toContain("agentic_task_create");
    expect(names).not.toContain("agentic_obsidian_write");
  });

  it("a tool that is off cannot be called, and writing is opt-in", async () => {
    const { c } = setup();
    expect((await call(c, "agentic_task_create", { title: "x" })).error?.code).toBe(-32602);
    expect((await call(c, "agentic_mail_list")).error?.code).toBe(-32602);
    c.agenticMcp.set({ write: true, groups: { mail: true } });
    const names = enabledTools(c.agenticMcp.get()).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["agentic_task_create", "agentic_task_update", "agentic_obsidian_write", "agentic_mail_list"]));
    c.agenticMcp.set({ groups: { tasks: false } });
    expect(enabledTools(c.agenticMcp.get()).some((t) => t.name === "agentic_tasks")).toBe(false);
    c.agenticMcp.set({ enabled: false });
    expect(enabledTools(c.agenticMcp.get())).toEqual([]);
    expect(c.agenticMcp.forRun()).toBeNull();
  });

  it("every tool is in exactly one group and the write ones say so", () => {
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    for (const t of TOOLS) if (/_(create|update|write)$/.test(t.name)) expect(t.write).toBe(true);
  });
});

describe("tools", () => {
  it("overview, tasks and projects answer with real data", async () => {
    const { c } = setup();
    c.agenticMcp.set({ write: true });
    const created = (await call(c, "agentic_task_create", { title: "Revisar el despliegue", priority: "high", labels: ["infra"] })).json();
    expect(created).toMatchObject({ title: "Revisar el despliegue", status: expect.any(String), priority: "high" });
    const list = (await call(c, "agentic_tasks", { query: "despliegue" })).json();
    expect(list).toHaveLength(1);
    expect((await call(c, "agentic_tasks", { query: "nada que ver" })).json()).toEqual([]);
    expect((await call(c, "agentic_task", { id: created.id })).json()).toMatchObject({ id: created.id, description: "" });
    expect((await call(c, "agentic_task_update", { id: created.id, status: "done" })).json().status).toBe("done");
    expect((await call(c, "agentic_overview")).json().tasksByStatus).toEqual({ done: 1 });
    expect((await call(c, "agentic_tasks", { status: "todo" })).json()).toEqual([]);
  });

  it("reports bad arguments and missing things as tool errors, not crashes", async () => {
    const { c } = setup();
    const bad = await call(c, "agentic_tasks", { limit: 9999 });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/Argumentos no válidos/);
    expect((await call(c, "agentic_task", { id: "no-existe" })).isError).toBe(true);
    expect((await call(c, "agentic_run", { id: "no-existe" })).isError).toBe(true);
  });

  it("runs and sessions are listed", async () => {
    const { c } = setup();
    expect((await call(c, "agentic_runs")).json()).toEqual([]);
    expect((await call(c, "agentic_sessions")).json()).toEqual([]);
    expect((await call(c, "agentic_usage")).json()).toMatchObject({ tokensToday: 0 });
  });
});

describe("Obsidian through the MCP", () => {
  it("reads inside the Agentic folder only, and writes only there", async () => {
    const { c } = setup();
    const v = vault();
    fs.mkdirSync(path.join(v, "Agentic", "proj"), { recursive: true });
    fs.writeFileSync(path.join(v, "Agentic", "proj", "Decisiones.md"), "# Decisiones\nUsamos PolyForm para la licencia.\n");
    fs.writeFileSync(path.join(v, "Privado.md"), "mi contraseña es 1234\n");
    c.obsidian.set({ vaultPath: v, enabled: true });
    c.agenticMcp.set({ write: true });

    const hits = (await call(c, "agentic_obsidian_search", { query: "polyform" })).json();
    expect(hits).toEqual([expect.objectContaining({ path: path.join("Agentic", "proj", "Decisiones.md") })]);
    expect((await call(c, "agentic_obsidian_search", { query: "contraseña" })).json()).toEqual([]); // outside the folder
    expect((await call(c, "agentic_obsidian_read", { path: "Agentic/proj/Decisiones.md" })).json().text).toContain("PolyForm");
    expect((await call(c, "agentic_obsidian_read", { path: "Privado.md" })).isError).toBe(true);

    const w = (await call(c, "agentic_obsidian_write", { path: "Agentic/proj/Nueva.md", content: "hola" })).json();
    expect(w).toMatchObject({ created: true });
    expect(fs.readFileSync(path.join(v, "Agentic", "proj", "Nueva.md"), "utf8")).toBe("hola");
    await call(c, "agentic_obsidian_write", { path: "Agentic/proj/Nueva.md", content: "más", append: true });
    expect(fs.readFileSync(path.join(v, "Agentic", "proj", "Nueva.md"), "utf8")).toBe("hola\nmás");

    for (const bad of ["Privado.md", "Agentic/../Privado.md", "/etc/passwd.md", "Agentic/proj/nota.txt", "../fuera.md"]) {
      expect((await call(c, "agentic_obsidian_write", { path: bad, content: "x" })).isError, bad).toBe(true);
    }
    expect(fs.readFileSync(path.join(v, "Privado.md"), "utf8")).toBe("mi contraseña es 1234\n");
  });

  it("can read the whole vault when allowed to, but still writes only in the folder", async () => {
    const { c } = setup();
    const v = vault();
    fs.writeFileSync(path.join(v, "Diario.md"), "reunión con Ana\n");
    c.obsidian.set({ vaultPath: v, enabled: true, scope: "vault" });
    c.agenticMcp.set({ write: true });
    expect((await call(c, "agentic_obsidian_search", { query: "reunión" })).json()).toHaveLength(1);
    expect((await call(c, "agentic_obsidian_write", { path: "Diario.md", content: "x" })).isError).toBe(true);
  });

  it("does not follow a link that leads out of the vault", async () => {
    const { c } = setup();
    const v = vault();
    const outside = fs.realpathSync(tmpDir());
    fs.writeFileSync(path.join(outside, "secreto.md"), "no debería verse\n");
    fs.mkdirSync(path.join(v, "Agentic"), { recursive: true });
    fs.symlinkSync(outside, path.join(v, "Agentic", "enlace"));
    c.obsidian.set({ vaultPath: v, enabled: true });
    expect((await call(c, "agentic_obsidian_read", { path: "Agentic/enlace/secreto.md" })).isError).toBe(true);
    expect((await call(c, "agentic_obsidian_search", { query: "debería" })).json()).toEqual([]);
  });

  it("says so when Obsidian is not connected", async () => {
    const { c } = setup();
    const r = await call(c, "agentic_obsidian_search", { query: "x" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/no está conectado/);
  });
});

describe("handing the server to Claude", () => {
  it("has its own token, written to a private config file and rotatable", () => {
    const { c, dataDir } = setup();
    const t = c.agenticMcp.token();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(t).not.toBe(fs.readFileSync(path.join(dataDir, "token"), "utf8").trim() as string);
    expect(c.agenticMcp.authorized(`Bearer ${t}`)).toBe(true);
    expect(c.agenticMcp.authorized("Bearer nope")).toBe(false);
    expect(c.agenticMcp.authorized(null)).toBe(false);
    const run = c.agenticMcp.forRun()!;
    expect(run.allow).toBe("mcp__agentic");
    expect(run.hint).toContain("solo de lectura");
    const cfg = JSON.parse(fs.readFileSync(run.configPath, "utf8"));
    expect(cfg.mcpServers.agentic).toMatchObject({ type: "http", url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/api\/agentic-mcp$/), headers: { Authorization: `Bearer ${t}` } });
    expect(fs.statSync(run.configPath).mode & 0o077).toBe(0);
    const t2 = c.agenticMcp.rotate();
    expect(t2).not.toBe(t);
    expect(c.agenticMcp.authorized(`Bearer ${t}`)).toBe(false);
  });

  it("goes into claude's arguments", () => {
    const a = buildClaudeArgs({ mode: "headless", projectPath: "/x", prompt: "hola", permissionMode: "default", mcpConfig: "/d/mcp.json", allowedTools: ["mcp__agentic"] });
    expect(a[a.indexOf("--mcp-config") + 1]).toBe("/d/mcp.json");
    expect(a[a.indexOf("--allowedTools") + 1]).toBe("mcp__agentic");
    expect(buildClaudeArgs({ mode: "headless", projectPath: "/x", prompt: "hola", permissionMode: "default" })).not.toContain("--mcp-config");
  });
});
