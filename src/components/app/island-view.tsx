"use client";

import * as React from "react";
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "motion/react";
import { useApi } from "@/lib/api";
import type { IslandRun, IslandSnapshot } from "@/lib/server/island";
import type { OrbState } from "@/lib/orb-state";
import { formatElapsed } from "@/lib/live-stats";
import { LiquidOrb } from "./liquid-orb";

interface Metrics {
  notch: boolean;
  notchWidth: number;
  barHeight: number;
}
interface IslandBridge {
  metrics(): Promise<Metrics>;
  show(): void;
  hide(): void;
  interactive(on: boolean): void;
  open(path: string): void;
}
declare global {
  interface Window {
    agenticIsland?: IslandBridge;
  }
}

/**
 * The notch's silhouette: flat on top with small concave "shoulders" that melt into the menu bar, and rounded
 * bottom corners. Corners are drawn with cubic curves a bit fuller than a circle (control factor 0.6 instead of
 * 0.5523), which is what gives Apple's "continuous" corner instead of a plain arc.
 */
export function notchPath(w: number, h: number, tr: number, br: number): string {
  const k = 0.6;
  tr = Math.max(0, Math.min(tr, w / 4, h / 2));
  br = Math.max(0, Math.min(br, (w - 2 * tr) / 2, h - tr));
  const f = (n: number) => Math.round(n * 100) / 100;
  const c = (a: number, b: number, c2: number, d: number, x: number, y: number) => `C${f(a)} ${f(b)} ${f(c2)} ${f(d)} ${f(x)} ${f(y)}`;
  return [
    "M0 0",
    c(tr * k, 0, tr, tr - tr * k, tr, tr), // top-left shoulder (concave)
    `L${f(tr)} ${f(h - br)}`,
    c(tr, h - br + br * k, tr + br - br * k, h, tr + br, h), // bottom-left
    `L${f(w - tr - br)} ${f(h)}`,
    c(w - tr - br + br * k, h, w - tr, h - br + br * k, w - tr, h - br), // bottom-right
    `L${f(w - tr)} ${f(tr)}`,
    c(w - tr, tr - tr * k, w - tr * k, 0, w, 0), // top-right shoulder (concave)
    "Z",
  ].join("");
}

const ALERT_MS: Record<string, number> = { done: 7000, error: 10000, waiting: 14000 };
const SHORT: Partial<Record<OrbState, string>> = { thinking: "Pensando", writing: "Escribiendo", reading: "Leyendo", editing: "Editando", running: "Ejecutando", searching: "Buscando", waiting: "Te espera" };

/**
 * The island: a black pill glued to the top centre of the screen (around the notch). While Claude works it shows
 * the orb and the step; when a run ends or waits for you it opens up with the result and an "Abrir" button.
 */
