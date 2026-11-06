"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, type MotionValue } from "motion/react";
import { MicIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api";
import { pickEngine, resolveLang, type VoiceEngine, type VoiceSession } from "@/lib/voice/engine";
import { LiveInsert, dictationTarget, insertAtCaret, isTextField, sendButtonFor, trackFocus, type TextField } from "@/lib/voice/insert";
import { voiceColor } from "@/lib/voice/palette";
import { speaker } from "@/lib/voice/speak";
import { cn } from "@/lib/utils";

export interface VoicePrefs {
  enabled: boolean;
  holdSpace: boolean;
  lang: string;
  autoSend: boolean;
  voiceURI: string;
  rate: number;
}
export const DEFAULT_VOICE: VoicePrefs = { enabled: true, holdSpace: true, lang: "auto", autoSend: false, voiceURI: "", rate: 1 };

type Phase = "idle" | "starting" | "listening" | "finishing";
interface VoiceCtx {
  phase: Phase;
  /** null while it is being found out. */
  available: boolean | null;
  reason?: string;
  engine?: "native" | "web";
  mode: "hold" | "click";
  text: string;
  level: MotionValue<number>;
  /** The message box (its `VoiceInline`) that is listening, or null when the text has no box to go to. */
  slot: string | null;
  /** The words are written live into a field (so the status line does not repeat them). */
  inField: boolean;
  toggle(): void;
  finish(): void;
  cancel(): void;
}
const NOOP: VoiceCtx = { phase: "idle", available: false, mode: "click", text: "", level: { get: () => 0 } as unknown as MotionValue<number>, slot: null, inField: false, toggle() {}, finish() {}, cancel() {} };
const Ctx = React.createContext<VoiceCtx>(NOOP);
export const useVoice = () => React.useContext(Ctx);

const HOLD_MS = 300;
const SILENCE_MS = 9000;
/** Talk mode: how long after your last word it takes your sentence as finished, and how long it waits for you to start. */
const TALK_END_MS = 1300;
const TALK_IDLE_MS = 14000;

/** The field a Space press would type into when it is empty: there, holding Space dictates instead. */
function holdTarget(): "page" | "empty-field" | null {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body) return "page";
  if (isTextField(a)) return a.value.trim() === "" ? "empty-field" : null;
  if (a.isContentEditable || a.closest("[role=dialog], [role=menu], [role=listbox]") || ["BUTTON", "A", "SELECT", "INPUT", "TEXTAREA", "SUMMARY"].includes(a.tagName)) return null;
  return "page";
}

