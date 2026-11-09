"use client";

import * as React from "react";
import { BotIcon, EyeIcon, GaugeIcon, LayoutTemplateIcon, PlusIcon, Trash2Icon, WorkflowIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { LiquidOrb } from "@/components/app/liquid-orb";
import { errorMessage, PageHeader } from "@/components/app/common";
import { api, useApi } from "@/lib/api";
import { cn } from "@/lib/utils";

type Kind = "planner" | "agent" | "context";
type Model = "default" | "opus" | "sonnet" | "haiku" | "opusplan";
interface ONode {
  id: string;
  kind: Kind;
  label: string;
  x: number;
  y: number;
  model: Model;
  role: string;
  prompt: string;
  tools: string[];
  threshold: number;
}
interface Edge {
  from: string;
  to: string;
}
interface Graph {
  enabled: boolean;
  scope: { chats: boolean; runs: boolean; tasks: boolean };
  nodes: ONode[];
  edges: Edge[];
}
interface View {
  graph: Graph;
  models: Model[];
  tools: string[];
  presets: { id: string; name: string; description: string; graph: Omit<Graph, "enabled" | "scope"> }[];
}
interface Preview {
  model?: string;
  agents?: Record<string, { description: string; prompt: string; tools?: string[]; model?: string }>;
  appendPrompt: string;
  env: Record<string, string>;
}

/** A fresh id for a cube (lowercase letters and digits: what the server accepts). */
function newId(kind: Kind) {
  return `${kind}-${Math.random().toString(36).slice(2, 8)}`;
}

const W = 184;
const H = 112;
const CANVAS_W = 1500;
const CANVAS_H = 900;

const KIND: Record<Kind, { label: string; help: string; ring: string; chip: string }> = {
  planner: { label: "Planificador", help: "El agente principal: planifica y reparte el trabajo.", ring: "border-purple/60 shadow-[0_0_0_1px_rgb(139_108_245/0.25)]", chip: "bg-purple/15 text-purple" },
  agent: { label: "Subagente", help: "Trabaja para el planificador, con su propio modelo.", ring: "border-border-strong", chip: "bg-secondary text-muted-foreground" },
  context: { label: "Contexto", help: "Cuándo compactar la conversación.", ring: "border-warning/50", chip: "bg-warning/15 text-warning" },
};
const MODEL_LABEL: Record<Model, string> = { default: "Por defecto", opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", opusplan: "Opus → Sonnet" };
/** How capable (and how costly) a model is, as dots: nothing is priced in money here. */
const POWER: Record<Model, number> = { default: 0, opus: 3, sonnet: 2, haiku: 1, opusplan: 3 };

/** The reason a connection is not allowed (null when it is). Same rules as the server. */
function whyNot(nodes: ONode[], edges: Edge[], from: string, to: string): string | null {
  const a = nodes.find((n) => n.id === from);
  const b = nodes.find((n) => n.id === to);
  if (!a || !b || from === to) return "Elige otro cubo";
  const ok = (a.kind === "planner" && b.kind === "agent") || (a.kind === "agent" && b.kind === "agent") || (a.kind === "context" && b.kind === "planner");
  if (!ok) return "Se conecta así: planificador → subagente, subagente → subagente, contexto → planificador";
  if (edges.some((e) => e.from === from && e.to === to)) return "Ya están conectados";
  return null;
}

function Dots({ model }: { model: Model }) {
  const n = POWER[model];
  if (!n) return null;
  return (
    <span className="flex gap-0.5" title={n === 1 ? "Más rápido y barato" : n === 2 ? "Equilibrado" : "El más capaz"} aria-hidden>
      {[1, 2, 3].map((i) => (
        <i key={i} className={cn("size-1.5 rounded-full", i <= n ? "bg-foreground/70" : "bg-foreground/15")} />
      ))}
    </span>
  );
}

function Cube({ n, selected, onPointerDown, onSelect, onPortDown, linking, hot }: { n: ONode; selected: boolean; onPointerDown: (e: React.PointerEvent) => void; onSelect: () => void; onPortDown: (e: React.PointerEvent) => void; linking: boolean; hot: boolean }) {
  const k = KIND[n.kind];
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${k.label}: ${n.label}`}
      aria-pressed={selected}
      data-node-id={n.id}
      data-kind={n.kind}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect())}
      className={cn("pop-in absolute grid cursor-grab touch-none select-none content-between gap-1 rounded-2xl border bg-card p-3 text-left transition-[box-shadow,border-color,transform] duration-200 active:cursor-grabbing", k.ring, selected && "ring-2 ring-ring/70", hot && "ring-2 ring-success/70", !selected && !hot && "hover:border-border-strong")}
      style={{ left: n.x, top: n.y, width: W, height: H }}
    >
      <div className="flex items-start gap-2.5">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", k.chip)}>{n.kind === "planner" ? <LiquidOrb state="thinking" size={22} /> : n.kind === "agent" ? <BotIcon className="size-4" /> : <GaugeIcon className="size-4" />}</span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{n.label}</div>
          <div className="text-[11px] text-muted-foreground">{k.label}</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        {n.kind === "context" ? (
          <span>Compacta al {n.threshold}%</span>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <b className="font-medium text-foreground/80">{n.model === "default" && n.kind === "agent" ? "Igual que el planificador" : MODEL_LABEL[n.model]}</b>
              <Dots model={n.model} />
            </span>
            {n.kind === "agent" && <span>{n.tools.length ? `${n.tools.length} herram.` : "todas"}</span>}
          </>
        )}
      </div>
      {/* Where a connection comes in, and where it goes out */}
      {n.kind !== "context" && <span aria-hidden data-port="in" className="absolute top-1/2 -left-1.5 size-3 -translate-y-1/2 rounded-full border-2 border-border-strong bg-card" />}
      {n.kind !== "agent" || true ? (
        <span
          aria-hidden
          data-port="out"
          title="Arrastra hasta otro cubo para conectar"
          onPointerDown={onPortDown}
          className={cn("absolute top-1/2 -right-2 size-4 -translate-y-1/2 cursor-crosshair rounded-full border-2 bg-card transition-transform hover:scale-125", linking ? "scale-125 border-success" : "border-purple/70")}
        />
      ) : null}
    </div>
  );
}

function curve(a: ONode, b: ONode) {
  const x1 = a.x + W + 2;
  const y1 = a.y + H / 2;
  const x2 = b.x - 4;
  const y2 = b.y + H / 2;
  const dx = Math.max(60, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function Editor({ initial }: { initial: View }) {
  const [g, setG] = React.useState<Graph>(initial.graph);
  const [sel, setSel] = React.useState<{ type: "node"; id: string } | { type: "edge"; i: number } | null>(null);
  const [status, setStatus] = React.useState<"saved" | "saving" | "error">("saved");
  const [linking, setLinking] = React.useState<{ from: string; x: number; y: number } | null>(null);
  const [hot, setHot] = React.useState<string | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const inner = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ id: string; ox: number; oy: number; moved: boolean } | null>(null);
  const touched = React.useRef(false);
  const latest = React.useRef(g);

  const change = (fn: (g: Graph) => Graph) => {
    touched.current = true;
    setG((cur) => {
      const next = fn(cur);
      latest.current = next;
      return next;
    });
    setStatus("saving");
  };

  // Autosave, a moment after the last change.
  React.useEffect(() => {
    if (!touched.current) return;
    const t = setTimeout(async () => {
      try {
        await api("PUT", "/api/orchestrator", latest.current);
        setStatus("saved");
      } catch (e) {
        setStatus("error");
        toast.error("No se pudo guardar", { description: errorMessage(e) });
      }
    }, 600);
    return () => clearTimeout(t);
  }, [g]);

  const selected = sel?.type === "node" ? g.nodes.find((n) => n.id === sel.id) : undefined;
  const patch = (id: string, p: Partial<ONode>) => change((cur) => ({ ...cur, nodes: cur.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) }));

  function add(kind: Kind) {
    if (kind !== "agent" && g.nodes.some((n) => n.kind === kind)) return toast.message(kind === "planner" ? "Ya hay un planificador" : "Ya hay una política de contexto");
    const i = g.nodes.length;
    const n: ONode = {
      id: newId(kind),
      kind,
      label: kind === "planner" ? "Planificador" : kind === "agent" ? `Subagente ${g.nodes.filter((x) => x.kind === "agent").length + 1}` : "Contexto",
      x: 70 + ((i * 60) % 700),
      y: 70 + ((i * 90) % 500),
      model: kind === "agent" ? "haiku" : "default",
      role: "",
      prompt: "",
      tools: [],
      threshold: 80,
    };
    change((cur) => ({ ...cur, nodes: [...cur.nodes, n] }));
    setSel({ type: "node", id: n.id });
  }

  function connect(from: string, to: string) {
    const why = whyNot(g.nodes, g.edges, from, to);
    if (why) return toast.message(why);
    change((cur) => ({ ...cur, edges: [...cur.edges, { from, to }] }));
  }

  function removeNode(id: string) {
    change((cur) => ({ ...cur, nodes: cur.nodes.filter((n) => n.id !== id), edges: cur.edges.filter((e) => e.from !== id && e.to !== id) }));
    setSel(null);
  }

  const point = (e: { clientX: number; clientY: number }) => {
    const r = inner.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Dragging a connection out of a cube.
  React.useEffect(() => {
    if (!linking) return;
    const move = (e: PointerEvent) => {
      const p = point(e);
      setLinking((l) => (l ? { ...l, ...p } : l));
      setHot((document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-node-id]") as HTMLElement | null)?.dataset.nodeId ?? null);
    };
    const up = (e: PointerEvent) => {
      const to = (document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-node-id]") as HTMLElement | null)?.dataset.nodeId;
      const from = linking.from;
      setLinking(null);
      setHot(null);
      if (to && to !== from) connect(from, to);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linking?.from]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if ((e.key !== "Delete" && e.key !== "Backspace") || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !sel) return;
      if (sel.type === "node") removeNode(sel.id);
      else {
        change((cur) => ({ ...cur, edges: cur.edges.filter((_, i) => i !== sel.i) }));
        setSel(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  function applyPreset(id: string) {
    const p = initial.presets.find((x) => x.id === id);
    if (!p) return;
    if (g.nodes.length && !confirm("Esto reemplaza lo que has dibujado. ¿Seguir?")) return;
    change((cur) => ({ ...cur, nodes: p.graph.nodes, edges: p.graph.edges, enabled: true }));
    setSel(null);
  }

  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const targets = selected ? g.nodes.filter((n) => whyNot(g.nodes, g.edges, selected.id, n.id) === null) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border bg-card px-4 py-3">
        <label className="flex items-center gap-3 text-sm">
          <Switch aria-label="Activar el orquestador" checked={g.enabled} onCheckedChange={(on) => change((cur) => ({ ...cur, enabled: on }))} />
          <span>
            <span className="font-medium">{g.enabled ? "Activo" : "Desactivado"}</span>
            <span className="block text-xs text-muted-foreground">{g.enabled ? "Claude trabaja como dibujas, en lo que Agentic lanza." : "Dibuja el equipo y actívalo para aplicarlo."}</span>
          </span>
        </label>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground" role="group" aria-label="Dónde se aplica">
          Se aplica a
          {(["chats", "runs", "tasks"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={g.scope[k]} disabled={!g.enabled} onClick={() => change((cur) => ({ ...cur, scope: { ...cur.scope, [k]: !cur.scope[k] } }))} className={cn("cursor-pointer rounded-full border px-2.5 py-0.5 transition-colors disabled:cursor-default disabled:opacity-50", g.scope[k] ? "border-purple/60 bg-purple/15 text-foreground" : "hover:border-border-strong")}>
              {k === "chats" ? "Chats" : k === "runs" ? "Ejecuciones" : "Tareas"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span data-testid="orch-status" className="text-xs text-muted-foreground" role="status">
            {status === "saving" ? "Guardando…" : status === "error" ? "No guardado" : "Guardado"}
          </span>
          <select aria-label="Plantillas" value="" onChange={(e) => e.target.value && applyPreset(e.target.value)} className="h-8 rounded-md border bg-transparent px-2 text-sm">
            <option value="">Plantillas…</option>
            {initial.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={() => setPreviewing(true)} disabled={!g.nodes.length}>
            <EyeIcon /> Vista previa
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {(["planner", "agent", "context"] as const).map((k) => (
              <Button key={k} size="sm" variant="outline" onClick={() => add(k)} title={KIND[k].help}>
                <PlusIcon /> {KIND[k].label}
              </Button>
            ))}
            <span className="text-xs text-muted-foreground">Arrastra el círculo de un cubo hasta otro para conectarlos.</span>
          </div>
          <div className="relative h-[620px] overflow-auto rounded-xl border bg-inset" data-testid="orch-canvas" onPointerDown={(e) => e.target === e.currentTarget || (e.target as HTMLElement).dataset.bg ? setSel(null) : undefined}>
            <div ref={inner} data-bg className="relative [background-image:radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:24px_24px]" style={{ width: CANVAS_W, height: CANVAS_H }}>
              <svg className="pointer-events-none absolute inset-0" width={CANVAS_W} height={CANVAS_H} aria-hidden>
                <defs>
                  <linearGradient id="orch-grad" x1="0" x2="1">
                    <stop offset="0" stopColor="#8b6cf5" />
                    <stop offset="0.55" stopColor="#ff8a5b" />
                    <stop offset="1" stopColor="#5aa9ff" />
                  </linearGradient>
                </defs>
                {g.edges.map((e, i) => {
                  const a = byId.get(e.from);
                  const b = byId.get(e.to);
                  if (!a || !b) return null;
                  const on = sel?.type === "edge" && sel.i === i;
                  return (
                    <g key={`${e.from}>${e.to}`}>
                      <path d={curve(a, b)} fill="none" stroke="url(#orch-grad)" strokeWidth={on ? 3.5 : 2} strokeLinecap="round" className="orch-edge" opacity={on ? 1 : 0.8} />
                      <path d={curve(a, b)} fill="none" stroke="transparent" strokeWidth={16} style={{ pointerEvents: "stroke", cursor: "pointer" }} data-testid="orch-edge" onClick={() => setSel({ type: "edge", i })} />
                    </g>
                  );
                })}
                {linking && byId.get(linking.from) && (
                  <path d={`M ${byId.get(linking.from)!.x + W + 2} ${byId.get(linking.from)!.y + H / 2} L ${linking.x} ${linking.y}`} fill="none" stroke="url(#orch-grad)" strokeWidth={2} strokeDasharray="4 6" strokeLinecap="round" />
                )}
              </svg>
              {g.nodes.map((n) => (
                <Cube
                  key={n.id}
                  n={n}
                  selected={sel?.type === "node" && sel.id === n.id}
                  hot={hot === n.id && linking?.from !== n.id}
                  linking={linking?.from === n.id}
                  onSelect={() => setSel({ type: "node", id: n.id })}
                  onPortDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setSel({ type: "node", id: n.id });
                    setLinking({ from: n.id, ...point(e) });
                  }}
                  onPointerDown={(e) => {
                    if ((e.target as HTMLElement).dataset.port) return;
                    const p = point(e);
                    drag.current = { id: n.id, ox: p.x - n.x, oy: p.y - n.y, moved: false };
                    setSel({ type: "node", id: n.id });
                    const move = (ev: PointerEvent) => {
                      const d = drag.current;
                      if (!d) return;
                      const q = point(ev);
                      d.moved = true;
                      const x = Math.round(Math.min(CANVAS_W - W, Math.max(0, q.x - d.ox)));
                      const y = Math.round(Math.min(CANVAS_H - H, Math.max(0, q.y - d.oy)));
                      setG((cur) => {
                        const next = { ...cur, nodes: cur.nodes.map((x0) => (x0.id === d.id ? { ...x0, x, y } : x0)) };
                        latest.current = next;
                        return next;
                      });
                    };
                    const up = () => {
                      window.removeEventListener("pointermove", move);
                      if (drag.current?.moved) {
                        touched.current = true;
                        setStatus("saving");
                        setG((cur) => ({ ...cur })); // saves the new place
                      }
                      drag.current = null;
                    };
                    window.addEventListener("pointermove", move);
                    window.addEventListener("pointerup", up, { once: true });
                  }}
                />
              ))}
              {!g.nodes.length && (
                <div className="absolute inset-0 grid place-items-center">
                  <div className="grid max-w-md gap-3 text-center">
                    <WorkflowIcon className="mx-auto size-8 text-muted-foreground" />
                    <h2 className="text-lg font-semibold">Dibuja cómo quieres que trabaje Claude</h2>
                    <p className="text-sm text-muted-foreground">Un planificador que reparte el trabajo, subagentes con modelos más baratos y una regla para compactar el contexto. Empieza con una plantilla o añade cubos.</p>
                    <div className="grid gap-2">
                      {initial.presets.map((p) => (
                        <Button key={p.id} variant="outline" className="h-auto justify-start py-2 text-left" onClick={() => applyPreset(p.id)}>
                          <LayoutTemplateIcon className="shrink-0" />
                          <span className="grid">
                            <b className="text-sm font-medium">{p.name}</b>
                            <span className="text-xs font-normal text-muted-foreground">{p.description}</span>
                          </span>
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="rounded-xl border bg-card p-4" aria-label="Propiedades">
          {selected ? (
            <div className="grid gap-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", KIND[selected.kind].chip)}>{KIND[selected.kind].label}</span>
                <Button size="icon-sm" variant="ghost" aria-label="Borrar el cubo" className="hover:text-destructive" onClick={() => removeNode(selected.id)}>
                  <Trash2Icon />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{KIND[selected.kind].help}</p>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium">Nombre</span>
                <Input aria-label="Nombre del cubo" value={selected.label} maxLength={40} onChange={(e) => patch(selected.id, { label: e.target.value })} />
              </label>
              {selected.kind !== "context" && (
                <>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium">Modelo</span>
                    <select aria-label="Modelo" value={selected.model} onChange={(e) => patch(selected.id, { model: e.target.value as Model })} className="h-9 rounded-md border bg-transparent px-2 text-sm">
                      {selected.kind === "agent" ? <option value="default">Igual que el planificador</option> : <option value="default">El de Claude Code por defecto</option>}
                      <option value="opus">Opus · el más capaz</option>
                      <option value="sonnet">Sonnet · equilibrado</option>
                      <option value="haiku">Haiku · el más rápido y barato</option>
                      {selected.kind === "planner" && <option value="opusplan">Opus planifica, Sonnet ejecuta</option>}
                    </select>
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium">{selected.kind === "agent" ? "Cuándo usarlo" : "Para qué sirve"}</span>
                    <Textarea aria-label="Descripción" rows={2} maxLength={400} value={selected.role} onChange={(e) => patch(selected.id, { role: e.target.value })} placeholder={selected.kind === "agent" ? "Escribe y edita código siguiendo el plan…" : "Entiende la petición y reparte el trabajo…"} />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium">Instrucciones</span>
                    <Textarea aria-label="Instrucciones" rows={4} maxLength={4000} value={selected.prompt} onChange={(e) => patch(selected.id, { prompt: e.target.value })} placeholder="Cómo debe trabajar, qué tono, qué no debe hacer…" />
                  </label>
                </>
              )}
              {selected.kind === "agent" && (
                <div className="grid gap-1.5">
                  <span className="text-xs font-medium">Herramientas {selected.tools.length ? "" : "(todas)"}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {initial.tools.map((t) => {
                      const on = selected.tools.includes(t);
                      return (
                        <button key={t} type="button" aria-pressed={on} onClick={() => patch(selected.id, { tools: on ? selected.tools.filter((x) => x !== t) : [...selected.tools, t] })} className={cn("cursor-pointer rounded-md border px-2 py-0.5 text-xs transition-colors", on ? "border-purple/60 bg-purple/15" : "text-muted-foreground hover:border-border-strong")}>
                          {t}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {selected.kind === "context" && (
                <label className="grid gap-1.5">
                  <span className="flex items-center justify-between text-xs font-medium">
                    Compactar al <b data-testid="orch-threshold">{selected.threshold}%</b> del contexto
                  </span>
                  <input aria-label="Umbral de contexto" type="range" min={20} max={95} step={5} value={selected.threshold} onChange={(e) => patch(selected.id, { threshold: Number(e.target.value) })} className="accent-[#8b6cf5]" />
                  <span className="text-xs text-muted-foreground">Al llegar a ese porcentaje de la ventana de contexto, Claude resume la conversación y sigue. Más bajo: compacta antes y gasta menos; más alto: conserva más detalle.</span>
                </label>
              )}
              <div className="grid gap-1.5">
                <span className="text-xs font-medium">Conexiones</span>
                {g.edges.filter((e) => e.from === selected.id || e.to === selected.id).map((e) => {
                  const other = byId.get(e.from === selected.id ? e.to : e.from);
                  return (
                    <div key={`${e.from}>${e.to}`} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs">
                      <span className="truncate">
                        {e.from === selected.id ? "→" : "←"} {other?.label}
                      </span>
                      <button type="button" aria-label="Quitar la conexión" className="cursor-pointer text-muted-foreground hover:text-destructive" onClick={() => change((cur) => ({ ...cur, edges: cur.edges.filter((x) => x !== e) }))}>
                        <Trash2Icon className="size-3.5" />
                      </button>
                    </div>
                  );
                })}
                {targets.length > 0 && (
                  <select aria-label="Conectar con" value="" onChange={(e) => e.target.value && connect(selected.id, e.target.value)} className="h-8 rounded-md border bg-transparent px-2 text-xs">
                    <option value="">Conectar con…</option>
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          ) : sel?.type === "edge" && g.edges[sel.i] ? (
            <div className="grid gap-3 text-sm">
              <div className="text-xs font-medium text-muted-foreground">Conexión</div>
              <p>
                <b>{byId.get(g.edges[sel.i]!.from)?.label}</b> → <b>{byId.get(g.edges[sel.i]!.to)?.label}</b>
              </p>
              <p className="text-xs text-muted-foreground">{byId.get(g.edges[sel.i]!.from)?.kind === "planner" ? "El planificador puede delegar en este subagente." : byId.get(g.edges[sel.i]!.from)?.kind === "context" ? "La política de contexto se aplica al planificador." : "Cuando termina el primero, pasa su resultado al segundo."}</p>
              <Button size="sm" variant="outline" className="hover:text-destructive" onClick={() => (change((cur) => ({ ...cur, edges: cur.edges.filter((_, i) => i !== sel.i) })), setSel(null))}>
                <Trash2Icon /> Quitar la conexión
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Cómo funciona</p>
              <p><b className="text-foreground">Planificador</b>: el agente principal. Elige su modelo (el más capaz) y sus instrucciones.</p>
              <p><b className="text-foreground">Subagentes</b>: trabajan para él, cada uno con su modelo (por ejemplo, uno barato) y sus herramientas. Conéctalos desde el planificador.</p>
              <p><b className="text-foreground">Contexto</b>: a qué porcentaje de la ventana se compacta la conversación.</p>
              <p className="text-xs">Pulsa un cubo o una conexión para editarlos. Supr borra lo seleccionado.</p>
            </div>
          )}
        </aside>
      </div>

      <PreviewDialog open={previewing} onClose={() => setPreviewing(false)} />
    </div>
  );
}

function PreviewDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, error } = useApi<Record<string, Preview | null>>(open ? "/api/orchestrator/preview" : null);
  const p = data?.chats;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Lo que recibe Claude</DialogTitle>
          <DialogDescription>Así se traduce tu dibujo cuando Agentic lanza una conversación (con lo guardado hasta ahora).</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error.message}</p>}
        {!data && !error && <Skeleton className="h-40" />}
        {data && !p && <p className="text-sm text-muted-foreground">Todavía no hay nada que enviar: añade un planificador o un subagente.</p>}
        {p && (
          <div className="grid gap-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Modelo principal</div>
                <div className="font-medium">{p.model ? MODEL_LABEL[p.model as Model] : "El de Claude Code por defecto"}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Compactar el contexto</div>
                <div className="font-medium">{p.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE ? `al ${p.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE}%` : "como Claude Code decida"}</div>
              </div>
            </div>
            {p.agents && (
              <div className="grid gap-2">
                <div className="text-xs font-medium">Subagentes disponibles</div>
                {Object.entries(p.agents).map(([name, a]) => (
                  <div key={name} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-xs">{name}</code>
                      <span className="text-xs text-muted-foreground">{a.model ? MODEL_LABEL[a.model as Model] : "igual que el principal"} · {a.tools?.length ? a.tools.join(", ") : "todas las herramientas"}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{a.description}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="grid gap-1.5">
              <div className="text-xs font-medium">Instrucciones añadidas</div>
              <pre className="max-h-64 overflow-auto rounded-lg border bg-inset p-3 text-xs whitespace-pre-wrap">{p.appendPrompt}</pre>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function OrchestratorPage() {
  const { data, error } = useApi<View>("/api/orchestrator", { revalidateOnFocus: false });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={WorkflowIcon} title="Orchestrator" description="Dibuja cómo quieres que Claude trabaje: quién planifica, quién escribe, con qué modelo y cuándo compacta el contexto." />
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {!data && !error && <Skeleton className="h-[640px]" />}
      {data && <Editor initial={data} />}
    </div>
  );
}
