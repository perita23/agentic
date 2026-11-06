/**
 * Reading Claude's answers aloud, on the device: the voices of the system itself (speechSynthesis). Only voices that
 * run locally are used, so nothing is sent anywhere.
 */

/** Markdown → what is worth hearing: no code, tables, addresses or markup. */
export function speechText(md: string): string {
  let hadCode = false;
  let t = md.replace(/```[\s\S]*?(```|$)/g, () => ((hadCode = true), "\n"));
  t = t
    .replace(/~~~[\s\S]*?(~~~|$)/g, () => ((hadCode = true), "\n"))
    .replace(/<[^>\n]+>/g, " ") // html tags
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links: the text
    .replace(/https?:\/\/\S+/g, "un enlace")
    .replace(/^\s*\|.*\|\s*$/gm, " ") // table rows
    .replace(/^\s*[-*_]{3,}\s*$/gm, " ")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/gm, "")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([^*_~\n]+?)\1/g, "$2")
    .replace(/[*_~`#]+/g, " ")
    .replace(/(?:[\w.-]*\/){2,}[\w.-]+/g, "una ruta") // long paths read terribly
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (!t && hadCode) t = "Te dejo el código en pantalla.";
  return t;
}

/** Sentences (a speech engine does better with short pieces, and long ones get cut off by some of them). */
export function splitForSpeech(text: string, max = 220): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const p = para.trim();
    if (!p) continue;
    const sentences = p.match(/[^.!?…]+(?:[.!?…]+|$)\s*/g) ?? [p];
    let cur = "";
    const flush = () => {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    };
    for (const s of sentences) {
      if (s.length > max) {
        flush();
        // A very long sentence: at commas, or by words.
        for (const piece of s.split(/(?<=[,;:])\s+/)) {
          let rest = piece;
          while (rest.length > max) {
            const cut = rest.lastIndexOf(" ", max);
            out.push(rest.slice(0, cut > 40 ? cut : max).trim());
            rest = rest.slice(cut > 40 ? cut : max);
          }
          if (rest.trim()) out.push(rest.trim());
        }
        continue;
      }
      if ((cur + s).length > max) flush();
      cur += s;
    }
    flush();
  }
  return out;
}

export interface VoiceInfo {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
}

const NICE = /premium|enhanced|mejorad|siri|natural|neural/i;

/** The voice to read with: the chosen one, else the best local voice of the language (never a remote one). */
export function pickVoice<T extends VoiceInfo>(voices: T[], lang: string, uri = ""): T | null {
  const local = voices.filter((v) => v.localService);
  const chosen = uri ? local.find((v) => v.voiceURI === uri) : undefined;
  if (chosen) return chosen;
  const base = lang.split("-")[0]!.toLowerCase();
  const norm = (l: string) => l.replace("_", "-").toLowerCase();
  const score = (v: T) => (norm(v.lang) === lang.toLowerCase() ? 4 : 0) + (norm(v.lang).startsWith(`${base}-`) || norm(v.lang) === base ? 2 : 0) + (NICE.test(v.name) ? 1 : 0);
  const best = [...local].sort((a, b) => score(b) - score(a))[0];
  return best && score(best) >= 2 ? best : null;
}

export interface SpeakOptions {
  /** Who is being read (to show which message, and to toggle it off). */
  id: string;
  lang: string;
  voiceURI?: string;
  rate?: number;
  /** Finished reading to the end (not when it was stopped). */
  onEnd?: () => void;
}
export interface SpeakState {
  speaking: boolean;
  id: string | null;
  /** Talk mode: answers are read aloud and then it listens again. */
  voiceMode: boolean;
}

const MODE_KEY = "agentic.voiceMode";

class Speaker {
  state: SpeakState = { speaking: false, id: null, voiceMode: false };
  private subs = new Set<() => void>();
  private gen = 0;
  private lvl = 0;

  /** For the bars: a little jump with every word, then it settles. */
  level = {
    get: () => {
      this.lvl = this.lvl * 0.82;
      return this.state.speaking ? Math.max(0.14, this.lvl) : 0;
    },
  };

  subscribe = (f: () => void) => {
    this.subs.add(f);
    return () => this.subs.delete(f);
  };
  getSnapshot = () => this.state;
  private set(p: Partial<SpeakState>) {
    this.state = { ...this.state, ...p };
    this.subs.forEach((f) => f());
  }

  available() {
    return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  }

  /** Local voices only. */
  voices(): SpeechSynthesisVoice[] {
    if (!this.available()) return [];
    return window.speechSynthesis.getVoices().filter((v) => v.localService);
  }

  /** Talk mode is remembered on this device. */
  loadMode() {
    try {
      const on = localStorage.getItem(MODE_KEY) === "1";
      if (on !== this.state.voiceMode) this.set({ voiceMode: on });
    } catch {}
  }
  setVoiceMode(on: boolean) {
    try {
      localStorage.setItem(MODE_KEY, on ? "1" : "0");
    } catch {}
    if (!on) this.stop();
    this.set({ voiceMode: on });
  }

  speak(markdown: string, o: SpeakOptions) {
    this.stop();
    if (!this.available()) return void o.onEnd?.();
    const chunks = splitForSpeech(speechText(markdown));
    if (!chunks.length) return void o.onEnd?.();
    const gen = ++this.gen;
    const voice = pickVoice(this.voices(), o.lang, o.voiceURI);
    this.set({ speaking: true, id: o.id });
    const done = (natural: boolean) => {
      if (gen !== this.gen) return;
      this.set({ speaking: false, id: null });
      if (natural) o.onEnd?.();
    };
    const next = (i: number) => {
      if (gen !== this.gen) return;
      if (i >= chunks.length) return done(true);
      const u = new SpeechSynthesisUtterance(chunks[i]);
      u.lang = voice?.lang ?? o.lang;
      if (voice) u.voice = voice;
      u.rate = Math.min(2, Math.max(0.5, o.rate ?? 1));
      u.onboundary = () => (this.lvl = 0.85);
      u.onend = () => next(i + 1);
      u.onerror = (e) => (e.error === "interrupted" || e.error === "canceled" ? undefined : done(false));
      window.speechSynthesis.speak(u);
    };
    next(0);
  }

  /** Silence (never counts as having finished: nobody listens afterwards). */
  stop() {
    this.gen++;
    if (this.available()) window.speechSynthesis.cancel();
    if (this.state.speaking) this.set({ speaking: false, id: null });
  }
}

export const speaker = new Speaker();
