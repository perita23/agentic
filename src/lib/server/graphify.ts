import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { JsonStore } from "./store";
import { HttpError, parse, text } from "./util";

/**
 * Graphify (https://github.com/safishamsi/graphify, PyPI «graphifyy»): turns a project into a knowledge graph
 * (graphify-out/graph.json + GRAPH_REPORT.md) so Claude can ask «what connects X to Y?» instead of grepping and reading
 * whole files. Agentic does not bundle it: it detects it, shows how to install it, runs its documented commands in a
 * project and hands Claude the graph in headless runs.
 */
export const graphifySettingsSchema = z.object({
  /** Tell Claude, in headless runs of projects that have a graph, to look in it before searching the files. */
  useInRuns: z.boolean().default(true),
});
export type GraphifySettings = z.infer<typeof graphifySettingsSchema>;

export const graphifyActionSchema = z.object({
  path: z.string().min(1).max(4096),
  action: z.enum(["update", "hook", "claude", "query"]),
  query: text(500).optional(),
});

const OUT = "graphify-out";
const MAX_REPORT = 200 * 1024;
const MAX_GRAPH = 80 * 1024 * 1024;
const MAX_OUTPUT = 20 * 1024;
const SKIP = new Set(["node_modules", ".git", OUT, ".next", "dist", "build", "target", "venv", ".venv", "__pycache__", "vendor", "coverage"]);
const SOURCE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|swift|rb|php|cs|c|h|cc|cpp|hpp|scala|lua|sh|sql|vue|svelte|md|mdx|ya?ml|toml|json)$/i;

/** Rough size of a text in LLM tokens (≈ 4 characters each): only to compare the report with the code, never exact. */
export const tokensOf = (bytes: number) => Math.round(bytes / 4);

export interface GraphSummary {
  nodes: number;
  edges: number;
  /** Share of the edges Graphify marked as INFERRED / AMBIGUOUS (the rest were read straight from the code). */
  inferredPct: number | null;
  version: string | null;
}

/** Counts a node-link graph (`nodes` + `links` or `edges`), the format graphify-out/graph.json is saved in. */
export function summarizeGraph(raw: string): GraphSummary | null {
  let g: { nodes?: unknown; links?: unknown; edges?: unknown; graph?: { graphify_version?: unknown } };
  try {
    g = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!g || typeof g !== "object" || !Array.isArray(g.nodes)) return null;
  const edges = (Array.isArray(g.links) ? g.links : Array.isArray(g.edges) ? g.edges : []) as { confidence?: unknown }[];
  const inferred = edges.filter((e) => e && (e.confidence === "INFERRED" || e.confidence === "AMBIGUOUS")).length;
  const v = g.graph?.graphify_version;
  return { nodes: g.nodes.length, edges: edges.length, inferredPct: edges.length ? Math.round((inferred / edges.length) * 100) : null, version: typeof v === "string" ? v.slice(0, 40) : null };
}

export interface ViewNode {
  id: string;
  label: string;
  file: string;
  community: number;
  degree: number;
}
export interface ViewLink {
  source: string;
  target: string;
  relation: string;
  inferred: boolean;
}
export interface GraphView {
  nodes: ViewNode[];
  links: ViewLink[];
  total: { nodes: number; edges: number };
  communities: { id: number; size: number; name: string }[];
}

const str = (v: unknown, max: number) => (typeof v === "string" || typeof v === "number" ? String(v).slice(0, max) : "");

/**
 * The graph the app draws: the `max` best-connected nodes of graph.json (a full graph can have tens of thousands: too many to
 * draw or to read), the links between them and their communities (the ones Graphify saved, or found here by label propagation).
 */
