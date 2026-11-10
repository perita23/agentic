/**
 * A small force-directed graph on a canvas, drawn in Agentic's style (soft glowing blobs in Morphy's colours). No libraries:
 * a few hundred nodes need repulsion between all pairs, springs on the links, a pull towards the community and a pull to the centre.
 */
export interface GNode {
  id: string;
  label: string;
  file: string;
  community: number;
  degree: number;
}
export interface GLink {
  source: string;
  target: string;
  relation: string;
  inferred: boolean;
}

export const PALETTE = ["#8b6cf5", "#ff8a5b", "#5aa9ff", "#34d399", "#ff6fa0", "#fbbf24", "#22d3ee", "#a78bfa"];
export const colorOf = (community: number) => PALETTE[community % PALETTE.length]!;

interface Sim extends GNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  fixed: boolean;
}
interface Edge {
  a: Sim;
  b: Sim;
  inferred: boolean;
}

export interface GraphEvents {
  onSelect?: (id: string | null) => void;
  onHover?: (id: string | null, x: number, y: number) => void;
}

export class GraphEngine {
  private ctx: CanvasRenderingContext2D;
  private nodes: Sim[] = [];
  private edges: Edge[] = [];
  private byId = new Map<string, Sim>();
  private neighbors = new Map<string, Set<string>>();
  private centers = new Map<number, { x: number; y: number; n: number }>();
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private alpha = 1;
  private raf = 0;
  private selected: string | null = null;
  private hover: string | null = null;
  private matches: Set<string> | null = null;
  private drag: { node: Sim | null; px: number; py: number; moved: boolean } | null = null;
  private fg = "#ffffff";
  private disposers: (() => void)[] = [];
  private reduce: boolean;
  /** Until the person pans or zooms, the view keeps fitting the graph while it settles. */
  private userMoved = false;
  private frames = 0;
  private settled = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private ev: GraphEvents = {},
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const on = (t: HTMLElement | Window, k: string, f: (e: never) => void, o?: AddEventListenerOptions) => {
      t.addEventListener(k, f as EventListener, o);
      this.disposers.push(() => t.removeEventListener(k, f as EventListener));
    };
    on(canvas, "pointerdown", (e: PointerEvent) => this.down(e));
    on(canvas, "pointermove", (e: PointerEvent) => this.move(e));
    on(canvas, "pointerup", (e: PointerEvent) => this.up(e));
    on(canvas, "pointerleave", () => this.leave());
    on(canvas, "wheel", (e: WheelEvent) => this.wheel(e), { passive: false });
    this.resize();
  }

  setData(nodes: GNode[], links: GLink[]) {
    const n = nodes.length;
    this.nodes = nodes.map((g, i) => {
      const a = (i / Math.max(1, n)) * Math.PI * 2 * 7;
      const rad = 30 + Math.sqrt(i) * 16;
      return { ...g, x: Math.cos(a) * rad, y: Math.sin(a) * rad, vx: 0, vy: 0, r: 4 + Math.sqrt(g.degree) * 2.1, fixed: false };
    });
    this.byId = new Map(this.nodes.map((s) => [s.id, s]));
    this.edges = links.flatMap((l) => {
      const a = this.byId.get(l.source);
      const b = this.byId.get(l.target);
      return a && b ? [{ a, b, inferred: l.inferred }] : [];
    });
    this.neighbors = new Map(this.nodes.map((s) => [s.id, new Set<string>()]));
    for (const e of this.edges) {
      this.neighbors.get(e.a.id)!.add(e.b.id);
      this.neighbors.get(e.b.id)!.add(e.a.id);
    }
    this.selected = this.hover = null;
    this.matches = null;
    this.alpha = 1;
    this.settled = false;
    if (this.reduce) {
      for (let i = 0; i < 320; i++) this.tick();
      this.alpha = 0;
    }
    this.resetView();
    this.kick();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(50, r.width);
    this.h = Math.max(50, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.fg = getComputedStyle(this.canvas).color || "#fff";
    this.kick();
  }

  resetView() {
    this.userMoved = false;
    if (!this.nodes.length) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const s of this.nodes) {
      minX = Math.min(minX, s.x - s.r);
      maxX = Math.max(maxX, s.x + s.r);
      minY = Math.min(minY, s.y - s.r);
      maxY = Math.max(maxY, s.y + s.r);
    }
    const k = Math.min(this.w / Math.max(80, maxX - minX + 80), this.h / Math.max(80, maxY - minY + 80), 1.6);
    this.scale = k;
    this.tx = this.w / 2 - ((minX + maxX) / 2) * k;
    this.ty = this.h / 2 - ((minY + maxY) / 2) * k;
    this.kick();
  }

  select(id: string | null) {
    this.selected = id && this.byId.has(id) ? id : null;
    this.ev.onSelect?.(this.selected);
    this.kick();
  }

  focus(id: string) {
    const s = this.byId.get(id);
    if (!s) return;
    this.userMoved = true;
    this.scale = Math.max(this.scale, 1.2);
    this.tx = this.w / 2 - s.x * this.scale;
    this.ty = this.h / 2 - s.y * this.scale;
    this.select(id);
  }

  /** Highlights the nodes whose label or file contain the text; returns their ids (best connected first). */
  search(q: string): string[] {
    const t = q.trim().toLowerCase();
    if (!t) {
      this.matches = null;
      this.kick();
      return [];
    }
    const hit = this.nodes.filter((s) => s.label.toLowerCase().includes(t) || s.file.toLowerCase().includes(t)).sort((a, b) => b.degree - a.degree);
    this.matches = new Set(hit.map((s) => s.id));
    this.kick();
    return hit.map((s) => s.id);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    for (const d of this.disposers) d();
    this.disposers = [];
  }

  // ---- physics

  private tick() {
    const ns = this.nodes;
    const a = this.alpha;
    // community centres
    this.centers.clear();
    for (const s of ns) {
      const c = this.centers.get(s.community) ?? { x: 0, y: 0, n: 0 };
      c.x += s.x;
      c.y += s.y;
      c.n++;
      this.centers.set(s.community, c);
    }
    for (let i = 0; i < ns.length; i++) {
      const p = ns[i]!;
      for (let j = i + 1; j < ns.length; j++) {
        const q = ns[j]!;
        let dx = p.x - q.x;
        let dy = p.y - q.y;
        let d2 = dx * dx + dy * dy;
        if (d2 > 90_000) continue;
        if (d2 < 1) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 1;
        }
        const d = Math.sqrt(d2);
        const f = ((p.r + q.r + 26) * 26 * a) / d2;
        dx = (dx / d) * f;
        dy = (dy / d) * f;
        p.vx += dx;
        p.vy += dy;
        q.vx -= dx;
        q.vy -= dy;
      }
    }
    for (const e of this.edges) {
      const dx = e.b.x - e.a.x;
      const dy = e.b.y - e.a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = 38 + e.a.r + e.b.r;
      const f = ((d - rest) / d) * 0.05 * a;
      e.a.vx += dx * f;
      e.a.vy += dy * f;
      e.b.vx -= dx * f;
      e.b.vy -= dy * f;
    }
    for (const s of ns) {
      const c = this.centers.get(s.community)!;
      s.vx += (c.x / c.n - s.x) * 0.012 * a - s.x * 0.003 * a;
      s.vy += (c.y / c.n - s.y) * 0.012 * a - s.y * 0.003 * a;
      if (s.fixed) {
        s.vx = s.vy = 0;
        continue;
      }
      s.vx *= 0.82;
      s.vy *= 0.82;
      s.x += s.vx;
      s.y += s.vy;
    }
    this.alpha = Math.max(0, a * 0.985 - 0.0008);
  }

  private kick() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.alpha > 0.002) {
        this.tick();
        this.tick();
      }
      if (!this.userMoved && (++this.frames % 12 === 0 || (this.alpha <= 0.002 && !this.settled))) this.resetView();
      if (this.alpha <= 0.002) this.settled = true;
      this.draw();
      if (this.alpha > 0.002 || this.drag) this.kick();
    });
  }

  // ---- drawing

  private draw() {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    c.translate(this.tx, this.ty);
    c.scale(this.scale, this.scale);
    const focus = this.selected ?? this.hover;
    const near = focus ? this.neighbors.get(focus) : null;
    const lit = (id: string) => (this.matches ? this.matches.has(id) : focus ? id === focus || !!near?.has(id) : true);
    c.lineCap = "round";
    for (const e of this.edges) {
      const on = focus ? e.a.id === focus || e.b.id === focus : this.matches ? this.matches.has(e.a.id) && this.matches.has(e.b.id) : false;
      const dim = (focus || this.matches) && !on;
      c.globalAlpha = on ? 0.85 : dim ? 0.04 : 0.16;
      c.strokeStyle = on ? colorOf(e.a.community) : this.fg;
      c.lineWidth = (on ? 1.6 : 0.9) / Math.sqrt(this.scale);
      c.setLineDash(e.inferred ? [4 / this.scale, 4 / this.scale] : []);
      c.beginPath();
      c.moveTo(e.a.x, e.a.y);
      c.lineTo(e.b.x, e.b.y);
      c.stroke();
    }
    c.setLineDash([]);
    for (const s of this.nodes) {
      const a = lit(s.id) ? 1 : 0.14;
      const col = colorOf(s.community);
      c.globalAlpha = a * 0.28;
      const glow = c.createRadialGradient(s.x, s.y, s.r * 0.6, s.x, s.y, s.r * 2.3);
      glow.addColorStop(0, col);
      glow.addColorStop(1, "transparent");
      c.fillStyle = glow;
      c.beginPath();
      c.arc(s.x, s.y, s.r * 2.3, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = a;
      const g = c.createRadialGradient(s.x - s.r * 0.3, s.y - s.r * 0.4, s.r * 0.1, s.x, s.y, s.r);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.35, col);
      g.addColorStop(1, col);
      c.fillStyle = g;
      c.beginPath();
      c.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      c.fill();
      if (s.id === this.selected) {
        c.globalAlpha = 1;
        c.strokeStyle = this.fg;
        c.lineWidth = 2 / this.scale;
        c.beginPath();
        c.arc(s.x, s.y, s.r + 3 / this.scale, 0, Math.PI * 2);
        c.stroke();
      }
    }
    // labels: the best connected ones (more of them as you zoom in), and whatever is selected, hovered or found
    c.globalAlpha = 1;
    c.fillStyle = this.fg;
    c.textAlign = "center";
    c.font = `${11 / this.scale}px ui-sans-serif, system-ui, sans-serif`;
    const minDeg = this.scale > 2.2 ? 0 : this.scale > 1.2 ? 3 : 8;
    for (const s of this.nodes) {
      const show = s.id === this.selected || s.id === this.hover || (this.matches?.has(s.id) ?? false) || (!focus && !this.matches && s.degree >= minDeg) || (!!near?.has(s.id) && this.scale > 0.8);
      if (!show) continue;
      c.globalAlpha = lit(s.id) ? 0.95 : 0.2;
      c.fillText(s.label.length > 28 ? `${s.label.slice(0, 27)}…` : s.label, s.x, s.y + s.r + 13 / this.scale);
    }
    c.globalAlpha = 1;
  }

  // ---- pointer

  private toWorld(e: { clientX: number; clientY: number }) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - this.tx) / this.scale, y: (e.clientY - r.top - this.ty) / this.scale, sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  private pick(x: number, y: number): Sim | null {
    let best: Sim | null = null;
    let bd = Infinity;
    for (const s of this.nodes) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= s.r + 4 / this.scale && d < bd) {
        best = s;
        bd = d;
      }
    }
    return best;
  }

  private down(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    const w = this.toWorld(e);
    this.drag = { node: this.pick(w.x, w.y), px: e.clientX, py: e.clientY, moved: false };
  }

  private move(e: PointerEvent) {
    const w = this.toWorld(e);
    const d = this.drag;
    if (d) {
      if (Math.hypot(e.clientX - d.px, e.clientY - d.py) > 3) d.moved = true;
      if (d.moved) {
        if (d.node) {
          d.node.x = w.x;
          d.node.y = w.y;
          d.node.fixed = true;
          this.alpha = Math.max(this.alpha, 0.25);
        } else {
          this.userMoved = true;
          this.tx += e.clientX - d.px;
          this.ty += e.clientY - d.py;
        }
        d.px = e.clientX;
        d.py = e.clientY;
        this.kick();
      }
      return;
    }
    const h = this.pick(w.x, w.y);
    if ((h?.id ?? null) !== this.hover) {
      this.hover = h?.id ?? null;
      this.canvas.style.cursor = h ? "pointer" : "grab";
      this.kick();
    }
    this.ev.onHover?.(this.hover, w.sx, w.sy);
  }

  private up(e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.node) d.node.fixed = false;
    if (!d.moved) this.select(d.node?.id ?? null);
    this.canvas.releasePointerCapture?.(e.pointerId);
    this.kick();
  }

  private leave() {
    if (this.hover) {
      this.hover = null;
      this.ev.onHover?.(null, 0, 0);
      this.kick();
    }
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    this.userMoved = true;
    const w = this.toWorld(e);
    const k = Math.min(6, Math.max(0.15, this.scale * Math.exp(-e.deltaY * 0.0015)));
    this.tx = w.sx - w.x * k;
    this.ty = w.sy - w.y * k;
    this.scale = k;
    this.kick();
  }
}
