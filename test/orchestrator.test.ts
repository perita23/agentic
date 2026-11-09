import { describe, expect, it } from "vitest";
import { createContext } from "@/lib/server/context";
import { canLink, compile, estimateLoad, graphSchema, PRESETS, type Graph } from "@/lib/server/orchestrator";
import { FAKE_CLAUDE, tmpDir, waitFor } from "./helpers";

const node = (id: string, kind: "planner" | "agent" | "context" | "goal" | "memory" | "check", extra: object = {}) => ({ id, kind, label: id, x: 0, y: 0, ...extra });
const graph = (g: object): Graph => graphSchema.parse({ enabled: true, ...g });

describe("the graph", () => {
  it("accepts the right connections and refuses the rest", () => {
    const ok = { nodes: [node("p", "planner"), node("a", "agent"), node("b", "agent"), node("c", "context")], edges: [{ from: "p", to: "a" }, { from: "a", to: "b" }, { from: "c", to: "p" }] };
    expect(graphSchema.safeParse(ok).success).toBe(true);
    const bad = (edges: { from: string; to: string }[]) => graphSchema.safeParse({ ...ok, edges }).success;
    expect(bad([{ from: "a", to: "p" }])).toBe(false); // nothing flows back to the planner
    expect(bad([{ from: "p", to: "c" }])).toBe(false);
    expect(bad([{ from: "a", to: "a" }])).toBe(false);
    expect(bad([{ from: "p", to: "x" }])).toBe(false);
    expect(bad([{ from: "p", to: "a" }, { from: "p", to: "a" }])).toBe(false);
    expect(graphSchema.safeParse({ nodes: [node("p", "planner"), node("q", "planner")] }).success).toBe(false);
    expect(graphSchema.safeParse({ nodes: [node("a", "agent"), node("a", "agent")] }).success).toBe(false);
    expect(graphSchema.safeParse({ nodes: [{ ...node("a", "agent"), label: "  " }] }).success).toBe(false);
    expect(graphSchema.safeParse({ nodes: [{ ...node("a", "agent"), threshold: 5 }] }).success).toBe(false);
    expect(graphSchema.safeParse({ nodes: [{ ...node("a", "agent"), tools: ["Rm"] }] }).success).toBe(false);
  });

  it("every ready-made starting point is valid and compiles", () => {
    for (const p of PRESETS) {
      const g = graphSchema.parse({ enabled: true, ...p.graph });
      for (const k of ["chats", "runs", "tasks"] as const) expect(compile(g, k), p.id).not.toBeNull();
    }
  });
});