export function compactGraph(raw: string, max = 700): GraphView | null {
  let g: { nodes?: unknown; links?: unknown; edges?: unknown };
  try {
    g = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!g || typeof g !== "object" || !Array.isArray(g.nodes)) return null;
  type RawNode = Record<string, unknown>;
  type RawLink = Record<string, unknown>;
  const rawLinks = (Array.isArray(g.links) ? g.links : Array.isArray(g.edges) ? g.edges : []) as RawLink[];
  const byId = new Map<string, RawNode>();
  for (const n of g.nodes as RawNode[]) if (n && typeof n === "object" && (typeof n.id === "string" || typeof n.id === "number")) byId.set(String(n.id), n);
  const edges = rawLinks.filter((e) => e && byId.has(str(e.source, 400)) && byId.has(str(e.target, 400)) && str(e.source, 400) !== str(e.target, 400));
  const degree = new Map<string, number>();
  for (const e of edges) for (const k of [str(e.source, 400), str(e.target, 400)]) degree.set(k, (degree.get(k) ?? 0) + 1);
  const kept = [...byId.keys()].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || (a < b ? -1 : 1)).slice(0, Math.max(10, Math.min(max, 2000)));
  const keep = new Set(kept);
  const links = edges.filter((e) => keep.has(str(e.source, 400)) && keep.has(str(e.target, 400)));
  const adj = new Map<string, string[]>(kept.map((k) => [k, []]));
  for (const e of links) {
    adj.get(str(e.source, 400))!.push(str(e.target, 400));
    adj.get(str(e.target, 400))!.push(str(e.source, 400));
  }
  // Communities: the saved ones when every kept node has one, otherwise label propagation (deterministic).
  const saved = (n: RawNode) => [n.community, n.group, n.cluster].find((v) => typeof v === "number" || (typeof v === "string" && v !== "")) as number | string | undefined;
  const label = new Map<string, string>();
  if (kept.every((k) => saved(byId.get(k)!) !== undefined)) for (const k of kept) label.set(k, String(saved(byId.get(k)!)));
  else {
    for (const k of kept) label.set(k, k);
    const order = [...kept].sort();
    for (let round = 0; round < 8; round++) {
      let changed = false;
      for (const k of order) {
        const count = new Map<string, number>();
        for (const m of adj.get(k)!) count.set(label.get(m)!, (count.get(label.get(m)!) ?? 0) + 1);
        let best = label.get(k)!;
        let bn = count.get(best) ?? 0;
        for (const [l, c] of [...count].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
          if (c > bn) {
            best = l;
            bn = c;
          }
        }
        if (best !== label.get(k)) {
          label.set(k, best);
          changed = true;
        }
      }
      if (!changed) break;
    }
  }
  const sizes = new Map<string, number>();
  for (const l of label.values()) sizes.set(l, (sizes.get(l) ?? 0) + 1);
  const ranked = [...sizes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const num = new Map(ranked.map(([l], i) => [l, i]));
  const nodes: ViewNode[] = kept.map((k) => {
    const n = byId.get(k)!;
    return { id: k, label: str(n.label ?? n.name ?? k, 120) || k, file: str(n.source_file ?? n.file, 300), community: num.get(label.get(k)!)!, degree: degree.get(k) ?? 0 };
  });
  const communities = ranked.slice(0, 40).map(([l, size], i) => {
    const top = nodes.filter((n) => n.community === i).sort((a, b) => b.degree - a.degree)[0];
    return { id: i, size, name: top?.label ?? l };
  });
  return {
    nodes,
    links: links.map((e) => ({ source: str(e.source, 400), target: str(e.target, 400), relation: str(e.relation ?? e.label, 40), inferred: e.confidence === "INFERRED" || e.confidence === "AMBIGUOUS" })),
    total: { nodes: byId.size, edges: edges.length },
    communities,
  };
}

/** Total bytes of source/text files of a project (capped, skipping dependencies and build output). */
export function sourceBytes(root: string, maxFiles = 6000): { bytes: number; files: number; truncated: boolean } {
  let bytes = 0;
  let files = 0;
  let truncated = false;
  const walk = (dir: string, depth: number) => {
    if (truncated || depth > 12) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (truncated) return;
      if (e.isSymbolicLink() || SKIP.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && SOURCE.test(e.name)) {
        if (++files > maxFiles) {
          truncated = true;
          return;
        }
        try {
          bytes += fs.statSync(p).size;
        } catch {}
      }
    }
  };
  walk(root, 0);
  return { bytes, files: Math.min(files, maxFiles), truncated };
}

/** Folders where `uv tool` / `pipx` / Homebrew put commands, which a desktop app launched from the Dock does not have in its PATH. */
export function extraBinDirs(home = os.homedir()): string[] {
  return [path.join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".cargo", "bin")];
}