/** Dictation for the whole app: hold Space, or press the microphone; the text goes into the field you were in. */
export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data } = useApi<{ voice?: Partial<VoicePrefs> }>("/api/prefs", { revalidateOnFocus: false });
  const prefs = React.useMemo(() => ({ ...DEFAULT_VOICE, ...(data?.voice ?? {}) }), [data]);
  const prefsRef = React.useRef(prefs);
  const [phase, setPhaseState] = React.useState<Phase>("idle");
  const phaseRef = React.useRef<Phase>("idle");
  const [mode, setMode] = React.useState<"hold" | "click">("click");
  const [text, setText] = React.useState("");
  const [slot, setSlot] = React.useState<string | null>(null);
  const textRef = React.useRef("");
  const [info, setInfo] = React.useState<{ available: boolean | null; reason?: string; engine?: "native" | "web" }>({ available: null });
  const level = useMotionValue(0);
  const engineRef = React.useRef<VoiceEngine | null>(null);
  const sessionRef = React.useRef<VoiceSession | null>(null);
  const targetRef = React.useRef<TextField | null>(null);
  const liveRef = React.useRef<LiveInsert | null>(null);
  const [inField, setInField] = React.useState(false);
  const cancelledRef = React.useRef(false);
  const wantFinish = React.useRef(false);
  const silenceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeRef = React.useRef<"hold" | "click">("click");

  React.useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };

  // Which engine can dictate here (found out once).
  React.useEffect(() => {
    let live = true;
    void pickEngine().then(({ engine, reason }) => {
      if (!live) return;
      engineRef.current = engine;
      setInfo({ available: !!engine, reason, engine: engine?.id });
    });
    return () => {
      live = false;
    };
  }, []);
  React.useEffect(() => trackFocus(), []);

  const clearTimers = () => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    if (finishTimer.current) clearTimeout(finishTimer.current);
    silenceTimer.current = finishTimer.current = null;
  };

  /** What was heard goes where it belongs: the field you were in, or a new chat when there is none. */
  const deliver = (t: string, live: LiveInsert | null) => {
    const field = live?.el.isConnected ? live.el : targetRef.current?.isConnected ? targetRef.current : dictationTarget();
    const put = (f: TextField) => {
      if (live && live.el === f) live.update(t); // already there word by word: this is the final version
      else insertAtCaret(f, t);
      if (prefsRef.current.autoSend || speaker.state.voiceMode) setTimeout(() => sendButtonFor(f)?.click(), 150);
    };
    if (field) return put(field);
    router.push("/chat");
    const t0 = Date.now();
    const timer = setInterval(() => {
      const f = document.querySelector<TextField>("textarea[aria-label='Mensaje para Claude']");
      if (f) {
        clearInterval(timer);
        put(f);
      } else if (Date.now() - t0 > 5000) clearInterval(timer);
    }, 150);
  };

  const complete = () => {
    clearTimers();
    sessionRef.current = null;
    const t = textRef.current.trim();
    const cancelled = cancelledRef.current;
    const live = liveRef.current;
    liveRef.current = null;
    setPhase("idle");
    setInField(false);
    level.set(0);
    if (cancelled || !t) live?.restore();
    else deliver(t, live);
  };

  const finish = () => {
    if (phaseRef.current === "starting") {
      wantFinish.current = true;
      return;
    }
    if (phaseRef.current !== "listening") return;
    setPhase("finishing");
    sessionRef.current?.stop();
    // A result normally follows within a moment; never wait more than a few seconds.
    finishTimer.current = setTimeout(complete, 4000);
  };

  const cancel = () => {
    if (phaseRef.current === "idle") return;
    cancelledRef.current = true;
    sessionRef.current?.cancel();
    complete();
  };

  const armSilence = (fromLevel = false) => {
    // Started with the microphone button, it stops by itself after a while of silence.
    if (modeRef.current !== "click") return;
    const talk = speaker.state.voiceMode;
    // Talk mode: once words have been heard only words count as speech (noise in the room does not hold it back).
    if (talk && fromLevel && textRef.current) return;
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = setTimeout(finish, talk ? (textRef.current ? TALK_END_MS : TALK_IDLE_MS) : SILENCE_MS);
  };

  const start = async (m: "hold" | "click") => {
    if (phaseRef.current !== "idle" || !prefsRef.current.enabled) return;
    speaker.stop(); // you talk: it falls silent
    let engine = engineRef.current;
    if (!engine) {
      const picked = await pickEngine();
      engine = engineRef.current = picked.engine;
      if (!engine) return void toast.error(picked.reason ?? "El dictado no está disponible");
    }
    cancelledRef.current = false;
    wantFinish.current = false;
    textRef.current = "";
    setText("");
    modeRef.current = m;
    setMode(m);
    targetRef.current = dictationTarget();
    liveRef.current = targetRef.current ? new LiveInsert(targetRef.current) : null;
    setInField(!!liveRef.current);
    setSlot(targetRef.current?.closest("[data-composer]")?.querySelector("[data-voice-slot]")?.getAttribute("data-voice-slot") ?? null);
    setPhase("starting");
    let smooth = 0;
    try {
      sessionRef.current = await engine.start(resolveLang(prefsRef.current.lang), {
        onText: (t) => {
          textRef.current = t;
          setText(t);
          liveRef.current?.update(t);
          armSilence();
        },
        onLevel: (v) => {
          smooth = v > smooth ? v : smooth * 0.8 + v * 0.2;
          level.set(smooth);
          if (v > 0.15) armSilence(true);
        },
        onError: (msg) => toast.error(msg),
        onEnd: complete,
      });
    } catch (e) {
      setPhase("idle");
      return void toast.error(e instanceof Error ? e.message : "No se pudo iniciar el dictado");
    }
    if (phaseRef.current === "idle") return; // it ended while starting (no permission, no microphone…)
    if (cancelledRef.current) {
      sessionRef.current.cancel();
      return;
    }
    setPhase("listening");
    armSilence();
    if (wantFinish.current) finish();
  };

  // Hold Space (when it would only type a space, or scroll): it listens while it is held.
  React.useEffect(() => {
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let holding: "page" | "empty-field" | null = null;
    let started = false;
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phaseRef.current === "idle" && speaker.state.speaking) {
        e.preventDefault();
        speaker.stop();
        return;
      }
      if (e.key === "Escape" && phaseRef.current !== "idle") {
        e.preventDefault();
        cancel();
        return;
      }
      if (e.code !== "Space" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing) return;
      const p = prefsRef.current;
      if (!p.enabled || !p.holdSpace || engineRefAvailable() === false) return;
      if (phaseRef.current !== "idle") {
        // Already listening (started with the button): Space does not type meanwhile.
        e.preventDefault();
        return;
      }
      if (e.repeat) {
        if (holding) e.preventDefault();
        return;
      }
      const t = holdTarget();
      if (!t) return;
      holding = t;
      started = false;
      engineRef.current?.warm?.(); // the helper gets ready while the key is being held down
      e.preventDefault();
      holdTimer = setTimeout(() => {
        started = true;
        void start("hold");
      }, HOLD_MS);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !holding) return;
      if (holdTimer) clearTimeout(holdTimer);
      const was = holding;
      holding = null;
      if (started) {
        if (modeRef.current === "hold") finish();
      } else if (was === "page") {
        // A short tap on the page is still the usual Space: it scrolls.
        window.scrollBy({ top: window.innerHeight * 0.85, behavior: "smooth" });
      }
    };
    const onBlur = () => {
      if (holdTimer) clearTimeout(holdTimer);
      holding = null;
      if (phaseRef.current !== "idle" && modeRef.current === "hold") cancel();
    };
    const engineRefAvailable = () => (engineRef.current ? true : info.available);
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", onBlur);
      if (holdTimer) clearTimeout(holdTimer);
    };
    // The handlers read everything through refs; they only need to know once the engine's availability is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.available]);

  const toggle = () => {
    if (phaseRef.current === "idle") void start("click");
    else finish();
  };

  const ctx = React.useMemo<VoiceCtx>(
    () => ({ phase, available: info.available, reason: info.reason, engine: info.engine, mode, text, level, slot, inField, toggle, finish, cancel }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase, info, mode, text, slot, inField],
  );

  return (
    <Ctx.Provider value={ctx}>
      {children}
      <VoiceFloating v={ctx} />
    </Ctx.Provider>
  );
}

