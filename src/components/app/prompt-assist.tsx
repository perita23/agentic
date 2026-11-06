"use client";

import * as React from "react";
import { CheckIcon, SparklesIcon, Undo2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, useApi } from "@/lib/api";
import { wordAssist, type Morph } from "@/lib/word-assist";
import { replaceAll } from "@/lib/voice/insert";
import { errorMessage } from "./common";
import { MorphText } from "./live-status";
import { LiquidOrb } from "./liquid-orb";

type Field = HTMLTextAreaElement | HTMLInputElement;
interface Settings {
  enabled: boolean;
  model: string;
  autocorrect: "off" | "words" | "suggest" | "auto";
}
type Chip = { kind: "suggest"; forText: string; corrected: string } | { kind: "applied"; forText: string; original: string };


const PAUSE_MS = 900;
const MIN_CHARS = 12;
const MAX_CHARS = 3000;

/**
 * The local model (Ollama) at the message box: it corrects what you write when you pause (suggesting, or applying it
 * so that Ctrl+Z undoes it), and rewrites the whole prompt when you ask.
 */
export function usePromptAssist(text: string, getField: () => Field | null) {
  const { data } = useApi<{ settings: Settings }>("/api/ollama?probe=0", { revalidateOnFocus: false });
  const s = data?.settings;
  const ready = !!s?.enabled && !!s.model;
  const mode = ready ? s.autocorrect : "off";
  const phrase = mode === "suggest" || mode === "auto";
  const [chip, setChip] = React.useState<Chip | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [fresh, setFresh] = React.useState(false); // the improved text has just come in
  const wrote = React.useRef<string | null>(null); // what this wrote itself: it is not corrected again
  const req = React.useRef(0);
  const getRef = React.useRef(getField);
  React.useEffect(() => {
    getRef.current = getField;
  });

  React.useEffect(() => {
    if (!phrase || text === wrote.current) return;
    const t = text.trim();
    if (t.length < MIN_CHARS || t.length > MAX_CHARS || t.startsWith("/")) return;
    const id = ++req.current;
    const timer = setTimeout(async () => {
      try {
        const r = await api<{ text: string; changed: boolean }>("POST", "/api/ollama/correct", { text });
        const f = getRef.current();
        if (id !== req.current || !r.changed || !f || f.value !== text) return; // you kept typing: that answer is stale
        const atEnd = document.activeElement === f && f.selectionStart === text.length;
        if (mode === "auto" && atEnd) {
          wrote.current = r.text;
          replaceAll(f, r.text);
          setChip({ kind: "applied", forText: r.text, original: text });
        } else setChip({ kind: "suggest", forText: text, corrected: r.text });
      } catch {
        // Typing is never interrupted by a model that is not there: the settings page says what is wrong.
      }
    }, PAUSE_MS);
    return () => clearTimeout(timer);
  }, [text, mode, phrase]);


  // ---- Word by word: every word you finish is checked; a wrong one is fixed on the spot, morphing (see lib/word-assist).
  const [morphs, setMorphs] = React.useState<Morph[]>([]);
  React.useEffect(() => {
    return wordAssist.onMorph((f, m) => {
      if (f !== getRef.current()) return;
      setMorphs((l) => [...l, m]);
      setTimeout(() => setMorphs((l) => l.filter((x) => x.id !== m.id)), 1500);
    });
  }, []);
  React.useEffect(() => {
    // This box is looked after here, not by the app-wide corrector.
    const f = getRef.current();
    if (f) f.dataset.assist = "own";
  });
  React.useEffect(() => {
    if (mode !== "words") return;
    const f = getRef.current();
    if (f && f.value === text) wordAssist.schedule(f);
  }, [text, mode]);

  const shown = chip && chip.kind === "suggest" ? (text === chip.forText ? chip : null) : chip && text === chip.forText ? chip : null;

  const apply = () => {
    const f = getRef.current();
    if (!f || !shown || shown.kind !== "suggest") return;
    wrote.current = shown.corrected;
    replaceAll(f, shown.corrected);
    setChip({ kind: "applied", forText: shown.corrected, original: shown.forText });
  };
  const undo = () => {
    const f = getRef.current();
    if (!f || !shown || shown.kind !== "applied") return;
    wrote.current = shown.original;
    replaceAll(f, shown.original);
    setChip(null);
  };
  const improve = async () => {
    const f = getRef.current();
    if (!f || busy || !f.value.trim()) return toast.message("Escribe primero lo que quieres pedirle a Claude");
    const original = f.value;
    setBusy(true);
    try {
      const r = await api<{ text: string }>("POST", "/api/ollama/improve", { text: original });
      if (getRef.current()?.value !== original) return toast.message("Has cambiado el texto mientras se mejoraba: lo dejo como está");
      wrote.current = r.text;
      replaceAll(f, r.text);
      setChip({ kind: "applied", forText: r.text, original });
      setFresh(true);
      setTimeout(() => setFresh(false), 1000);
    } catch (e) {
      toast.error("No se pudo mejorar el prompt", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return { ready, busy, fresh, chip: shown, apply, undo, improve, morphs };
}

type Assist = ReturnType<typeof usePromptAssist>;

/** «Mejorar prompt»: rewrites and organises what is written. */
export function ImproveButton({ a, className }: { a: Assist; className?: string }) {
  if (!a.ready) return null;
  return (
    <Button type="button" variant="ghost" size="sm" className={className ?? "h-7 gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground"} aria-label="Mejorar prompt" title="Mejorar y organizar el prompt con el modelo local" disabled={a.busy} onMouseDown={(e) => e.preventDefault()} onClick={() => void a.improve()}>
      {a.busy ? <LiquidOrb state="thinking" size={16} /> : <SparklesIcon />}
      {a.busy ? <span className="orb-text" data-state="thinking">Mejorando…</span> : "Mejorar"}
    </Button>
  );
}

/** The correction: a suggestion to accept, or what was applied (with its undo). */
export function AssistChip({ a }: { a: Assist }) {
  const c = a.chip;
  // Markers the box's CSS reacts to (see globals.css): the shimmer while it works, the soft entrance of the new text.
  const markers = (
    <>
      {a.busy && <span data-improving hidden />}
      {a.fresh && <span data-improved hidden />}
    </>
  );
  if (!c) return markers;
  return (
    <>
      {markers}
      <AssistChipBody a={a} c={c} />
    </>
  );
}

function AssistChipBody({ a, c }: { a: Assist; c: Chip }) {
  return (
    <div data-testid="assist-chip" role="status" className="flex min-w-0 items-center gap-2 px-4 pb-1 text-xs text-muted-foreground">
      {c.kind === "suggest" ? (
        <>
          <SparklesIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={c.corrected}>
            Sugerencia: {c.corrected}
          </span>
          <button type="button" className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-accent" onMouseDown={(e) => e.preventDefault()} onClick={a.apply}>
            Aplicar
          </button>
        </>
      ) : (
        <>
          <CheckIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Mejorado con el modelo local</span>
          <button type="button" className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-accent" onMouseDown={(e) => e.preventDefault()} onClick={a.undo}>
            <Undo2Icon className="size-3" /> Deshacer
          </button>
        </>
      )}
    </div>
  );
}

/** A fixed word is shown morphing, right where it is: the old one blurs out into the new one in the orb's colours. */
export function MorphPill({ m }: { m: Morph }) {
  const [text, setText] = React.useState(m.from);
  const [fading, setFading] = React.useState(false);
  React.useEffect(() => {
    const a = setTimeout(() => setText(m.to), 60);
    const b = setTimeout(() => setFading(true), 1000);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [m.to]);
  return (
    <span
      data-testid="word-morph"
      aria-hidden
      className="pointer-events-none fixed z-[90] flex items-center rounded-[3px] transition-opacity duration-500"
      style={{ left: m.left - 2, top: m.top, minWidth: m.width + 4, height: m.height, padding: "0 2px", background: m.bg, opacity: fading ? 0 : 1, ...m.font }}
    >
      <MorphText text={text} state="writing" glow className="" />
    </span>
  );
}

export function WordMorphs({ a }: { a: Assist }) {
  return (
    <>
      {a.morphs.map((m) => (
        <MorphPill key={m.id} m={m} />
      ))}
    </>
  );
}