function runCmd(bin: string, args: string[], opts: { cwd?: string; timeout: number; home: string }): Promise<{ ok: boolean; code: number | null; output: string; missing: boolean }> {
  const PATH = [process.env.PATH ?? "", ...extraBinDirs(opts.home)].filter(Boolean).join(path.delimiter);
  return new Promise((resolve) => {
    execFile(bin, args, { cwd: opts.cwd, timeout: opts.timeout, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, PATH, PYTHONIOENCODING: "utf-8", NO_COLOR: "1", GRAPHIFY_QUERY_LOG_DISABLE: "1" } }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null;
      const output = `${stdout ?? ""}${stderr ? `${stdout ? "\n" : ""}${stderr}` : ""}`.replace(/\u001b\[[0-9;]*m/g, "").trim();
      resolve({ ok: !e, code: e ? (typeof e.code === "number" ? e.code : null) : 0, output: output.length > MAX_OUTPUT ? `${output.slice(0, MAX_OUTPUT)}\n… (recortado)` : output, missing: e?.code === "ENOENT" });
    });
  });
}

export class GraphifyService {
  private busy = new Set<string>();
  private detected: { at: number; value: ReturnType<GraphifyService["detectNow"]> extends Promise<infer T> ? T : never } | null = null;
  /** Last known: forRun() is synchronous and only needs to know whether to mention the command. */
  private installed = false;

  constructor(
    private store: JsonStore,
    private isKnown: (p: string) => boolean,
    private bin = process.env.GRAPHIFY_BIN || "graphify",
    private home = os.homedir(),
  ) {}

  get(): GraphifySettings {
    const r = graphifySettingsSchema.safeParse(this.store.read<unknown>("graphify", {}));
    return r.success ? r.data : { useInRuns: true };
  }

  set(body: unknown): GraphifySettings {
    const next = parse(graphifySettingsSchema, { ...this.get(), ...(body && typeof body === "object" ? body : {}) });
    this.store.write("graphify", next);
    return next;
  }

  private async detectNow() {
    const v = await runCmd(this.bin, ["--version"], { timeout: 8000, home: this.home });
    const ok = v.ok || (!v.missing && /\d+\.\d+/.test(v.output)); // some versions exit non-zero after printing it
    const version = ok ? (/\d+\.\d+(?:\.\d+)?(?:[-+.\w]*)?/.exec(v.output)?.[0] ?? null) : null;
    const [uv, pipx, pip] = await Promise.all(["uv", "pipx", "pip3"].map((b) => runCmd(b, ["--version"], { timeout: 5000, home: this.home }).then((r) => r.ok)));
    this.installed = ok;
    return { installed: ok, version, installers: { uv, pipx, pip } };
  }

  async detect(force = false) {
    if (!force && this.detected && Date.now() - this.detected.at < 20_000) return this.detected.value;
    const value = await this.detectNow();
    this.detected = { at: Date.now(), value };
    return value;
  }

  private projectDir(p: string): string {
    if (!path.isAbsolute(p) || p.includes("\0")) throw new HttpError(400, "Ruta no válida");
    const real = (() => {
      try {
        return fs.realpathSync(p);
      } catch {
        throw new HttpError(404, "Ese proyecto no existe");
      }
    })();
    if (!this.isKnown(p) && !this.isKnown(real)) throw new HttpError(403, "Ese proyecto no está registrado en Agentic");
    return real;
  }