export function IslandView() {
  const { data: snap } = useApi<IslandSnapshot>("/api/island", { refreshInterval: 1000, revalidateOnFocus: false });
  const { data: prefs } = useApi<{ island: { enabled: boolean; working: boolean; alerts: boolean } }>("/api/prefs", { refreshInterval: 5000, revalidateOnFocus: false });
  const bridge = typeof window !== "undefined" ? window.agenticIsland : undefined;
  const [metrics, setMetrics] = React.useState<Metrics>({ notch: false, notchWidth: 0, barHeight: 26 });
  const [alert, setAlert] = React.useState<IslandRun | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const seen = React.useRef<Set<string> | null>(null);

  React.useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    void bridge?.metrics().then(setMetrics);
  }, [bridge]);
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const island = prefs?.island ?? { enabled: true, working: true, alerts: true };
  // A run that ended while the island was not looking does not pop up: only what ends from now on.
  React.useEffect(() => {
    if (!snap) return;
    if (!seen.current) {
      seen.current = new Set(snap.recent.map((r) => r.id));
      return;
    }
    const fresh = snap.recent.find((r) => !seen.current!.has(r.id));
    if (!fresh) return;
    seen.current.add(fresh.id);
    if (island.enabled && island.alerts) setAlert(fresh);
  }, [snap, island.enabled, island.alerts]);
  React.useEffect(() => {
    if (!alert) return;
    const t = setTimeout(() => setAlert(null), ALERT_MS[alert.state] ?? 8000);
    return () => clearTimeout(t);
  }, [alert]);

  const running = island.enabled && island.working ? (snap?.running ?? []) : [];
  const main = running[running.length - 1];
  const mode: "alert" | "work" | "hidden" = alert ? "alert" : main ? "work" : "hidden";

  // The window is only on screen while there is something to show (hidden after the closing animation).
  React.useEffect(() => {
    if (mode !== "hidden") {
      bridge?.show();
      return;
    }
    const t = setTimeout(() => bridge?.hide(), 650);
    return () => clearTimeout(t);
  }, [mode, bridge]);

  const bar = Math.max(metrics.barHeight, 28);
  const sideW = 64; // each side of the notch: orb on the left, short label on the right
  const compactW = metrics.notch ? metrics.notchWidth + sideW * 2 : 232;
  const open = mode === "alert";
  const hidden = mode === "hidden";
  // Closed it is the notch (small shoulders, bottom radius ~12); open it is the island card (bigger radii).
  const target = hidden
    ? { w: Math.round(compactW * 0.55), h: Math.round(bar * 0.55), tr: 4, br: 8, o: 0 }
    : open
      ? { w: Math.max(compactW, 420), h: bar + 88, tr: 14, br: 26, o: 1 }
      : { w: compactW, h: bar, tr: 7, br: 12, o: 1 };
  const w = useMotionValue(target.w);
  const h = useMotionValue(target.h);
  const tr = useMotionValue(target.tr);
  const br = useMotionValue(target.br);
  const opacity = useMotionValue(target.o);
  React.useEffect(() => {
    const spring = { type: "spring", stiffness: 380, damping: 32, mass: 0.9 } as const;
    const runs = [animate(w, target.w, spring), animate(h, target.h, spring), animate(tr, target.tr, spring), animate(br, target.br, spring), animate(opacity, target.o, { duration: 0.25 })];
    return () => runs.forEach((r) => r.stop());
  }, [target.w, target.h, target.tr, target.br, target.o, w, h, tr, br, opacity]);
  const clip = useTransform([w, h, tr, br], ([cw, ch, ctr, cbr]: number[]) => `path('${notchPath(cw, ch, ctr, cbr)}')`);
  // After the last thing ends, its content stays while the pill folds away.
  const live = alert ?? main;
  const [last, setLast] = React.useState<IslandRun | undefined>(live);
  if (live && live !== last) setLast(live);
  const shown = live ?? last;
  const elapsed = main ? formatElapsed(now - Date.parse(main.startedAt)) : "";
  const inset = target.tr + 12; // content sits inside the shoulders

  return (
    <div className="pointer-events-none flex h-screen w-screen items-start justify-center overflow-hidden select-none">
      {/* Closed, the pill must melt into the physical notch (pure black, no halo); only the open card casts a shadow. */}
      <div style={{ filter: open ? "drop-shadow(0 8px 14px rgba(0,0,0,0.5))" : "none", transition: "filter 0.3s ease" }}>
        {shown && (
          <motion.div
            className="pointer-events-auto relative overflow-hidden text-white"
            // Exactly #000000, like the notch itself: any other black would show as a seam against it.
            style={{ width: w, height: h, clipPath: clip, opacity, backgroundColor: "#000000" }}
            onMouseEnter={() => bridge?.interactive(true)}
            onMouseLeave={() => bridge?.interactive(false)}
          >
            <div className="flex items-center justify-between" style={{ height: bar, paddingInline: inset }}>
              <LiquidOrb state={shown.state} size={Math.min(22, bar - 8)} />
              {!metrics.notch && <span className="mx-2 min-w-0 flex-1 truncate text-center text-[11px] font-medium text-white/85">{mode === "alert" ? "" : SHORT[shown.state] ?? "Trabajando"}</span>}
              <span className="min-w-0 text-[11px] font-medium tabular-nums text-white/70">
                {mode === "work" ? (metrics.notch ? SHORT[shown.state] ?? "Trabajando" : elapsed) : ""}
                {mode === "work" && running.length > 1 ? ` ·${running.length}` : ""}
              </span>
            </div>
            <AnimatePresence>
              {mode === "alert" && alert && (
                <motion.div
                  key="alert"
                  className="pb-3" style={{ paddingInline: inset + 4 }}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: 0.12 } }}
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                >
                  <div className="truncate text-[13px] font-semibold">
                    {alert.state === "waiting" ? "Claude te espera" : alert.state === "error" ? "Ha fallado" : "Claude ha terminado"}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-white/60">
                    {alert.project ? `${alert.project} · ` : ""}
                    {alert.title}
                  </div>
                  <div className="mt-2.5 flex gap-2">
                    <button type="button" onClick={() => { bridge?.open(alert.href); setAlert(null); }} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-black hover:bg-white/90">
                      Abrir
                    </button>
                    <button type="button" onClick={() => setAlert(null)} className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80 hover:bg-white/15">
                      Descartar
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </div>
  );
}
