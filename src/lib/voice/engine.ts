/**
 * Dictation engines. Two ways to turn the microphone into text, behind one shape:
 *  - "native": the Mac app's helper (Apple's Speech framework), through the preload bridge.
 *  - "web": the browser's own SpeechRecognition (Chrome, Edge, Safari). It does not work inside Electron.
 */
export interface VoiceHandlers {
  /** What has been heard so far (the whole sentence, not just the last piece). */
  onText(text: string, final: boolean): void;
  /** How loud it is right now, 0..1. */
  onLevel(v: number): void;
  onError(message: string): void;
  /** Nothing more will come. */
  onEnd(): void;
}

export interface VoiceSession {
  /** Let go: finish what was heard. */
  stop(): void;
  /** Throw it away. */
  cancel(): void;
}

export interface VoiceEngine {
  id: "native" | "web";
  start(lang: string, h: VoiceHandlers): Promise<VoiceSession>;
}

export interface NativeVoiceBridge {
  available(): Promise<boolean>;
  start(lang: string): Promise<{ ok: boolean; error?: string }>;
  stop(): void;
  cancel(): void;
  onEvent(cb: (o: { type: string; v?: number; text?: string; final?: boolean; message?: string }) => void): () => void;
}

export const LANGUAGES: { value: string; label: string }[] = [
  { value: "auto", label: "Automático (el del sistema)" },
  { value: "es-ES", label: "Español (España)" },
  { value: "es-MX", label: "Español (México)" },
  { value: "ca-ES", label: "Català" },
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "fr-FR", label: "Français" },
  { value: "de-DE", label: "Deutsch" },
  { value: "it-IT", label: "Italiano" },
  { value: "pt-PT", label: "Português" },
];

/** "auto" → the language of the system, as a full tag ("es" → "es-ES"). */
export function resolveLang(pref: string, system = typeof navigator !== "undefined" ? navigator.language : "es-ES"): string {
  const l = pref && pref !== "auto" ? pref : system || "es-ES";
  if (/^[a-z]{2,3}-[A-Za-z0-9]{2,8}$/.test(l)) return l;
  const base = l.split("-")[0]!.toLowerCase();
  const known = LANGUAGES.find((x) => x.value.startsWith(`${base}-`));
  return known?.value ?? "es-ES";
}

const nativeBridge = (): NativeVoiceBridge | null => (typeof window === "undefined" ? null : ((window as unknown as { agenticDesktop?: { voice?: NativeVoiceBridge } }).agenticDesktop?.voice ?? null));
const inApp = () => typeof window !== "undefined" && !!(window as unknown as { agenticDesktop?: unknown }).agenticDesktop;

function nativeEngine(bridge: NativeVoiceBridge): VoiceEngine {
  return {
    id: "native",
    async start(lang, h) {
      let off = () => {};
      off = bridge.onEvent((o) => {
        if (o.type === "level" && typeof o.v === "number") h.onLevel(o.v);
        else if (o.type === "text" && typeof o.text === "string") h.onText(o.text, !!o.final);
        else if (o.type === "error") h.onError(o.message ?? "Error de dictado");
        else if (o.type === "end") {
          off();
          h.onEnd();
        }
      });
      const r = await bridge.start(lang);
      if (!r.ok) {
        off();
        throw new Error(r.error || "No se pudo iniciar el dictado");
      }
      return { stop: () => bridge.stop(), cancel: () => bridge.cancel() };
    },
  };
}

/** What can dictate here, and with what: null when nothing can (and why). */
export async function pickEngine(): Promise<{ engine: VoiceEngine | null; reason?: string }> {
  const bridge = nativeBridge();
  if (bridge) {
    try {
      if (await bridge.available()) return { engine: nativeEngine(bridge) };
    } catch {}
    return { engine: null, reason: "Esta versión de la app no incluye el dictado. Actualiza a la última." };
  }
  // Inside the app but without the bridge (an old build): the browser engine does not work in Electron.
  if (inApp()) return { engine: null, reason: "Esta versión de la app no incluye el dictado. Actualiza a la última." };
  const { webSpeechEngine } = await import("./web-speech");
  const web = webSpeechEngine();
  return web ? { engine: web } : { engine: null, reason: "Este navegador no puede reconocer voz. Prueba con Chrome, Edge o Safari, o con la app de Mac." };
}
