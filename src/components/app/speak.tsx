"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AudioLinesIcon, MicIcon, MicOffIcon, SquareIcon, Volume2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api";
import { resolveLang } from "@/lib/voice/engine";
import { speaker, streamSentences, type SpeakOptions } from "@/lib/voice/speak";
import type { Activity, OrbState } from "@/lib/orb-state";
import { cn } from "@/lib/utils";
import { MorphText } from "./live-status";
import { LiquidOrb } from "./liquid-orb";
import { DEFAULT_VOICE, useVoice, type VoicePrefs } from "./voice";

export const useSpeaker = () => {
  const st = React.useSyncExternalStore(speaker.subscribe, speaker.getSnapshot, speaker.getSnapshot);
  const available = React.useSyncExternalStore(
    () => () => {},
    () => speaker.available(),
    () => false,
  );
  React.useEffect(() => {
    void speaker.loadNative();
  }, []);
  return { ...st, available };
};

/** Language, voice and speed to read with (the settings of Ajustes → Voz). */
export function useSpeakOptions(): Omit<SpeakOptions, "id" | "onEnd"> {
  const { data } = useApi<{ voice?: Partial<VoicePrefs> }>("/api/prefs", { revalidateOnFocus: false });
  const p = { ...DEFAULT_VOICE, ...(data?.voice ?? {}) };
  return { lang: resolveLang(p.lang), voiceURI: p.voiceURI, rate: p.rate };
}

/** Under an answer: read it aloud (or stop reading it). */
export function ReadAloudButton({ text, className }: { text: string; className?: string }) {
  const id = React.useId();
  const sp = useSpeaker();
  const opts = useSpeakOptions();
  if (!sp.available || !text.trim()) return null;
  const mine = sp.speaking && sp.id === id;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn("size-7 rounded-full text-muted-foreground", mine && "bg-accent text-foreground", className)}
      aria-label={mine ? "Parar la lectura" : "Leer en voz alta"}
      title={mine ? "Parar la lectura (Esc)" : "Leer en voz alta"}
      onClick={() => (mine ? speaker.stop() : speaker.speak(text, { ...opts, id }))}
    >
      {mine ? <SquareIcon className="size-3.5" /> : <Volume2Icon className="size-3.5" />}
    </Button>
  );
}

/** Talk mode: Claude's answers are read aloud, and then it listens to you again. */
export function VoiceModeButton({ className }: { className?: string }) {
  const sp = useSpeaker();
  const v = useVoice();
  if (!sp.available || v.available === false) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn("rounded-full", sp.voiceMode && "bg-accent text-foreground", className)}
      aria-label="Modo voz"
      aria-pressed={sp.voiceMode}
      title={sp.voiceMode ? "Modo voz activado: Claude te responde hablando y te escucha después" : "Modo voz: Claude te responde hablando y te escucha después"}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => speaker.setVoiceMode(!sp.voiceMode)}
    >
      <AudioLinesIcon />
    </Button>
  );
}

/**
 * In talk mode the answer is read as it is written, like Claude Desktop: each finished sentence is spoken while the next
 * ones are still being produced, instead of waiting for the whole answer.
 */
export function VoiceLoop({ running, answer, fallback }: { running: boolean; answer: string; fallback: string }) {
  const v = useVoice();
  const opts = useSpeakOptions();
  const vRef = React.useRef(v);
  const optsRef = React.useRef(opts);
  const fallbackRef = React.useRef(fallback);
  React.useEffect(() => {
    vRef.current = v;
    optsRef.current = opts;
    fallbackRef.current = fallback;
  });
  const reading = React.useRef({ on: false, said: 0, text: "" });
  const was = React.useRef(running);

  React.useEffect(() => {
    const r = reading.current;
    const finished = was.current && !running;
    was.current = running;
    if (!speaker.state.voiceMode) {
      r.on = false;
      return;
    }
    if (running) r.text = answer || r.text;
    if (!running && !finished) return;
    const text = finished ? r.text || fallbackRef.current : answer;
    const sentences = streamSentences(text, finished);
    if (!r.on && sentences.length) {
      if (!speaker.begin({ ...optsRef.current, id: "reply" })) return;
      r.on = true;
      r.said = 0;
    }
    if (r.on && sentences.length > r.said) {
      speaker.push(sentences.slice(r.said).join(" "));
      r.said = sentences.length;
    }
    if (finished) {
      if (!r.on && text.trim() && speaker.begin({ ...optsRef.current, id: "reply" })) {
        r.on = true;
        speaker.push(text);
      }
      if (r.on) speaker.end();
      r.on = false;
      r.said = 0;
      r.text = "";
    }
  }, [running, answer]);

  // Leaving the page silences it and ends talk mode (the microphone is never left open behind your back).
  React.useEffect(
    () => () => {
      speaker.setVoiceMode(false);
      vRef.current.cancel();
    },
    [],
  );
  return null;
}

/** A value that changes only after it has held for a moment: the orb never flickers between states. */
function useSettled<T>(value: T, ms: number): T {
  const [shown, setShown] = React.useState(value);
  React.useEffect(() => {
    if (value === shown) return;
    const t = setTimeout(() => setShown(value), ms);
    return () => clearTimeout(t);
  }, [value, shown, ms]);
  return shown;
}

