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
/** What a subagent is for: it sets its tools (a reader cannot change anything) and how it is shown. */
export const JOBS = ["custom", "writer", "reader", "reviewer", "researcher", "tester"] as const;
export type Job = (typeof JOBS)[number];
export const JOB_INFO: Record<Job, { label: string; verb: string; model: string; tools: string[]; role: string; prompt: string }> = {
  custom: { label: "Subagente", verb: "ayuda", model: "haiku", tools: [], role: "", prompt: "" },
  writer: { label: "Escritor", verb: "escribe", model: "haiku", tools: ["Read", "Glob", "Grep", "Edit", "Write"], role: "Escribe y edita código o texto siguiendo el plan al pie de la letra.", prompt: "Haz exactamente lo que pide el plan, sin ampliar el alcance. Devuelve un resumen breve de los cambios." },
  reader: { label: "Lector", verb: "lee", model: "haiku", tools: ["Read", "Glob", "Grep"], role: "Lee y entiende el código: busca los archivos que importan y explica cómo encajan. No cambia nada.", prompt: "Solo lees; no modifiques nada. Devuelve rutas concretas (archivo y línea) y lo esencial de cada una." },
  reviewer: { label: "Revisor", verb: "revisa", model: "sonnet", tools: ["Read", "Glob", "Grep"], role: "Revisa lo escrito: errores, casos límite y estilo. No cambia nada.", prompt: "Revisa con ojo crítico. Lista los problemas por gravedad y propone el arreglo concreto." },
  researcher: { label: "Investigador", verb: "investiga", model: "sonnet", tools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"], role: "Investiga en la web y en el proyecto lo que haga falta saber antes de decidir.", prompt: "Cita las fuentes. Separa lo comprobado de lo supuesto." },
  tester: { label: "Probador", verb: "prueba", model: "haiku", tools: ["Read", "Glob", "Grep", "Bash"], role: "Ejecuta las pruebas y comprueba que lo hecho funciona.", prompt: "Ejecuta las pruebas relevantes y cuéntame qué falla y por qué. No cambies el código." },
};

/** What travels along a connection: from the planner (what it hands the subagent) or between subagents. */
export const PASSES = ["summary", "full", "paths", "none"] as const;
export type Pass = (typeof PASSES)[number];
export const MODELS = ["default", "opus", "sonnet", "haiku", "opusplan"] as const;
export const SCOPES = ["chats", "runs", "tasks"] as const;
export type Scope = (typeof SCOPES)[number];

/** The tools of Claude Code a subagent may be limited to. */
export const TOOLS = ["Read", "Glob", "Grep", "Edit", "Write", "Bash", "WebSearch", "WebFetch", "NotebookEdit", "TodoWrite"] as const;

export const nodeSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "id no válido"),
  kind: z.enum(NODE_KINDS),
  label: z.string().trim().min(1, "Ponle un nombre").max(40),
  /** What a subagent is for (writes, reads, reviews…). */
  job: z.enum(JOBS).default("custom"),
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
    edges: z
      .array(
        z.object({
          from: z.string(),
          to: z.string(),
          /** What is handed over: a summary, everything, only the file paths, or nothing. */
          pass: z.enum(PASSES).default("summary"),
          /** From the planner: launched together, or one after the other. */
          run: z.enum(["parallel", "sequence"]).default("sequence"),
          note: text(200).default(""),
        }),
      )
      .max(60)
      .default([]),
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

  const WRITES = new Set(["Edit", "Write", "NotebookEdit"]);
  const lines: string[] = ["# Orquestación (definida en Agentic)"];
  if (planner) {
    lines.push(`Trabajas como «${planner.label}»${planner.role.trim() ? `: ${planner.role.trim()}` : "."}`);
    if (planner.prompt.trim()) lines.push(planner.prompt.trim());
    lines.push("Antes de actuar, planifica: divide el trabajo en pasos y decide qué haces tú y qué delegas.");
  }
  if (agents.length) {
    lines.push("", "Subagentes a los que puedes delegar (herramienta Task), cada uno con su propio modelo:");
    for (const a of agents) {
      const writes = !a.tools.length || a.tools.some((t) => WRITES.has(t));
      const what = a.job !== "custom" ? `${JOB_INFO[a.job].verb}; ` : "";
      lines.push(`- «${names.get(a.id)}» (${MODEL_NAME[a.model === "default" ? "default" : a.model]}): ${what}${a.role.trim() || a.label}${writes ? "" : " Sólo lee: no puede modificar archivos."}`);
    }
    const fromPlanner = g.edges.filter((e) => planner && e.from === planner.id && names.has(e.to));
    if (fromPlanner.length) {
      lines.push("", "Cómo repartes el trabajo:");
      const together = fromPlanner.filter((e) => e.run === "parallel");
      const after = fromPlanner.filter((e) => e.run !== "parallel");
      if (together.length > 1) lines.push(`- Lanza a la vez, en una misma respuesta con varias llamadas a Task: ${together.map((e) => `«${names.get(e.to)}»`).join(", ")}.`);
      else for (const e of together) lines.push(`- «${names.get(e.to)}» puede lanzarse a la vez que los demás.`);
      if (after.length) lines.push(`- Lanza uno tras otro, esperando su resultado antes de seguir: ${after.map((e) => `«${names.get(e.to)}»`).join(", ")}.`);
      const give: Record<Pass, string> = { summary: "la tarea y un resumen del contexto que necesite (no todo)", full: "todo el contexto relevante de la conversación", paths: "sólo la tarea y las rutas de los archivos implicados", none: "sólo la tarea, sin contexto previo" };
      for (const e of fromPlanner) lines.push(`- A «${names.get(e.to)}» pásale ${give[e.pass]}.${e.note.trim() ? ` ${e.note.trim()}` : ""}`);
    }
    const hand = g.edges.filter((e) => names.has(e.from) && names.has(e.to));
    if (hand.length) {
      lines.push("", "Cómo se pasan el contexto entre subagentes:");
      const pass = (e: (typeof hand)[number]): string =>
        ({ summary: "un resumen breve de lo hecho y de las decisiones tomadas", full: `el resultado completo de «${names.get(e.from)}»`, paths: "sólo la lista de archivos que leyó o cambió, una línea por archivo", none: "nada: empieza sin contexto de lo anterior" })[e.pass];
      for (const e of hand) lines.push(`- Cuando «${names.get(e.from)}» termine, a «${names.get(e.to)}» pásale ${pass(e)}.${e.note.trim() ? ` ${e.note.trim()}` : ""}`);
    }
    lines.push("", "Cada subagente te devuelve su resultado a ti: tú decides el siguiente paso. Delega el trabajo mecánico o repetitivo en los subagentes más baratos y reserva tu atención para planificar, decidir y revisar.");
  }
  const env: Record<string, string> = {};
  if (policy) {
    env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = String(policy.threshold);
    lines.push("", `Cuando el contexto llegue al ${policy.threshold}% de la ventana, compacta la conversación conservando decisiones, rutas y tareas pendientes.`);
  }
  const model = planner && planner.model !== "default" ? planner.model : undefined;
  return { ...(model ? { model } : {}), ...(Object.keys(defs).length ? { agents: defs } : {}), appendPrompt: lines.join("\n").slice(0, 10_000), env };
}

