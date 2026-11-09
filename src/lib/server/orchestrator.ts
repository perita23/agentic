import { z } from "zod";
import type { JsonStore } from "./store";
import { parse, text } from "./util";

/**
 * The orchestrator: a graph that says how Claude works as a team, drawn in Agentic and applied to the runs it starts.
 *  - the PLANNER is the main agent: its model, its instructions;
 *  - the AGENTS are subagents it can delegate to (each with its own, cheaper, model, instructions and tools);
 *  - the CONTEXT policy says at what share of the context window Claude compacts the conversation.
 * An edge planner → agent means "may delegate to it"; agent → agent, "hands its result over to it".
 * It is compiled to what `claude` understands: --model, --agents, --append-system-prompt and an environment variable.
 */
export const NODE_KINDS = ["planner", "agent", "context"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];
export const MODELS = ["default", "opus", "sonnet", "haiku", "opusplan"] as const;
export const SCOPES = ["chats", "runs", "tasks"] as const;
export type Scope = (typeof SCOPES)[number];

/** The tools of Claude Code a subagent may be limited to. */
export const TOOLS = ["Read", "Glob", "Grep", "Edit", "Write", "Bash", "WebSearch", "WebFetch", "NotebookEdit", "TodoWrite"] as const;

export const nodeSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "id no válido"),
  kind: z.enum(NODE_KINDS),
  label: z.string().trim().min(1, "Ponle un nombre").max(40),
  x: z.number().min(0).max(10_000).default(0),
  y: z.number().min(0).max(10_000).default(0),
  /** "default" is what Claude Code uses on its own; for an agent it means "the same as the planner". */
  model: z.enum(MODELS).default("default"),
  /** What it is for (for an agent: when to call it). */
  role: text(400).default(""),
  /** Its instructions. */
  prompt: text(4000).default(""),
  /** An agent's tools (empty: all of them). */
  tools: z.array(z.enum(TOOLS)).max(TOOLS.length).default([]),
  /** The context policy: compact at this share (%) of the context window. */
  threshold: z.number().int().min(20).max(95).default(80),
});
export type OrchNode = z.infer<typeof nodeSchema>;

export const graphSchema = z
  .object({
    enabled: z.boolean().default(false),
    scope: z.object({ chats: z.boolean().default(true), runs: z.boolean().default(true), tasks: z.boolean().default(true) }).default({ chats: true, runs: true, tasks: true }),
    nodes: z.array(nodeSchema).max(24).default([]),
    edges: z.array(z.object({ from: z.string(), to: z.string() })).max(60).default([]),
  })
  .superRefine((g, ctx) => {
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    if (byId.size !== g.nodes.length) ctx.addIssue({ code: "custom", path: ["nodes"], message: "Hay dos cubos con el mismo id" });
    if (g.nodes.filter((n) => n.kind === "planner").length > 1) ctx.addIssue({ code: "custom", path: ["nodes"], message: "Sólo puede haber un planificador" });
    if (g.nodes.filter((n) => n.kind === "context").length > 1) ctx.addIssue({ code: "custom", path: ["nodes"], message: "Sólo puede haber una política de contexto" });
    const seen = new Set<string>();
    for (const [i, e] of g.edges.entries()) {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      const ok = a && b && e.from !== e.to && ((a.kind === "planner" && b.kind === "agent") || (a.kind === "agent" && b.kind === "agent") || (a.kind === "context" && b.kind === "planner"));
      if (!ok) ctx.addIssue({ code: "custom", path: ["edges", i], message: "Conexión no válida (planificador → agente, agente → agente, contexto → planificador)" });
      const key = `${e.from}>${e.to}`;
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["edges", i], message: "Conexión repetida" });
      seen.add(key);
    }
  });
export type Graph = z.infer<typeof graphSchema>;