/** Tiny bars that follow your voice, in the orb's violet, coral and blue (their own colours: the orb is never touched). */
function VoiceBars({ level, n = 16, height = 14, className }: { level: MotionValue<number>; n?: number; height?: number; className?: string }) {
  const reduce = useReducedMotion();
  const bars = React.useRef<(HTMLSpanElement | null)[]>([]);
  React.useEffect(() => {
    const hist = new Array<number>(n).fill(0);
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 40) return;
      last = now;
      hist.push(reduce ? 0.2 : level.get());
      hist.shift();
      hist.forEach((h, i) => {
        const el = bars.current[i];
        if (el) el.style.transform = `scaleY(${0.16 + Math.min(1, h) * 0.84})`;
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [level, n, reduce]);
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 items-center gap-[2px]", className)} style={{ height }}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} ref={(el) => void (bars.current[i] = el)} className="w-[2px] origin-center rounded-full" style={{ height, background: voiceColor(i / (n - 1)), transform: "scaleY(0.16)", transition: "transform 80ms linear" }} />
      ))}
    </span>
  );
}

const hint = (mode: "hold" | "click") => (mode === "hold" ? "Suelta Espacio" : "Esc");

/**
 * Listening, inside the message box itself: a quiet line with the bars and what is being said, and the box's border
 * lets a thin line of colour run along it (globals.css, `[data-composer]`). Put one in every message box.
 */