/** Starting points that are already valid graphs. */
const agent = (id: string, job: Job, x: number, y: number, extra: Partial<OrchNode> = {}): OrchNode =>
  nodeSchema.parse({ id, kind: "agent", label: JOB_INFO[job].label, job, x, y, model: JOB_INFO[job].model, role: JOB_INFO[job].role, prompt: JOB_INFO[job].prompt, tools: JOB_INFO[job].tools, ...extra });

/** Starting points that are already valid graphs. */
export const PRESETS: { id: string; name: string; description: string; graph: Omit<Graph, "enabled" | "scope"> }[] = [
  {
    id: "planner-cheap-writers",
    name: "Planificador, lector, escritor y revisor",
    description: "Opus planifica; un Lector barato localiza el código y se lo pasa (solo rutas) al Escritor; el Revisor comprueba el resultado.",
    graph: {
      nodes: [
        nodeSchema.parse({ id: "context", kind: "context", label: "Contexto", x: 40, y: 40, threshold: 75 }),
        nodeSchema.parse({ id: "planner", kind: "planner", label: "Planificador", x: 280, y: 200, model: "opus", role: "Entiende la petición, la divide en pasos y reparte el trabajo.", prompt: "Pide aclaraciones solo si algo es ambiguo. Termina con un resumen corto de lo hecho." }),
        agent("reader", "reader", 560, 40),
        agent("writer", "writer", 560, 230),
        agent("reviewer", "reviewer", 560, 420),
      ],
      edges: [
        { from: "context", to: "planner", pass: "summary", run: "sequence", note: "" },
        { from: "planner", to: "reader", pass: "summary", run: "sequence", note: "" },
        { from: "planner", to: "writer", pass: "summary", run: "sequence", note: "" },
        { from: "reader", to: "writer", pass: "paths", run: "sequence", note: "" },
        { from: "writer", to: "reviewer", pass: "summary", run: "sequence", note: "" },
      ],
    },
  },
  {
    id: "opusplan",
    name: "Planificar con Opus, ejecutar con Sonnet",
    description: "Un solo agente que planifica con Opus y ejecuta con Sonnet, sin subagentes.",
    graph: { nodes: [nodeSchema.parse({ id: "planner", kind: "planner", label: "Agente", x: 120, y: 160, model: "opusplan", role: "Planifica con cuidado y después ejecuta." })], edges: [] },
  },
  {
    id: "review-team",
    name: "Equipo de revisión",
    description: "Un coordinador lanza a la vez un especialista en seguridad y otro en rendimiento (solo leen).",
    graph: {
      nodes: [
        nodeSchema.parse({ id: "planner", kind: "planner", label: "Coordinador", x: 60, y: 190, model: "sonnet", role: "Reparte la revisión y reúne los resultados en un informe." }),
        agent("security", "reviewer", 360, 60, { label: "Seguridad", role: "Busca fallos de seguridad: entradas sin validar, secretos, permisos." }),
        agent("perf", "reviewer", 360, 320, { label: "Rendimiento", model: "haiku", role: "Busca cuellos de botella evidentes: consultas repetidas, bucles costosos." }),
      ],
      edges: [
        { from: "planner", to: "security", pass: "paths", run: "parallel", note: "" },
        { from: "planner", to: "perf", pass: "paths", run: "parallel", note: "" },
      ],
    },
  },
  {
    id: "research-then-build",
    name: "Investigar, escribir y probar",
    description: "Un Investigador reúne lo necesario, el Escritor lo implementa con ese resumen y el Probador ejecuta las pruebas.",
    graph: {
      nodes: [
        nodeSchema.parse({ id: "planner", kind: "planner", label: "Planificador", x: 60, y: 200, model: "opus", role: "Decide el enfoque y reparte el trabajo." }),
        agent("researcher", "researcher", 340, 60),
        agent("writer", "writer", 340, 250),
        agent("tester", "tester", 620, 250),
      ],
      edges: [
        { from: "planner", to: "researcher", pass: "summary", run: "sequence", note: "" },
        { from: "researcher", to: "writer", pass: "summary", run: "sequence", note: "" },
        { from: "writer", to: "tester", pass: "paths", run: "sequence", note: "" },
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