/**
 * Talk mode, on its own: the message box goes away and only the voice stays. The orb (as it is, untouched) swells with
 * your voice while you speak and with Claude's while it answers; under it, the words being said. It listens again by
 * itself after each answer.
 */
export function VoiceStage({ activity, busy }: { activity: Activity | null | undefined; busy: boolean }) {
  const v = useVoice();
  const sp = useSpeaker();
  const reduce = useReducedMotion();
  const [paused, setPaused] = React.useState(false);
  const vRef = React.useRef(v);
  const spRef = React.useRef(sp);
  React.useEffect(() => {
    vRef.current = v;
    spRef.current = sp;
  });

  // Listens (again) whenever nothing else is going on: it is not waiting for an answer, not talking, not paused.
  React.useEffect(() => {
    if (paused || v.phase !== "idle" || sp.speaking || busy || v.available !== true) return;
    const t = setTimeout(() => vRef.current.toggle(), 700);
    return () => clearTimeout(t);
  }, [paused, v.phase, v.available, sp.speaking, busy]);

  const exit = React.useCallback(() => {
    speaker.setVoiceMode(false);
    vRef.current.cancel();
  }, []);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && vRef.current.phase === "idle" && !spRef.current.speaking) exit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exit]);

  // The orb swells with the voice (a wrapper around it: the orb itself is not touched).
  const wrap = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (reduce) return;
    let raf = 0;
    let cur = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const cv = vRef.current;
      const target = spRef.current.speaking ? speaker.level.get() : cv.phase === "listening" ? cv.level.get() : 0;
      cur += (target - cur) * 0.22;
      if (wrap.current) wrap.current.style.transform = `scale(${1 + Math.min(1, cur) * 0.3})`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);

  // The orb's own states: blue and alive while it listens, violet while Claude thinks, coral while Claude speaks.
  const target: OrbState = sp.speaking ? "writing" : busy ? (activity?.state ?? "thinking") : paused ? "idle" : v.phase === "listening" ? "reading" : v.phase !== "idle" ? "thinking" : "idle";
  const orb = useSettled(target, 650);
  const status = paused
    ? "En pausa"
    : sp.speaking
      ? "Hablando…"
      : busy
        ? (activity?.label ?? "Pensando…")
        : v.available === false
          ? (v.reason ?? "El dictado no está disponible aquí")
          : v.phase === "starting"
            ? "Activando el micrófono…"
            : v.phase === "listening"
              ? "Te escucho…"
              : v.phase === "finishing"
                ? "Un momento…"
                : "Preparando…";
  const caption = sp.speaking ? sp.caption : v.phase !== "idle" ? v.text : "";

  return (
    <motion.div
      data-testid="voice-stage"
      role="dialog"
      aria-label="Modo voz"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 0.8, 0.3, 1] }}
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-7 bg-background/95 px-6 backdrop-blur-xl"
    >
      <Button type="button" variant="ghost" size="icon" className="absolute top-4 right-4 rounded-full" aria-label="Salir del modo voz" title="Salir del modo voz (Esc)" onClick={exit}>
        <XIcon />
      </Button>
      <button
        type="button"
        aria-label="Terminar de hablar"
        title={v.phase === "listening" ? "Toca para enviar lo que has dicho" : undefined}
        disabled={v.phase !== "listening"}
        onClick={() => vRef.current.finish()}
        className="cursor-pointer rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default"
      >
        <div ref={wrap} className="will-change-transform" style={{ transition: reduce ? undefined : "none" }}>
          <LiquidOrb state={orb} size={200} />
        </div>
      </button>
      <div data-testid="voice-stage-status" role="status" aria-live="polite" className="flex max-w-full justify-center">
        <MorphText text={status} state={orb} glow={!["idle", "waiting", "done", "error"].includes(orb)} className="text-base font-medium" />
      </div>
      <div data-testid="voice-stage-caption" className="flex min-h-[5.5rem] max-w-xl justify-center text-center text-xl leading-snug">
        {sp.speaking ? (
          // Each sentence Claude says morphs into the next one.
          <MorphText text={caption} state="writing" glow={false} wrap className="text-xl leading-snug text-foreground/85" />
        ) : (
          <p className="line-clamp-4 text-foreground/85">{caption}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className={cn("rounded-full", paused && "bg-accent")}
          aria-label={paused ? "Reanudar el micrófono" : "Pausar el micrófono"}
          aria-pressed={paused}
          onClick={() => {
            if (!paused) vRef.current.cancel();
            setPaused(!paused);
          }}
        >
          {paused ? <MicOffIcon /> : <MicIcon />} {paused ? "Reanudar" : "Pausar"}
        </Button>
        {sp.speaking && (
          <Button type="button" variant="outline" size="lg" className="rounded-full" aria-label="Callar a Claude" onClick={() => speaker.stop()}>
            <SquareIcon /> Callar
          </Button>
        )}
      </div>
    </motion.div>
  );
}

export { AnimatePresence };