describe("what the graph becomes for claude", () => {
  const g = graph({
    nodes: [
      node("p", "planner", { label: "Planificador", model: "opus", role: "Divide el trabajo.", prompt: "Sé breve." }),
      node("w", "agent", { label: "Escritor ñandú", model: "haiku", role: "Escribe código.", tools: ["Read", "Edit"] }),
      node("r", "agent", { label: "Revisor", model: "default", role: "Revisa." }),
      node("x", "agent", { label: "Suelto" }), // not connected to the planner
      node("c", "context", { threshold: 70 }),
    ],
    edges: [{ from: "p", to: "w" }, { from: "w", to: "r" }, { from: "c", to: "p" }],
  });

  it("is nothing when it is off, or off for that kind of run", () => {
    expect(compile({ ...g, enabled: false }, "chats")).toBeNull();
    expect(compile({ ...g, scope: { chats: false, runs: true, tasks: true } }, "chats")).toBeNull();
    expect(compile({ ...g, scope: { chats: false, runs: true, tasks: true } }, "runs")).not.toBeNull();
    expect(compile(graph({}), "chats")).toBeNull();
  });

  it("gives the planner's model, the reachable subagents with their own models and tools, and the compaction", () => {
    const c = compile(g, "chats")!;
    expect(c.model).toBe("opus");
    expect(Object.keys(c.agents!)).toEqual(["escritor-nandu", "revisor"]); // «Suelto» is not reachable
    expect(c.agents!["escritor-nandu"]).toEqual({ description: "Escribe código.", prompt: "Escribe código.", tools: ["Read", "Edit"], model: "haiku" });
    expect(c.agents!.revisor).toEqual({ description: "Revisa.", prompt: "Revisa." }); // «default»: the planner's own model
    expect(c.env).toEqual({ CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "70" });
    expect(c.flow).toEqual([{ from: "escritor-nandu", to: "revisor", pass: "summary" }]); // how the subagents hand work over, to show it
    expect(c.appendPrompt).toContain("«Planificador»");
    expect(c.appendPrompt).toContain("Sé breve.");
    expect(c.appendPrompt).toContain("«escritor-nandu» (Haiku)");
    expect(c.appendPrompt).toContain("Cuando «escritor-nandu» termine, a «revisor» pásale un resumen breve de lo hecho");
    expect(c.appendPrompt).toContain("70%");
    expect(c.appendPrompt).not.toContain("suelto");
  });

  it("says who writes and who only reads, what each connection hands over, and what runs together", () => {
    const team = graph({
      nodes: [
        node("p", "planner", { label: "Jefe" }),
        node("l", "agent", { label: "Lector", job: "reader", tools: ["Read", "Grep"], role: "Lee el código." }),
        node("e", "agent", { label: "Escritor", job: "writer", tools: ["Read", "Edit"], role: "Escribe." }),
        node("t", "agent", { label: "Probador", job: "tester", tools: ["Bash"], role: "Prueba." }),
      ],
      edges: [
        { from: "p", to: "l", pass: "none", run: "parallel" },
        { from: "p", to: "t", pass: "full", run: "parallel", note: "Dale también el comando de pruebas." },
        { from: "p", to: "e", pass: "paths", run: "sequence" },
        { from: "l", to: "e", pass: "paths", note: "Una línea por archivo." },
        { from: "e", to: "t", pass: "none" },
      ],
    });
    const t = compile(team, "chats")!.appendPrompt;
    expect(t).toContain("«lector» (el modelo por defecto): lee; Lee el código. Sólo lee: no puede modificar archivos.");
    expect(t).toContain("«escritor» (el modelo por defecto): escribe; Escribe.");
    expect(t).not.toMatch(/«escritor»[^\n]*Sólo lee/);
    expect(t).toContain("Lanza a la vez, en una misma respuesta con varias llamadas a Agent: «lector», «probador».");
    expect(t).toContain("Lanza uno tras otro, esperando su resultado antes de seguir: «escritor».");
    expect(t).toContain("A «lector» pásale sólo la tarea, sin contexto previo.");
    expect(t).toContain("A «probador» pásale todo el contexto relevante de la conversación. Dale también el comando de pruebas.");
    expect(t).toContain("A «escritor» pásale sólo la tarea y las rutas de los archivos implicados.");
    expect(t).toContain("Cuando «lector» termine, a «escritor» pásale sólo la lista de archivos que leyó o cambió, una línea por archivo. Una línea por archivo.");
    expect(t).toContain("Cuando «escritor» termine, a «probador» pásale nada: empieza sin contexto de lo anterior.");
    expect(t).toContain("Cada subagente te devuelve su resultado a ti");
  });

  it("an old graph (without jobs or connection details) still loads, with sensible defaults", () => {
    const old = graphSchema.parse({ enabled: true, nodes: [node("p", "planner"), node("a", "agent")], edges: [{ from: "p", to: "a" }] });
    expect(old.edges[0]).toEqual({ from: "p", to: "a", pass: "summary", run: "sequence", note: "", on: "pass" });
    expect(old.options).toEqual({ maxParallel: 4, replyLines: 0 });
    expect(old.nodes[0]!.effort).toBe("default");
    expect(old.nodes[1]!.job).toBe("custom");
    expect(graphSchema.safeParse({ nodes: [], edges: [{ from: "a", to: "b", pass: "todo" }] }).success).toBe(false);
  });

  it("without a planner every agent is offered; same names get a suffix", () => {
    const c = compile(graph({ nodes: [node("a", "agent", { label: "Ayuda" }), node("b", "agent", { label: "Ayuda" })] }), "runs")!;
    expect(Object.keys(c.agents!)).toEqual(["ayuda", "ayuda-2"]);
    expect(c.model).toBeUndefined();
    expect(c.env).toEqual({});
  });
});

