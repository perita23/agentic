import type { VoiceEngine, VoiceHandlers } from "./engine";

/* The browser's speech recognition (not in the TypeScript lib). */
interface SRResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SREvent {
  results: ArrayLike<SRResult>;
}
interface SRInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRCtor = new () => SRInstance;

const ctor = (): SRCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

const ERRORS: Record<string, string> = {
  "not-allowed": "El navegador no tiene permiso para usar el micrófono: permítelo para esta página.",
  "service-not-allowed": "El navegador no permite el reconocimiento de voz en esta página.",
  "audio-capture": "No se encuentra ningún micrófono.",
  network: "El reconocimiento de voz del navegador necesita conexión a internet.",
  "language-not-supported": "El navegador no admite ese idioma para dictar.",
};

/** Loudness from the microphone, 20 times a second (best effort: dictation works without it, just without the animation). */
async function startMeter(onLevel: (v: number) => void): Promise<() => void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const data = new Uint8Array(an.fftSize);
    const t = setInterval(() => {
      an.getByteTimeDomainData(data);
      let sum = 0;
      for (const b of data) sum += ((b - 128) / 128) ** 2;
      onLevel(Math.min(1, Math.sqrt(sum / data.length) * 7));
    }, 50);
    return () => {
      clearInterval(t);
      stream.getTracks().forEach((x) => x.stop());
      void ctx.close();
    };
  } catch {
    return () => {};
  }
}

export function webSpeechEngine(): VoiceEngine | null {
  const C = ctor();
  if (!C) return null;
  return {
    id: "web",
    async start(lang, h: VoiceHandlers) {
      const rec = new C();
      rec.lang = lang;
      rec.continuous = true;
      rec.interimResults = true;
      let text = "";
      let cancelled = false;
      let stopMeter = () => {};
      rec.onresult = (e) => {
        let out = "";
        for (let i = 0; i < e.results.length; i++) out += e.results[i]![0].transcript;
        text = out.trim();
        h.onText(text, false);
      };
      rec.onerror = (e) => {
        if (e.error === "no-speech" || e.error === "aborted") return;
        h.onError(ERRORS[e.error] ?? `Error de reconocimiento de voz (${e.error})`);
      };
      rec.onend = () => {
        stopMeter();
        if (!cancelled && text) h.onText(text, true);
        h.onEnd();
      };
      stopMeter = await startMeter(h.onLevel);
      try {
        rec.start();
      } catch (err) {
        stopMeter();
        throw err;
      }
      return {
        stop: () => rec.stop(),
        cancel: () => {
          cancelled = true;
          rec.abort();
        },
      };
    },
  };
}
