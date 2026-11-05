"use client";

import * as React from "react";
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "motion/react";
import { useApi } from "@/lib/api";
import type { IslandRun, IslandSnapshot } from "@/lib/server/island";
import type { OrbState } from "@/lib/orb-state";
import { formatElapsed } from "@/lib/live-stats";
import { cn } from "@/lib/utils";
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
  mainVisible(): Promise<boolean | null>;
  onMainVisible(cb: (v: boolean) => void): () => void;
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

/** The natural width of an element, kept up to date as its text changes (a ResizeObserver callback, not an effect body). */
function useWidth<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [w, setW] = React.useState(0);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.ceil(el.getBoundingClientRect().width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Rounded up to a multiple of 8 px, so a ticking clock does not make the pill tremble. */
const q8 = (n: number) => Math.ceil(n / 8) * 8;
const MAX_W = 520;

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
  // The island only shows while the main window is not on screen (minimized, hidden, closed, another Space, covered).
  // Until we know, assume it is on screen: nothing pops up by mistake.
  const [mainVisible, setMainVisible] = React.useState(true);

  React.useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    void bridge?.metrics().then(setMetrics);
    void bridge?.mainVisible().then((v) => setMainVisible(v !== false));
    return bridge?.onMainVisible((v) => {
      setMainVisible(v);
      if (v) setAlert(null); // opening the app takes the notice away
    });
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
    // With the app in view you do not need the notice: it is marked as seen and not shown later.
    if (island.enabled && island.alerts && !mainVisible) setAlert(fresh);
  }, [snap, island.enabled, island.alerts, mainVisible]);

  React.useEffect(() => {
    if (!alert) return;
    const t = setTimeout(() => setAlert(null), ALERT_MS[alert.state] ?? 8000);
    return () => clearTimeout(t);
  }, [alert]);

  const running = island.enabled && island.working && !mainVisible ? (snap?.running ?? []) : [];
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
  const open = mode === "alert";
  const hidden = mode === "hidden";
  // After the last thing ends, its content stays while the pill folds away.
  const live = alert ?? main;
  const [last, setLast] = React.useState<IslandRun | undefined>(live);
  if (live && live !== last) setLast(live);
  const shown = live ?? last;
  const elapsed = main ? formatElapsed(now - Date.parse(main.startedAt)) : "";
  const label = shown ? SHORT[shown.state] ?? "Trabajando" : "";
  const count = running.length > 1 ? ` ·${running.length}` : "";
  // Around a notch the orb and the project go on its left and the step and clock on its right; without a notch, one row.
  const leftText = metrics.notch ? (shown && shown.project.length > 18 ? `${shown.project.slice(0, 17)}…` : (shown?.project ?? "")) : label;
  const rightText = metrics.notch ? `${label} · ${elapsed}${count}` : `${elapsed}${count}`;
  const alertTitle = alert?.state === "waiting" ? "Claude te espera" : alert?.state === "error" ? "Ha fallado" : "Claude ha terminado";
  const alertSub = alert ? `${alert.project ? `${alert.project} · ` : ""}${alert.title}` : "";
  const [lRef, lW] = useWidth<HTMLSpanElement>();
  const [rRef, rW] = useWidth<HTMLSpanElement>();
  const [tRef, tW] = useWidth<HTMLSpanElement>();
  const [sRef, sW] = useWidth<HTMLSpanElement>();
  const orbW = Math.min(22, bar - 8);
  const padClosed = 7 + 12; // shoulder + breathing room
  const leftNat = orbW + (leftText ? 8 + lW : 0);
  // The pill grows with what it has to say (never narrower than the notch plus a little on each side).
  const workW = metrics.notch
    ? Math.min(MAX_W, Math.max(metrics.notchWidth + 2 * 64, q8(metrics.notchWidth + 2 * (padClosed + Math.max(leftNat, rW)))))
    : Math.min(MAX_W, Math.max(170, q8(2 * padClosed + leftNat + 16 + rW)));
  const alertW = Math.min(MAX_W, Math.max(340, q8(Math.max(tW, sW, 170) + 2 * (14 + 12 + 4))));
  // Closed it is the notch (small shoulders, bottom radius ~12); open it is the island card (bigger radii).
  // Hovering it makes the pill swell a little (as the notch apps do); pressing it squeezes it back.
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const swell = hover && !hidden ? (press ? -4 : 1) : 0;
  const target = hidden
    ? { w: Math.round(workW * 0.55), h: Math.round(bar * 0.55), tr: 4, br: 8, o: 0 }
    : open
      ? { w: alertW + swell * 8, h: bar + 88 + swell * 2, tr: 14, br: 26, o: 1 }
      : { w: workW + swell * 16, h: bar + swell * 5, tr: 7 + swell, br: 12 + swell * 3, o: 1 };
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
  const inset = target.tr + 12; // content sits inside the shoulders

  return (
    <div className="pointer-events-none flex h-screen w-screen items-start justify-center overflow-hidden select-none">
      {/* Invisible copies of the texts: their width is what the pill grows to. */}
      <div aria-hidden className="invisible fixed top-0 left-0 -z-10 whitespace-nowrap">
        <span ref={lRef} className="inline-block text-[11px] font-medium">{leftText}</span>
        <span ref={rRef} className="inline-block text-[11px] font-medium tabular-nums">{rightText}</span>
        <span ref={tRef} className="inline-block text-[13px] font-semibold">{alertTitle}</span>
        <span ref={sRef} className="inline-block text-xs">{alertSub}</span>
      </div>
      {/* Closed, the pill must melt into the physical notch (pure black, no halo); only the open card casts a shadow. */}
      <div style={{ filter: open ? "drop-shadow(0 8px 14px rgba(0,0,0,0.5))" : "none", transition: "filter 0.3s ease" }}>
        {shown && (
          <motion.div
            className="pointer-events-auto relative overflow-hidden text-white"
            // Exactly #000000, like the notch itself: any other black would show as a seam against it.
            style={{ width: w, height: h, clipPath: clip, opacity, backgroundColor: "#000000" }}
            onMouseEnter={() => {
              bridge?.interactive(true);
              setHover(true);
            }}
            onMouseLeave={() => {
              bridge?.interactive(false);
              setHover(false);
              setPress(false);
            }}
            onMouseDown={() => setPress(true)}
            onMouseUp={() => setPress(false)}
            // While Claude works, a click on the pill opens that run in the app.
            onClick={() => mode === "work" && shown && bridge?.open(shown.href)}
          >
            <motion.div
              className={cn("flex items-center justify-between gap-4", mode === "work" && "cursor-pointer")}
              style={{ height: bar, paddingInline: inset }}
              initial={false}
              animate={{ opacity: hidden ? 0 : 1, y: hidden ? -3 : 0 }}
              transition={{ duration: hidden ? 0.15 : 0.28, delay: hidden ? 0 : 0.1 }}
            >
              <span className="flex min-w-0 items-center gap-2">
                <LiquidOrb state={shown.state} size={orbW} />
                {mode === "work" && leftText && <span className="truncate text-[11px] font-medium whitespace-nowrap text-white/85">{leftText}</span>}
              </span>
              {mode === "work" && <span className="text-[11px] font-medium whitespace-nowrap tabular-nums text-white/70">{rightText}</span>}
            </motion.div>
            <AnimatePresence>
              {mode === "alert" && alert && (
                <motion.div
                  key="alert"
                  className="pb-3" style={{ paddingInline: inset + 4 }}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: 0.12 } }}
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                >
                  <div className="truncate text-[13px] font-semibold">{alertTitle}</div>
                  <div className="mt-0.5 truncate text-xs text-white/60">{alertSub}</div>
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
