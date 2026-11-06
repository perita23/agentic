"use client";

import * as React from "react";
import { AudioLinesIcon, SquareIcon, Volume2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api";
import { resolveLang } from "@/lib/voice/engine";
import { speaker, type SpeakOptions } from "@/lib/voice/speak";
import { cn } from "@/lib/utils";
import { DEFAULT_VOICE, useVoice, type VoicePrefs } from "./voice";

export const useSpeaker = () => {
  const st = React.useSyncExternalStore(speaker.subscribe, speaker.getSnapshot, speaker.getSnapshot);
  const available = React.useSyncExternalStore(
    () => () => {},
    () => speaker.available(),
    () => false,
  );
  React.useEffect(() => speaker.loadMode(), []);
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
 * The loop of talk mode. When Claude finishes answering it reads the answer; when it has finished reading, it listens
 * (it never listens while it talks, so it does not hear itself). Nothing happens when talk mode is off.
 */
export function VoiceLoop({ running, last }: { running: boolean; last: string }) {
  const v = useVoice();
  const opts = useSpeakOptions();
  const vRef = React.useRef(v);
  const optsRef = React.useRef(opts);
  const lastRef = React.useRef(last);
  React.useEffect(() => {
    vRef.current = v;
    optsRef.current = opts;
    lastRef.current = last;
  });
  const was = React.useRef(running);
  React.useEffect(() => {
    const finished = was.current && !running;
    was.current = running;
    if (!finished || !speaker.state.voiceMode || !lastRef.current.trim()) return;
    speaker.speak(lastRef.current, {
      ...optsRef.current,
      id: "reply",
      onEnd: () => {
        if (speaker.state.voiceMode && vRef.current.phase === "idle") vRef.current.toggle();
      },
    });
  }, [running]);
  // Leaving the page silences it.
  React.useEffect(() => () => speaker.stop(), []);
  return null;
}