export interface AgentDef {
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
}
/** What is handed to a run. */
export interface Compiled {
  model?: string;
  agents?: Record<string, AgentDef>;
  appendPrompt: string;
  env: Record<string, string>;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "agente";

const MODEL_NAME: Record<string, string> = { default: "el modelo por defecto", opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", opusplan: "Opus para planificar y Sonnet para ejecutar" };

/** The graph as what `claude` takes. Null when it is off, or off for this kind of run. */
export function compile(g: Graph, kind: Scope): Compiled | null {
  if (!g.enabled || !g.scope[kind]) return null;
  const planner = g.nodes.find((n) => n.kind === "planner");
  const policy = g.nodes.find((n) => n.kind === "context");
  const agentsAll = g.nodes.filter((n) => n.kind === "agent");
  if (!planner && !agentsAll.length && !policy) return null;

  // Agents the planner can reach (directly, or through hand-overs); without a planner, all of them.
  const reach = new Set<string>();
  if (planner) {
    const stack = g.edges.filter((e) => e.from === planner.id).map((e) => e.to);
    while (stack.length) {
      const id = stack.pop()!;
      if (reach.has(id)) continue;
      reach.add(id);
      for (const e of g.edges) if (e.from === id) stack.push(e.to);
    }
  }
  const agents = planner ? agentsAll.filter((a) => reach.has(a.id)) : agentsAll;

  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const a of agents) {
    let n = slug(a.label);
    for (let i = 2; used.has(n); i++) n = `${slug(a.label).slice(0, 36)}-${i}`;
    used.add(n);
    names.set(a.id, n);
  }
  const defs: Record<string, AgentDef> = {};
  for (const a of agents) {
    defs[names.get(a.id)!] = {
      description: a.role.trim() || a.label,
      prompt: a.prompt.trim() || a.role.trim() || `Eres ${a.label}.`,
      ...(a.tools.length ? { tools: a.tools } : {}),
      ...(a.model !== "default" ? { model: a.model } : {}),
    };
  }

  const lines: string[] = ["# Orquestación (definida en Agentic)"];
  if (planner) {
    lines.push(`Trabajas como «${planner.label}»${planner.role.trim() ? `: ${planner.role.trim()}` : "."}`);
    if (planner.prompt.trim()) lines.push(planner.prompt.trim());
    lines.push("Antes de actuar, planifica: divide el trabajo en pasos y decide qué haces tú y qué delegas.");
  }
  if (agents.length) {
    lines.push("", "Subagentes a los que puedes delegar (herramienta Task), cada uno con su propio modelo:");
    for (const a of agents) lines.push(`- «${names.get(a.id)}» (${MODEL_NAME[a.model === "default" ? "default" : a.model]}): ${a.role.trim() || a.label}`);
    const hand = g.edges.filter((e) => names.has(e.from) && names.has(e.to));
    if (hand.length) {
      lines.push("", "Flujo entre subagentes:");
      for (const e of hand) lines.push(`- Cuando «${names.get(e.from)}» termine, pasa su resultado a «${names.get(e.to)}».`);
    }
    lines.push("", "Delega el trabajo mecánico o repetitivo en los subagentes más baratos y reserva tu atención para planificar, decidir y revisar el resultado.");
  }
  const env: Record<string, string> = {};
  if (policy) {
    env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = String(policy.threshold);
    lines.push("", `Cuando el contexto llegue al ${policy.threshold}% de la ventana, compacta la conversación conservando decisiones, rutas y tareas pendientes.`);
  }
  const model = planner && planner.model !== "default" ? planner.model : undefined;
  return { ...(model ? { model } : {}), ...(Object.keys(defs).length ? { agents: defs } : {}), appendPrompt: lines.join("\n").slice(0, 8000), env };
}

/** Starting points that are already valid graphs. */
export const PRESETS: { id: string; name: string; description: string; graph: Omit<Graph, "enabled" | "scope"> }[] = [
  {
    id: "planner-cheap-writers",
    name: "Planificador listo, escritores baratos",
    description: "Opus planifica y revisa; Haiku hace el trabajo mecánico; Sonnet revisa.",
    graph: {
      nodes: [
        { id: "planner", kind: "planner", label: "Planificador", x: 300, y: 190, model: "opus", role: "Entiende la petición, la divide en pasos y reparte el trabajo.", prompt: "Pide aclaraciones solo si algo es ambiguo. Termina con un resumen corto de lo hecho.", tools: [], threshold: 80 },
        { id: "writer", kind: "agent", label: "Escritor", x: 570, y: 60, model: "haiku", role: "Escribe y edita código o texto siguiendo el plan al pie de la letra.", prompt: "Haz exactamente lo que pide el plan, sin ampliar el alcance. Devuelve un resumen breve de los cambios.", tools: ["Read", "Glob", "Grep", "Edit", "Write"], threshold: 80 },
        { id: "reviewer", kind: "agent", label: "Revisor", x: 570, y: 320, model: "sonnet", role: "Revisa lo escrito: errores, casos límite y estilo.", prompt: "Revisa con ojo crítico. Lista los problemas por gravedad y propone el arreglo concreto.", tools: ["Read", "Glob", "Grep", "Bash"], threshold: 80 },
        { id: "context", kind: "context", label: "Contexto", x: 40, y: 50, model: "default", role: "", prompt: "", tools: [], threshold: 75 },
      ],
      edges: [
        { from: "planner", to: "writer" },
        { from: "writer", to: "reviewer" },
        { from: "context", to: "planner" },
      ],
    },
  },
  {
    id: "opusplan",
    name: "Planificar con Opus, ejecutar con Sonnet",
    description: "Un solo agente que planifica con Opus y ejecuta con Sonnet, sin subagentes.",
    graph: { nodes: [{ id: "planner", kind: "planner", label: "Agente", x: 120, y: 160, model: "opusplan", role: "Planifica con cuidado y después ejecuta.", prompt: "", tools: [], threshold: 80 }], edges: [] },
  },
  {
    id: "review-team",
    name: "Equipo de revisión",
    description: "Un planificador reparte la revisión entre un especialista en seguridad y otro en rendimiento.",
    graph: {
      nodes: [
        { id: "planner", kind: "planner", label: "Coordinador", x: 60, y: 190, model: "sonnet", role: "Reparte la revisión y reúne los resultados en un informe.", prompt: "", tools: [], threshold: 80 },
        { id: "security", kind: "agent", label: "Seguridad", x: 360, y: 60, model: "sonnet", role: "Busca fallos de seguridad: entradas sin validar, secretos, permisos.", prompt: "Solo lees; no cambies nada. Indica archivo y línea.", tools: ["Read", "Glob", "Grep"], threshold: 80 },
        { id: "perf", kind: "agent", label: "Rendimiento", x: 360, y: 320, model: "haiku", role: "Busca cuellos de botella evidentes: consultas repetidas, bucles costosos.", prompt: "Solo lees; no cambies nada. Indica archivo y línea.", tools: ["Read", "Glob", "Grep"], threshold: 80 },
      ],
      edges: [
        { from: "planner", to: "security" },
        { from: "planner", to: "perf" },
      ],
    },
  },
];

export class OrchestratorService {
  constructor(private store: JsonStore) {}

  get(): Graph {
    const r = graphSchema.safeParse(this.store.read<unknown>("orchestrator", {}));
    return r.success ? r.data : graphSchema.parse({});
  }

  set(body: unknown): Graph {
    const next = parse(graphSchema, body);
    this.store.write("orchestrator", next);
    return next;
  }

  /** For a run of this kind (or null when the orchestrator is off for it). */
  forRun(kind: Scope): Compiled | null {
    return compile(this.get(), kind);
  }

  preview() {
    const g = this.get();
    return Object.fromEntries(SCOPES.map((s) => [s, compile({ ...g, enabled: true, scope: { chats: true, runs: true, tasks: true } }, s)]));
  }
}
