import { describe, expect, it } from "vitest";
import { createContext } from "@/lib/server/context";
import { compile, graphSchema, PRESETS, type Graph } from "@/lib/server/orchestrator";
import { FAKE_CLAUDE, tmpDir, waitFor } from "./helpers";

const node = (id: string, kind: "planner" | "agent" | "context", extra: object = {}) => ({ id, kind, label: id, x: 0, y: 0, ...extra });
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
    expect(c.appendPrompt).toContain("«Planificador»");
    expect(c.appendPrompt).toContain("Sé breve.");
    expect(c.appendPrompt).toContain("«escritor-nandu» (Haiku)");
    expect(c.appendPrompt).toContain("Cuando «escritor-nandu» termine, pasa su resultado a «revisor»");
    expect(c.appendPrompt).toContain("70%");
    expect(c.appendPrompt).not.toContain("suelto");
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

describe("applied to the runs Agentic starts", () => {
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
