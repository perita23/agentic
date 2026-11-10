import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeTool, graphifyUse } from "@/lib/tool-cards";
import { compactGraph, GraphifyService, summarizeGraph, sourceBytes, tokensOf } from "@/lib/server/graphify";
import { JsonStore } from "@/lib/server/store";
import { tmpDir } from "./helpers";

const FAKE_GRAPHIFY = path.resolve(__dirname, "fixtures/fake-graphify.mjs");

function setup() {
  const dir = tmpDir("graphify-");
  const project = fs.realpathSync(fs.mkdirSync(path.join(dir, "proj"), { recursive: true }) as string);
  fs.writeFileSync(path.join(project, "app.ts"), "export const a = 1;\n".repeat(50));
  fs.mkdirSync(path.join(project, "node_modules", "dep"), { recursive: true });
  fs.writeFileSync(path.join(project, "node_modules", "dep", "x.js"), "x".repeat(100_000));
  const store = new JsonStore(path.join(dir, "data"));
  const svc = new GraphifyService(store, (p) => p === project, FAKE_GRAPHIFY, dir);
  return { dir, project, svc };
}

describe("graphify helpers", () => {
  it("counts nodes and edges of a node-link graph (links or edges) and the inferred share", () => {
    expect(summarizeGraph(JSON.stringify({ nodes: [{}, {}], links: [{ confidence: "EXTRACTED" }, { confidence: "INFERRED" }], graph: { graphify_version: "1.2.3" } }))).toEqual({ nodes: 2, edges: 2, inferredPct: 50, version: "1.2.3" });
    expect(summarizeGraph(JSON.stringify({ nodes: [{}], edges: [] }))).toMatchObject({ nodes: 1, edges: 0, inferredPct: null });
    expect(summarizeGraph("{no")).toBeNull();
    expect(summarizeGraph(JSON.stringify({ hello: 1 }))).toBeNull();
  });

  it("measures the source of a project without dependencies or its own output", () => {
    const { project } = setup();
    fs.mkdirSync(path.join(project, "graphify-out"));
    fs.writeFileSync(path.join(project, "graphify-out", "graph.json"), "x".repeat(5000));
    const s = sourceBytes(project);
    expect(s.files).toBe(1);
    expect(s.bytes).toBe("export const a = 1;\n".length * 50);
    expect(tokensOf(400)).toBe(100);
  });
});