/** What is being heard, on one line that always shows the END (the newest words) and fades out on the left. */
function LiveText({ v, className }: { v: VoiceCtx; className?: string }) {
  const status = v.phase === "starting" ? "Activando el micrófono…" : v.phase === "finishing" ? "Terminando…" : "Te escucho…";
  // The words themselves are being written in the box; here only the state (or, with no box, the words).
  if (v.inField) return <span data-testid="voice-status" className={cn("min-w-0 truncate text-muted-foreground", className)}>{status}</span>;
  const empty = !v.text;
  return (
    <span
      data-testid="voice-text"
      className={cn("flex min-w-0 justify-end overflow-hidden", !empty && "[mask-image:linear-gradient(to_right,transparent,#000_2rem)]", empty ? "justify-start text-muted-foreground" : "text-foreground/80", className)}
    >
      <span className="shrink-0 whitespace-nowrap">{v.text || status}</span>
    </span>
  );
}

export function VoiceInline() {
  const id = React.useId();
  const v = useVoice();
  const speaking = React.useSyncExternalStore(speaker.subscribe, () => speaker.getSnapshot().speaking, () => false);
  const mine = v.phase !== "idle" && v.slot === id;
  const reading = speaking && v.phase === "idle";
  return (
    <div data-voice-slot={id} className="min-w-0 max-w-full">
      <AnimatePresence initial={false}>
        {(mine || reading) && (
          <motion.div
            key="live"
            data-voice-live
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 0.8, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2.5 px-4 py-1.5 text-sm">
              <VoiceBars level={reading ? (speaker.level as unknown as MotionValue<number>) : v.level} />
              {reading ? (
                <span data-testid="speak-status" className="min-w-0 flex-1 truncate text-muted-foreground">
                  Leyendo en voz alta…
                </span>
              ) : (
                <LiveText v={v} className="flex-1" />
              )}
              <span className="shrink-0 text-[11px] text-muted-foreground">{reading ? "Esc" : hint(v.mode)}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** With no message box to hold it (the page, a dialog…): one small quiet pill at the bottom. */
function VoiceFloating({ v }: { v: VoiceCtx }) {
  const open = v.phase !== "idle" && v.slot === null;
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="floating"
          data-voice-live
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: [0.22, 0.8, 0.3, 1] }}
          className="pointer-events-none fixed inset-x-0 bottom-5 z-[70] flex justify-center px-4"
        >
          <div className="flex max-w-md items-center gap-2.5 rounded-full border bg-popover/95 px-3.5 py-1.5 text-sm shadow-lg backdrop-blur">
            <VoiceBars level={v.level} />
            <LiveText v={v} className="max-w-[18rem]" />
            <span className="shrink-0 text-[11px] text-muted-foreground">{hint(v.mode)}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The microphone button: dictation without holding anything. Hidden where nothing can dictate. */
export function VoiceButton({ className }: { className?: string }) {
  const v = useVoice();
  if (v.available === false) return null;
  const on = v.phase !== "idle";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn("rounded-full", on && "bg-accent text-foreground", className)}
      aria-label="Dictar"
      aria-pressed={on}
      title="Dictar con la voz (o mantén Espacio)"
      onMouseDown={(e) => e.preventDefault()} // keeps the caret in the text box
      onClick={v.toggle}
    >
      <MicIcon />
    </Button>
  );
}
