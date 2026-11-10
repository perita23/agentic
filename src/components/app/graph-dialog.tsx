"use client";

import * as React from "react";
import { MaximizeIcon, SearchIcon, ZoomInIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useApi } from "@/lib/api";
import { colorOf, GraphEngine, type GLink, type GNode } from "@/lib/graph-view";

interface GraphData {
  nodes: GNode[];
  links: (GLink & { relation: string })[];
  total: { nodes: number; edges: number };
  communities: { id: number; size: number; name: string }[];
}

/** The project's Graphify graph, drawn inside Agentic: Morphy-coloured blobs per community, drag, zoom, search and a detail panel. */
export function GraphDialog({ path, open, onOpenChange }: { path: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data, error } = useApi<GraphData>(open ? `/api/graphify/graph?path=${encodeURIComponent(path)}` : null, { revalidateOnFocus: false });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-[min(1200px,95vw)] flex-col gap-3 p-4 sm:max-w-[min(1200px,95vw)]">
        <DialogHeader>
          <DialogTitle>Grafo del proyecto</DialogTitle>
          <DialogDescription>
            {data ? `Se dibujan los ${data.nodes.length} nodos más conectados de ${data.total.nodes} (${data.links.length} de ${data.total.edges} relaciones). El color es la comunidad; las líneas discontinuas son relaciones inferidas.` : "Cargando el grafo…"}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error instanceof Error ? error.message : "No se pudo cargar el grafo"}</p>}
        {data && <GraphStage data={data} />}
      </DialogContent>
    </Dialog>
  );
}

function GraphStage({ data }: { data: GraphData }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const engine = React.useRef<GraphEngine | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [hover, setHover] = React.useState<{ id: string; x: number; y: number } | null>(null);
  const [q, setQ] = React.useState("");
  const [found, setFound] = React.useState<string[]>([]);
  const byId = React.useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data]);
  const adjacency = React.useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of data.links) {
      if (!m.has(l.source)) m.set(l.source, new Set());
      if (!m.has(l.target)) m.set(l.target, new Set());
      m.get(l.source)!.add(l.target);
      m.get(l.target)!.add(l.source);
    }
    return m;
  }, [data]);

  React.useEffect(() => {
    const canvas = canvasRef.current!;
    const e = new GraphEngine(canvas, { onSelect: setSelected, onHover: (id, x, y) => setHover(id ? { id, x, y } : null) });
    engine.current = e;
    e.setData(data.nodes, data.links);
    const ro = new ResizeObserver(() => e.resize());
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      e.destroy();
      engine.current = null;
    };
  }, [data]);

  const node = selected ? byId.get(selected) : null;
  const neighbors = selected ? [...(adjacency.get(selected) ?? [])].map((k) => byId.get(k)!).filter(Boolean).sort((a, b) => b.degree - a.degree) : [];
  const hovered = hover ? byId.get(hover.id) : null;

  return (
    <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[1fr_280px]">
      <div className="relative min-h-[300px] overflow-hidden rounded-lg border bg-black/30">
        <canvas ref={canvasRef} className="size-full cursor-grab touch-none text-foreground" aria-label="Grafo de conocimiento del proyecto" />
        {hovered && hover && (
          <div className="pointer-events-none absolute z-10 max-w-64 rounded-md border bg-popover px-2 py-1 text-xs shadow-md" style={{ left: Math.min(hover.x + 12, 9999), top: hover.y + 12 }}>
            <p className="font-medium">{hovered.label}</p>
            {hovered.file && <p className="truncate text-muted-foreground">{hovered.file}</p>}
            <p className="text-muted-foreground">{hovered.degree} conexiones</p>
          </div>
        )}
        <div className="absolute right-2 bottom-2 flex gap-1">
          <Button size="icon-sm" variant="secondary" aria-label="Encajar en pantalla" onClick={() => engine.current?.resetView()}>
            <MaximizeIcon />
          </Button>
        </div>
        <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-muted-foreground">Arrastra para mover · rueda para acercar · clic en un nodo para ver sus conexiones</p>
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto text-sm">
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            if (found[0]) engine.current?.focus(found[0]);
          }}
          className="relative"
        >
          <SearchIcon className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            value={q}
            placeholder="Buscar nodo o fichero…"
            aria-label="Buscar en el grafo"
            onChange={(ev) => {
              setQ(ev.target.value);
              setFound(engine.current?.search(ev.target.value) ?? []);
            }}
          />
          {q.trim() && <p className="mt-1 text-xs text-muted-foreground">{found.length ? `${found.length} resultados · Intro para ir al primero` : "Sin resultados"}</p>}
        </form>

        {node ? (
          <div className="rounded-md border p-3">
            <p className="flex items-center gap-2 font-medium">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: colorOf(node.community) }} />
              <span className="break-all">{node.label}</span>
            </p>
            {node.file && <p className="mt-1 font-mono text-xs break-all text-muted-foreground">{node.file}</p>}
            <p className="mt-1 text-xs text-muted-foreground">{node.degree} conexiones · comunidad «{data.communities[node.community]?.name ?? node.community}»</p>
            {neighbors.length > 0 && (
              <ul className="mt-2 flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                {neighbors.map((n) => (
                  <li key={n.id}>
                    <button type="button" className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-secondary" onClick={() => engine.current?.focus(n.id)}>
                      <ZoomInIcon className="size-3 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{n.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">Elige un nodo para ver de qué fichero es y con qué se conecta.</p>
        )}

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Comunidades</p>
          <ul className="flex flex-col gap-1">
            {data.communities.slice(0, 12).map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-xs">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: colorOf(c.id) }} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="text-muted-foreground tabular-nums">{c.size}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