  /** What the project has: the graph, its report, the git hook and Claude's skill. Reads only; never runs anything. */
  status(projectPath: string) {
    const dir = this.projectDir(projectPath);
    const out = path.join(dir, OUT);
    const stat = (f: string) => {
      try {
        const s = fs.statSync(path.join(out, f));
        return s.isFile() ? s : null;
      } catch {
        return null;
      }
    };
    const g = stat("graph.json");
    const r = stat("GRAPH_REPORT.md");
    let summary: GraphSummary | null = null;
    if (g && g.size <= MAX_GRAPH) summary = summarizeGraph(fs.readFileSync(path.join(out, "graph.json"), "utf8"));
    const src = sourceBytes(dir);
    const hook = (() => {
      try {
        return ["post-commit", "post-checkout"].some((h) => fs.readFileSync(path.join(dir, ".git", "hooks", h), "utf8").toLowerCase().includes("graphify"));
      } catch {
        return false;
      }
    })();
    const skill = [path.join(dir, ".claude", "skills", "graphify", "SKILL.md"), path.join(this.home, ".claude", "skills", "graphify", "SKILL.md")].some((f) => fs.existsSync(f));
    const claudeMd = (() => {
      try {
        return /graphify/i.test(fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8"));
      } catch {
        return false;
      }
    })();
    return {
      path: projectPath,
      hasGraph: !!g,
      updatedAt: g?.mtime.toISOString() ?? null,
      summary,
      graphBytes: g?.size ?? 0,
      report: r ? { bytes: r.size, tokens: tokensOf(r.size) } : null,
      hasHtml: !!stat("graph.html"),
      source: { ...src, tokens: tokensOf(src.bytes) },
      hook,
      skill,
      claudeMd,
    };
  }

  /** The graph to draw (see compactGraph). */
  view(projectPath: string, max = 700): GraphView {
    const dir = this.projectDir(projectPath);
    const f = path.join(dir, OUT, "graph.json");
    let size: number;
    try {
      size = fs.statSync(f).size;
    } catch {
      throw new HttpError(404, "Todavía no hay grafo: constrúyelo primero");
    }
    if (size > MAX_GRAPH) throw new HttpError(413, "El grafo es demasiado grande para dibujarlo aquí");
    const v = compactGraph(fs.readFileSync(f, "utf8"), max);
    if (!v) throw new HttpError(422, "graph.json no tiene el formato esperado (nodos y relaciones)");
    return v;
  }

  report(projectPath: string): string {
    const dir = this.projectDir(projectPath);
    const f = path.join(dir, OUT, "GRAPH_REPORT.md");
    try {
      const s = fs.statSync(f);
      if (!s.isFile()) throw new Error("x");
      return fs.readFileSync(f, "utf8").slice(0, MAX_REPORT);
    } catch {
      throw new HttpError(404, "Todavía no hay informe: construye el grafo primero");
    }
  }

  /** Runs one documented command of the CLI in the project (no shell: the arguments are fixed, the question is one argument). */
  async run(body: unknown) {
    const d = parse(graphifyActionSchema, body);
    const dir = this.projectDir(d.path);
    const args: string[] =
      d.action === "update" ? ["update", "."] : d.action === "hook" ? ["hook", "install"] : d.action === "claude" ? ["claude", "install"] : ["query", (d.query ?? "").trim(), "--graph", path.join(OUT, "graph.json")];
    if (d.action === "query") {
      if (!d.query?.trim()) throw new HttpError(400, "Escribe una pregunta");
      if (!fs.existsSync(path.join(dir, OUT, "graph.json"))) throw new HttpError(409, "Todavía no hay grafo: constrúyelo primero");
      if (d.query.trim().startsWith("-")) throw new HttpError(400, "La pregunta no puede empezar por «-»");
    }
    if (this.busy.has(dir)) throw new HttpError(409, "Graphify ya está trabajando en este proyecto");
    this.busy.add(dir); // before the first await: two clicks at once must not both pass
    try {
      if (!(await this.detect()).installed) throw new HttpError(409, "Graphify no está instalado: instálalo primero");
      const started = Date.now();
      const r = await runCmd(this.bin, args, { cwd: dir, timeout: d.action === "update" ? 15 * 60_000 : 90_000, home: this.home });
      return { ok: r.ok, code: r.code, output: r.output || (r.ok ? "Hecho." : "Sin salida"), ms: Date.now() - started, status: this.status(d.path) };
    } finally {
      this.busy.delete(dir);
    }
  }

  /** For a headless run in `cwd`: a hint (and permission to ask the graph) when the project has one and the person wants it used. */
  forRun(cwd: string): { hint: string; allow: string[] } | null {
    if (!this.get().useInRuns) return null;
    try {
      if (!fs.statSync(path.join(cwd, OUT, "graph.json")).isFile()) return null;
    } catch {
      return null;
    }
    const hint = [
      `Este proyecto tiene un grafo de conocimiento de Graphify en «${OUT}/» (ficheros, funciones, clases y cómo se relacionan).`,
      `Para ahorrar contexto: antes de buscar con Grep/Glob o de leer muchos ficheros, lee «${OUT}/GRAPH_REPORT.md» (resumen: nodos centrales y comunidades)`,
      this.installed ? `y, para preguntas sobre cómo se conectan las piezas, usa «graphify query "<pregunta>"», «graphify path "A" "B"» o «graphify explain "X"».` : "y úsalo para saber dónde mirar.",
      "El grafo puede estar desactualizado: si algo no cuadra con el código, fíate del código.",
    ].join(" ");
    return { hint, allow: this.installed ? ["Bash(graphify query:*)", "Bash(graphify path:*)", "Bash(graphify explain:*)"] : [] };
  }
}