describe("GraphifyService", () => {
  it("detects the command and its version, and reports it missing when it is not there", async () => {
    const { svc, dir } = setup();
    const d = await svc.detect(true);
    expect(d.installed).toBe(true);
    expect(d.version).toBe("0.9.1");
    const missing = new GraphifyService(new JsonStore(path.join(dir, "d2")), () => true, path.join(dir, "no-such-command"), dir);
    expect((await missing.detect(true)).installed).toBe(false);
  });

  it("builds the graph in the project, then reports it with the report and the size comparison", async () => {
    const { svc, project } = setup();
    expect(svc.status(project).hasGraph).toBe(false);
    const r = await svc.run({ path: project, action: "update" });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("grafo construido");
    expect(r.status.hasGraph).toBe(true);
    expect(r.status.summary).toMatchObject({ nodes: 3, edges: 2, inferredPct: 50 });
    expect(r.status.report?.bytes).toBeGreaterThan(0);
    expect(r.status.source.files).toBe(1);
    expect(svc.report(project)).toContain("God nodes");
  });

  it("asks the graph with the question as one argument (no shell) and rejects options, empty text and missing graph", async () => {
    const { svc, project } = setup();
    await expect(svc.run({ path: project, action: "query", query: "x" })).rejects.toMatchObject({ status: 409 });
    await svc.run({ path: project, action: "update" });
    const r = await svc.run({ path: project, action: "query", query: 'qué conecta "a"; rm -rf /' });
    expect(r.output).toBe(`ARGS:${JSON.stringify(["query", 'qué conecta "a"; rm -rf /', "--graph", "graphify-out/graph.json"])}`);
    await expect(svc.run({ path: project, action: "query", query: "--help" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.run({ path: project, action: "query", query: "  " })).rejects.toMatchObject({ status: 400 });
  });

  it("only works on registered projects and with absolute, existing paths", async () => {
    const { svc, dir } = setup();
    await expect(svc.run({ path: dir, action: "update" })).rejects.toMatchObject({ status: 403 });
    expect(() => svc.status("relativo")).toThrowError(/Ruta no válida/);
    expect(() => svc.status(path.join(dir, "nope"))).toThrowError(/no existe/);
  });

  it("hands Claude a hint only when the project has a graph and the setting is on", async () => {
    const { svc, project } = setup();
    expect(svc.forRun(project)).toBeNull();
    await svc.run({ path: project, action: "update" });
    const g = svc.forRun(project)!;
    expect(g.hint).toContain("GRAPH_REPORT.md");
    expect(g.hint).toContain("graphify query");
    expect(g.allow).toContain("Bash(graphify query:*)");
    svc.set({ useInRuns: false });
    expect(svc.forRun(project)).toBeNull();
  });

  it("does not run two builds at once in the same project", async () => {
    const { svc, project } = setup();
    const a = svc.run({ path: project, action: "update" });
    await expect(svc.run({ path: project, action: "update" })).rejects.toMatchObject({ status: 409 });
    await a;
  });
});

describe("seeing Graphify at work", () => {
  it("recognises Claude using the CLI, the files in graphify-out/ and Graphify's MCP tools", () => {
    expect(graphifyUse("Bash", { command: 'cd app && graphify query "qué conecta A con B" --graph graphify-out/graph.json' })).toEqual({ kind: "consulta", title: "qué conecta A con B" });
    expect(graphifyUse("Bash", { command: 'graphify path "UserService" "DatabasePool"' })).toEqual({ kind: "camino", title: "UserService DatabasePool" });
    expect(graphifyUse("Bash", { command: 'graphify explain "RateLimiter"' })?.kind).toBe("explicación");
    expect(graphifyUse("Read", { file_path: "/x/graphify-out/GRAPH_REPORT.md" })).toEqual({ kind: "informe", title: "GRAPH_REPORT.md" });
    expect(graphifyUse("Grep", { pattern: "foo", path: "/x/graphify-out" })?.kind).toBe("grafo");
    expect(graphifyUse("mcp__graphify__query_graph", {})).toEqual({ kind: "MCP", title: "query graph" });
    // not Graphify: other commands, other files, a word that only contains it
    expect(graphifyUse("Bash", { command: "npm test" })).toBeNull();
    expect(graphifyUse("Bash", { command: "pip install graphifyy" })).toBeNull();
    expect(graphifyUse("Read", { file_path: "/x/src/app.ts" })).toBeNull();
    expect(describeTool("Bash", { command: 'graphify query "x"' })).toMatchObject({ icon: "graph", group: "Graphify · consulta", title: "x" });
  });
});

describe("compactGraph", () => {
  const raw = JSON.stringify({
    nodes: [{ id: "a", label: "A", source_file: "src/a.ts" }, { id: "b", label: "B" }, { id: "c", label: "C" }, { id: "d", label: "D" }, { id: "x", label: "X" }],
    links: [
      { source: "a", target: "b", relation: "calls", confidence: "EXTRACTED" },
      { source: "a", target: "c", relation: "imports", confidence: "INFERRED" },
      { source: "b", target: "c" },
      { source: "a", target: "ghost" },
      { source: "a", target: "a" },
      { source: "d", target: "x" },
    ],
  });
  it("keeps the best connected nodes, drops broken or self links, and groups communities", () => {
    const v = compactGraph(raw, 10)!;
    expect(v.total).toEqual({ nodes: 5, edges: 4 });
    expect(v.nodes[0]).toMatchObject({ id: "a", label: "A", file: "src/a.ts", degree: 2 });
    expect(v.links.find((l) => l.source === "a" && l.target === "c")).toMatchObject({ relation: "imports", inferred: true });
    expect(v.nodes.find((n) => n.id === "a")!.community).toBe(v.nodes.find((n) => n.id === "b")!.community);
    expect(v.nodes.find((n) => n.id === "d")!.community).not.toBe(v.nodes.find((n) => n.id === "a")!.community);
    expect(v.communities[0]!.size).toBe(3);
  });
  it("trims big graphs and rejects what is not a graph", () => {
    const nodes = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}` }));
    const links = nodes.slice(1).map((n, i) => ({ source: "n0", target: n.id, i }));
    expect(compactGraph(JSON.stringify({ nodes, links }), 12)!.nodes).toHaveLength(12);
    expect(compactGraph("nope")).toBeNull();
    expect(compactGraph(JSON.stringify({ nodes: "x" }))).toBeNull();
  });
});
