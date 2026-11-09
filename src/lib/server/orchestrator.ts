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
export const NODE_KINDS = ["planner", "agent", "context", "goal", "memory", "check"] as const;
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
/** The effort Claude puts into thinking (the `--effort` of Claude Code): lower costs fewer tokens. */
export const EFFORTS = ["default", "low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];
export const SCOPES = ["chats", "runs", "tasks"] as const;
export type Scope = (typeof SCOPES)[number];

/** The tools of Claude Code a subagent may be limited to. */
export const TOOLS = ["Read", "Glob", "Grep", "Edit", "Write", "Bash", "WebSearch", "WebFetch", "NotebookEdit", "TodoWrite"] as const;

/** Which cubes can be connected: who hands work to whom. */
export function canLink(from: NodeKind, to: NodeKind): boolean {
  return (
    (from === "planner" && to === "agent") ||
    (from === "agent" && (to === "agent" || to === "check")) ||
    (from === "check" && (to === "agent" || to === "planner")) ||
    ((from === "context" || from === "goal" || from === "memory") && to === "planner")
  );
}
export const LINK_HELP = "Se conecta así: objetivo, memoria y contexto → planificador; planificador → subagente; subagente → subagente o comprobación; comprobación → subagente o planificador";

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
  /** The planner's thinking effort ("default": Claude Code's own). */
  effort: z.enum(EFFORTS).default("default"),
  /** A check: how many times the work may be sent back before giving up. */
  retries: z.number().int().min(0).max(5).default(2),
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
          /** Out of a check: where the work goes when it passes, or when it fails (back to be redone). */
          on: z.enum(["pass", "fail"]).default("pass"),
        }),
      )
      .max(60)
      .default([]),
    /** Ways to spend fewer tokens. */
    options: z.object({ maxParallel: z.number().int().min(1).max(16).default(4), replyLines: z.number().int().min(0).max(50).default(0) }).default({ maxParallel: 4, replyLines: 0 }),
  })
  .superRefine((g, ctx) => {
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    if (byId.size !== g.nodes.length) ctx.addIssue({ code: "custom", path: ["nodes"], message: "Hay dos cubos con el mismo id" });
    const count = (k: string) => g.nodes.filter((n) => n.kind === k).length;
    if (count("planner") > 1) ctx.addIssue({ code: "custom", path: ["nodes"], message: "Sólo puede haber un planificador" });
    if (count("context") > 1) ctx.addIssue({ code: "custom", path: ["nodes"], message: "Sólo puede haber una política de contexto" });
    if (count("goal") > 1) ctx.addIssue({ code: "custom", path: ["nodes"], message: "Sólo puede haber un objetivo" });
    if (count("memory") > 4) ctx.addIssue({ code: "custom", path: ["nodes"], message: "Como mucho cuatro memorias" });
    const seen = new Set<string>();
    for (const [i, e] of g.edges.entries()) {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b || e.from === e.to || !canLink(a.kind, b.kind)) ctx.addIssue({ code: "custom", path: ["edges", i], message: LINK_HELP });
      else if (e.on === "fail" && a.kind !== "check") ctx.addIssue({ code: "custom", path: ["edges", i], message: "Sólo una comprobación tiene salida «si falla»" });
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
  effort?: string;
  agents?: Record<string, AgentDef>;
  /** Who hands work to whom between the subagents (by their names), to show it. */
  flow?: { from: string; to: string; pass: Pass }[];
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

const edgeOf = (from: string, to: string, extra: Partial<Graph["edges"][number]> = {}): Graph["edges"][number] => ({ from, to, pass: "summary", run: "sequence", note: "", on: "pass", ...extra });

/** The graph as what `claude` takes. Null when it is off, or off for this kind of run. */
export function compile(g: Graph, kind: Scope): Compiled | null {
  if (!g.enabled || !g.scope[kind]) return null;
  const planner = g.nodes.find((n) => n.kind === "planner");
  const policy = g.nodes.find((n) => n.kind === "context");
  const goal = g.nodes.find((n) => n.kind === "goal");
  const memories = g.nodes.filter((n) => n.kind === "memory");
  const checks = g.nodes.filter((n) => n.kind === "check");
  const agentsAll = g.nodes.filter((n) => n.kind === "agent");
  if (!planner && !agentsAll.length && !policy && !goal && !memories.length) return null;

  // Agents the planner can reach (directly, through hand-overs or through checks); without a planner, all of them.
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

  const flow = g.edges.filter((e) => names.has(e.from) && names.has(e.to)).map((e) => ({ from: names.get(e.from)!, to: names.get(e.to)!, pass: e.pass }));
  const WRITES = new Set(["Edit", "Write", "NotebookEdit"]);
  const lines: string[] = ["# Orquestación (definida en Agentic)"];
  if (goal) {
    lines.push(`Objetivo: ${goal.role.trim() || goal.label}.${goal.prompt.trim() ? ` Se considera terminado cuando: ${goal.prompt.trim()}` : ""}`);
  }
  for (const m of memories) lines.push(`Memoria «${m.label}»${m.role.trim() ? ` (${m.role.trim()})` : ""}: antes de empezar, lee ${m.prompt.trim() || "lo que esté a mano"}. No vuelvas a leerlo entero si ya lo tienes en contexto.`);
  if (planner) {
    lines.push(`Trabajas como «${planner.label}»${planner.role.trim() ? `: ${planner.role.trim()}` : "."}`);
    if (planner.prompt.trim()) lines.push(planner.prompt.trim());
    lines.push("Antes de actuar, planifica: divide el trabajo en pasos y decide qué haces tú y qué delegas.");
  }
  if (agents.length) {
    lines.push("", "Subagentes a los que puedes delegar (herramienta Agent), cada uno con su propio modelo:");
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
      if (together.length > 1) lines.push(`- Lanza a la vez, en una misma respuesta con varias llamadas a Agent: ${together.map((e) => `«${names.get(e.to)}»`).join(", ")}.`);
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
  // Checks: after a piece of work, a condition that must hold, and what happens when it does not.
  const label = (id: string) => (names.has(id) ? `«${names.get(id)}»` : `«${g.nodes.find((n) => n.id === id)?.label ?? id}»`);
  for (const c of checks) {
    const before = g.edges.filter((e) => e.to === c.id).map((e) => label(e.from));
    if (!before.length) continue;
    if (lines[lines.length - 1] !== "") lines.push("");
    lines.push(`Comprobación «${c.label}» (tras ${before.join(", ")}): ${c.prompt.trim() || "revisa que el trabajo cumple lo pedido"}. Hazla tú o con un subagente de pruebas.`);
    const fail = g.edges.filter((e) => e.from === c.id && e.on === "fail");
    const pass = g.edges.filter((e) => e.from === c.id && e.on !== "fail");
    const back = fail.length ? fail.map((e) => label(e.to)).join(", ") : before.join(", ");
    lines.push(c.retries > 0 ? `- Si no se cumple, devuélvelo a ${back} con el motivo concreto (qué falla y dónde). Reintenta como máximo ${c.retries} ${c.retries === 1 ? "vez" : "veces"}; si sigue sin cumplirse, para y cuéntame qué falla.` : `- Si no se cumple, para y cuéntame qué falla (sin reintentos).`);
    lines.push(pass.length ? `- Si se cumple, ${pass.map((e) => (g.nodes.find((n) => n.id === e.to)?.kind === "planner" ? "lo revisas tú y sigues" : `pasa a ${label(e.to)}`)).join(" y ")}.` : "- Si se cumple, sigue con el plan.");
  }
  // Spending fewer tokens.
  const saving: string[] = [];
  if (agents.length) saving.push(`No lances más de ${g.options.maxParallel} subagentes a la vez.`);
  if (g.options.replyLines > 0 && agents.length) saving.push(`Pide a cada subagente que responda en ${g.options.replyLines} líneas como máximo: lo esencial y rutas, sin volcar archivos ni repetir el encargo.`);
  if (saving.length) lines.push("", "Ahorro de tokens:", ...saving.map((x) => `- ${x}`));
  const env: Record<string, string> = {};
  if (policy) {
    env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = String(policy.threshold);
    lines.push("", `Cuando el contexto llegue al ${policy.threshold}% de la ventana, compacta la conversación conservando decisiones, rutas y tareas pendientes.`);
  }
  const model = planner && planner.model !== "default" ? planner.model : undefined;
  const effort = planner && planner.effort !== "default" ? planner.effort : undefined;
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(Object.keys(defs).length ? { agents: defs } : {}), ...(flow.length ? { flow } : {}), appendPrompt: lines.join("\n").slice(0, 12_000), env };
}

/** A rough idea of how many tokens a team uses, in five steps and with the reasons: not money, just weight. */
export function estimateLoad(g: Graph): { level: 1 | 2 | 3 | 4 | 5; label: string; reasons: string[] } {
  const planner = g.nodes.find((n) => n.kind === "planner");
  const agents = g.nodes.filter((n) => n.kind === "agent");
  const policy = g.nodes.find((n) => n.kind === "context");
  const power = { default: 2, sonnet: 2, haiku: 1, opus: 4, opusplan: 3 } as const;
  const effort = { default: 1, low: 0.6, medium: 1, high: 1.5, xhigh: 2, max: 2.6 } as const;
  const reasons: string[] = [];
  let score = 0;
  if (planner) {
    score += power[planner.model] * effort[planner.effort];
    if (planner.model === "opus" || planner.model === "opusplan") reasons.push(planner.effort === "default" ? "El planificador usa Opus" : `El planificador usa Opus con esfuerzo ${planner.effort}`);
    if (planner.effort === "high" || planner.effort === "xhigh" || planner.effort === "max") reasons.push(`Esfuerzo de pensamiento ${planner.effort}: bájalo a «medium» para gastar menos`);
  } else score += 2;
  const parallel = Math.min(agents.length, g.options.maxParallel);
  for (const a of agents) score += (a.model === "default" ? power[planner?.model ?? "default"] : power[a.model]) * 0.5;
  if (agents.some((a) => a.model === "opus")) reasons.push("Hay subagentes con Opus");
  if (parallel >= 8) reasons.push(`Hasta ${parallel} subagentes a la vez`);
  score += parallel * 0.25;
  if (!policy) {
    score += 1;
    reasons.push("Sin política de contexto: compacta cuando Claude Code decida");
  } else if (policy.threshold >= 80) {
    score += 0.5;
    reasons.push(`Compacta al ${policy.threshold}%: baja el umbral para gastar menos`);
  }
  if (agents.length && g.options.replyLines === 0) {
    score += 0.5;
    reasons.push("Los subagentes responden sin límite de líneas");
  }
  const retries = g.nodes.filter((n) => n.kind === "check").reduce((n, c) => n + c.retries, 0);
  if (retries >= 6) reasons.push(`Hasta ${retries} reintentos entre comprobaciones`);
  score += Math.min(retries, 8) * 0.15;
  const level = (score < 3 ? 1 : score < 5 ? 2 : score < 7.5 ? 3 : score < 10 ? 4 : 5) as 1 | 2 | 3 | 4 | 5;
  return { level, label: ["", "Muy ligero", "Ligero", "Medio", "Pesado", "Muy pesado"][level]!, reasons };
}

const agent = (id: string, job: Job, x: number, y: number, extra: Partial<OrchNode> = {}): OrchNode =>
  nodeSchema.parse({ id, kind: "agent", label: JOB_INFO[job].label, job, x, y, model: JOB_INFO[job].model, role: JOB_INFO[job].role, prompt: JOB_INFO[job].prompt, tools: JOB_INFO[job].tools, ...extra });
const cube = (kind: NodeKind, id: string, label: string, x: number, y: number, extra: Partial<OrchNode> = {}): OrchNode => nodeSchema.parse({ id, kind, label, x, y, ...extra });
const OPTS = { maxParallel: 4, replyLines: 0 };

/** Starting points that are already valid graphs. */
export const PRESETS: { id: string; name: string; description: string; graph: Omit<Graph, "enabled" | "scope"> }[] = [
  {
    id: "omega-light",
    name: "Omega ligero (pocos tokens)",
    description: "Opus con esfuerzo medio planifica y verifica; Haiku investiga, construye, prueba y revisa en paralelo, con comprobaciones que devuelven lo que falla. Compacta al 40%.",
    graph: {
      nodes: [
        cube("goal", "goal", "Objetivo", 30, 20, { role: "Entregar lo que se pide, bien hecho y sin ampliar el alcance", prompt: "las pruebas pasan y el resumen final es corto" }),
        cube("memory", "memory", "Memoria", 30, 190, { role: "Lo que ya se sabe del proyecto", prompt: "CLAUDE.md y la carpeta docs/ (solo lo que haga falta)" }),
        cube("context", "context", "Contexto", 30, 360, { threshold: 40 }),
        cube("planner", "planner", "Omega", 290, 190, { model: "opus", effort: "medium", role: "Planifica, reparte el trabajo en piezas pequeñas, da instrucciones y verifica.", prompt: "Piensa lo justo: decide con claridad y reparte. No repitas lo que ya hacen los subagentes." }),
        agent("research", "researcher", 570, 10, { label: "Investigar", model: "haiku" }),
        agent("build", "writer", 570, 150, { label: "Construir", model: "haiku" }),
        agent("test", "tester", 570, 290, { label: "Probar", model: "haiku" }),
        agent("review", "reviewer", 570, 430, { label: "Revisar", model: "haiku" }),
        cube("check", "check", "Comprobar", 850, 150, { prompt: "el cambio hace lo pedido, las pruebas pasan y no se ha tocado nada fuera del alcance", retries: 2 }),
      ],
      edges: [
        edgeOf("goal", "planner"),
        edgeOf("memory", "planner", { pass: "paths" }),
        edgeOf("context", "planner"),
        edgeOf("planner", "research", { pass: "summary", run: "parallel" }),
        edgeOf("planner", "build", { pass: "summary", run: "parallel" }),
        edgeOf("planner", "test", { pass: "paths", run: "parallel" }),
        edgeOf("planner", "review", { pass: "paths", run: "parallel" }),
        edgeOf("build", "check", { pass: "summary" }),
        edgeOf("check", "planner", { on: "pass", pass: "summary" }),
        edgeOf("check", "build", { on: "fail", pass: "summary", note: "Incluye el error exacto." }),
      ],
      options: { maxParallel: 4, replyLines: 10 },
    },
  },
  {
    id: "planner-cheap-writers",
    name: "Planificador, lector, escritor y revisor",
    description: "Opus planifica; un Lector barato localiza el código y se lo pasa (solo rutas) al Escritor; el Revisor comprueba el resultado.",
    graph: {
      nodes: [
        cube("context", "context", "Contexto", 40, 40, { threshold: 75 }),
        cube("planner", "planner", "Planificador", 280, 200, { model: "opus", role: "Entiende la petición, la divide en pasos y reparte el trabajo.", prompt: "Pide aclaraciones solo si algo es ambiguo. Termina con un resumen corto de lo hecho." }),
        agent("reader", "reader", 560, 40),
        agent("writer", "writer", 560, 230),
        agent("reviewer", "reviewer", 560, 420),
      ],
      edges: [edgeOf("context", "planner"), edgeOf("planner", "reader"), edgeOf("planner", "writer"), edgeOf("reader", "writer", { pass: "paths" }), edgeOf("writer", "reviewer")],
      options: OPTS,
    },
  },
  {
    id: "opusplan",
    name: "Planificar con Opus, ejecutar con Sonnet",
    description: "Un solo agente que planifica con Opus y ejecuta con Sonnet, sin subagentes.",
    graph: { nodes: [cube("planner", "planner", "Agente", 120, 160, { model: "opusplan", effort: "medium", role: "Planifica con cuidado y después ejecuta." })], edges: [], options: OPTS },
  },
  {
    id: "review-team",
    name: "Equipo de revisión",
    description: "Un coordinador lanza a la vez un especialista en seguridad y otro en rendimiento (solo leen).",
    graph: {
      nodes: [
        cube("planner", "planner", "Coordinador", 60, 190, { model: "sonnet", role: "Reparte la revisión y reúne los resultados en un informe." }),
        agent("security", "reviewer", 360, 60, { label: "Seguridad", role: "Busca fallos de seguridad: entradas sin validar, secretos, permisos." }),
        agent("perf", "reviewer", 360, 320, { label: "Rendimiento", model: "haiku", role: "Busca cuellos de botella evidentes: consultas repetidas, bucles costosos." }),
      ],
      edges: [edgeOf("planner", "security", { pass: "paths", run: "parallel" }), edgeOf("planner", "perf", { pass: "paths", run: "parallel" })],
      options: OPTS,
    },
  },
  {
    id: "research-then-build",
    name: "Investigar, escribir y probar",
    description: "Un Investigador reúne lo necesario, el Escritor lo implementa con ese resumen y el Probador ejecuta las pruebas.",
    graph: {
      nodes: [
        cube("planner", "planner", "Planificador", 60, 200, { model: "opus", effort: "medium", role: "Decide el enfoque y reparte el trabajo." }),
        agent("researcher", "researcher", 340, 60),
        agent("writer", "writer", 340, 250),
        agent("tester", "tester", 620, 250),
      ],
      edges: [edgeOf("planner", "researcher"), edgeOf("researcher", "writer"), edgeOf("writer", "tester", { pass: "paths" })],
      options: OPTS,
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

  /** How heavy the team is (and why). */
  load() {
    return estimateLoad(this.get());
  }
}