function setup() {
  return createContext({ dataDir: tmpDir(), claudeHome: tmpDir(), claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 3, maxLogBytes: 1e6 });
}
async function firstMessage(c: ReturnType<typeof setup>, input: object) {
  const run = await c.runs.start({ mode: "headless", projectPath: tmpDir(), prompt: "hola", permissionMode: "default", ...input } as never);
  const ev = await waitFor(() => {
    const events = c.runs.readLog(run.id, 0).events as { type: string; message?: { content?: { text?: string }[] } }[];
    return events.find((e) => e.type === "assistant") ?? null;
  });
  return JSON.parse(ev!.message!.content![0]!.text!) as { args: string[]; compact: string | null };
}

describe("goal, memory, checks and the effort", () => {
  const team = graph({
    nodes: [
      node("o", "goal", { label: "Objetivo", role: "Arreglar el login", prompt: "las pruebas pasan" }),
      node("m", "memory", { label: "Memoria", role: "Lo ya sabido", prompt: "CLAUDE.md y docs/" }),
      node("p", "planner", { label: "Omega", model: "opus", effort: "medium" }),
      node("b", "agent", { label: "Construir", role: "Construye." }),
      node("c", "check", { label: "Comprobar", prompt: "las pruebas pasan", retries: 2 }),
    ],
    edges: [{ from: "o", to: "p" }, { from: "m", to: "p" }, { from: "p", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "p", on: "pass" }, { from: "c", to: "b", on: "fail" }],
    options: { maxParallel: 3, replyLines: 8 },
  });

  it("knows who can be connected to whom", () => {
    expect(canLink("goal", "planner")).toBe(true);
    expect(canLink("memory", "planner")).toBe(true);
    expect(canLink("agent", "check")).toBe(true);
    expect(canLink("check", "agent")).toBe(true);
    expect(canLink("check", "planner")).toBe(true);
    expect(canLink("planner", "check")).toBe(false);
    expect(canLink("goal", "agent")).toBe(false);
    expect(graphSchema.safeParse({ ...team, nodes: [...team.nodes, node("o2", "goal")] }).success).toBe(false);
    expect(graphSchema.safeParse({ ...team, edges: [{ from: "p", to: "b", on: "fail" }] }).success).toBe(false); // only a check has «if it fails»
  });

  it("gives the effort, the goal, the memory, the checks and the ways to spend fewer tokens", () => {
    const c = compile(team, "chats")!;
    expect(c.effort).toBe("medium");
    expect(c.model).toBe("opus");
    expect(c.appendPrompt).toContain("Objetivo: Arreglar el login. Se considera terminado cuando: las pruebas pasan");
    expect(c.appendPrompt).toContain("Memoria «Memoria» (Lo ya sabido): antes de empezar, lee CLAUDE.md y docs/");
    expect(c.appendPrompt).toContain("Comprobación «Comprobar» (tras «construir»): las pruebas pasan.");
    expect(c.appendPrompt).toContain("devuélvelo a «construir» con el motivo concreto");
    expect(c.appendPrompt).toContain("Reintenta como máximo 2 veces");
    expect(c.appendPrompt).toContain("lo revisas tú y sigues");
    expect(c.appendPrompt).toContain("No lances más de 3 subagentes a la vez.");
    expect(c.appendPrompt).toContain("8 líneas como máximo");
    expect(compile(graph({ nodes: [node("p", "planner")] }), "chats")!.effort).toBeUndefined();
  });

  it("estimates how heavy a team is, and why", () => {
    const heavy = estimateLoad(graph({ nodes: [node("p", "planner", { model: "opus", effort: "max" }), ...["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((id) => node(id, "agent", { model: "opus" }))], edges: [], options: { maxParallel: 16, replyLines: 0 } }));
    expect(heavy.level).toBeGreaterThanOrEqual(4);
    expect(heavy.reasons.join(" ")).toMatch(/Opus/);
    const light = estimateLoad(graph({ nodes: [node("p", "planner", { model: "sonnet", effort: "low" }), node("c", "context", { threshold: 40 }), node("a", "agent", { model: "haiku" })], edges: [{ from: "p", to: "a" }, { from: "c", to: "p" }], options: { maxParallel: 2, replyLines: 10 } }));
    expect(light.level).toBe(1);
    const omega = PRESETS.find((p) => p.id === "omega-light")!;
    const og = graphSchema.parse({ enabled: true, ...omega.graph });
    expect(estimateLoad(og).level).toBeLessThanOrEqual(3); // Opus, but medium effort, Haiku workers, compacts at 40%
    expect(compile(og, "chats")!.effort).toBe("medium");
    expect(compile(og, "chats")!.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE).toBe("40");
    expect(Object.values(compile(og, "chats")!.agents!).every((a) => a.model === "haiku")).toBe(true);
  });
});

describe("applied to the runs Agentic starts", () => {
  it("passes the effort to claude", async () => {
    const c = setup();
    c.orchestrator.set({ enabled: true, nodes: [node("p", "planner", { model: "opus", effort: "medium" })], edges: [] });
    const m = await firstMessage(c, {});
    expect(m.args[m.args.indexOf("--effort") + 1]).toBe("medium");
    expect(m.args[m.args.indexOf("--model") + 1]).toBe("opus");
  });

  it("hands claude the model, the subagents, the instructions and the compaction threshold", async () => {
    const c = setup();
    c.orchestrator.set({ enabled: true, nodes: g().nodes, edges: g().edges });
    const m = await firstMessage(c, {});
    expect(m.args[m.args.indexOf("--model") + 1]).toBe("opus");
    const agents = JSON.parse(m.args[m.args.indexOf("--agents") + 1]!);
    expect(Object.keys(agents)).toEqual(["escritor-nandu", "revisor"]);
    expect(m.args[m.args.indexOf("--append-system-prompt") + 1]).toContain("Orquestación");
    expect(m.compact).toBe("70");
  });

  it("never overrides what was chosen for the run, and is off when it is off", async () => {
    const c = setup();
    c.orchestrator.set({ enabled: true, nodes: g().nodes, edges: g().edges });
    const own = await firstMessage(c, { model: "sonnet" });
    expect(own.args[own.args.indexOf("--model") + 1]).toBe("sonnet");
    const agent = await firstMessage(c, { agent: "mi-agente" });
    expect(agent.args).not.toContain("--agents");
    c.orchestrator.set({ enabled: false, nodes: g().nodes, edges: g().edges });
    const off = await firstMessage(c, {});
    expect(off.args).not.toContain("--agents");
    expect(off.args).not.toContain("--model");
    expect(off.compact).toBe(process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE ?? null); // whatever the environment already had
  });

  it("applies per kind: chats, plain runs and tasks", async () => {
    const c = setup();
    c.orchestrator.set({ enabled: true, scope: { chats: false, runs: true, tasks: false }, nodes: g().nodes, edges: g().edges });
    expect((await firstMessage(c, {})).args).toContain("--agents"); // a plain run
    const chat = await c.chats.create({ prompt: "hola desde el chat" });
    const run = (await waitFor(() => c.runs.list().find((r) => r.id === chat.lastRunId) ?? null))!;
    const ev = await waitFor(() => (c.runs.readLog(run.id, 0).events as { type: string; message?: { content?: { text?: string }[] } }[]).find((e) => e.type === "assistant") ?? null);
    expect(JSON.parse(ev!.message!.content![0]!.text!).args).not.toContain("--agents"); // chats are off
  });
});

function g() {
  return graph({
    nodes: [
      node("p", "planner", { label: "Planificador", model: "opus", role: "Divide el trabajo." }),
      node("w", "agent", { label: "Escritor ñandú", model: "haiku", role: "Escribe código.", tools: ["Read", "Edit"] }),
      node("r", "agent", { label: "Revisor", role: "Revisa." }),
      node("c", "context", { threshold: 70 }),
    ],
    edges: [{ from: "p", to: "w" }, { from: "w", to: "r" }, { from: "c", to: "p" }],
  });
}
