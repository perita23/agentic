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

export type VoiceInEntry = VoiceInfo | SpeechSynthesisVoice;
/**
 * The sentences of a text that is still being written: what can already be said. The last piece, which has no end yet,
 * waits (unless the answer is over, or it has gone on so long that it is better said in parts).
 */
export function streamSentences(text: string, final: boolean): string[] {
  const t = speechText(text);
  if (!t) return [];
  const out: string[] = [];
  for (const line of t.split("\n")) {
    const pieces = line.match(/[^.!?…]+(?:[.!?…]+(?=\s|$)|$)\s*/g) ?? [];
    for (const p of pieces) out.push(p.trim());
  }
  const lastLine = t.split("\n").pop() ?? "";
  const open = !/[.!?…:]\s*$/.test(lastLine) && !t.endsWith("\n");
  if (!final && open && out.length) {
    const tail = out[out.length - 1]!;
    if (tail.length < 180) out.pop(); // not finished: it waits
  }
  return out.filter(Boolean);
}

export interface VoiceInfo {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
}

/** How natural a voice is by its name: the "Premium" and "Enhanced" voices of macOS sound far better than the compact ones. */
function quality(name: string): number {
  if (/premium/i.test(name)) return 3;
  if (/enhanced|mejorad|am[ée]lior|erweitert|migliorat|aprimorad/i.test(name)) return 2;
  if (/siri|natural|neural/i.test(name)) return 1;
  return 0;
}

/** The voice to read with: the chosen one, else the best local voice of the language (never a remote one). */
export function pickVoice<T extends VoiceInfo>(voices: T[], lang: string, uri = ""): T | null {
  const local = voices.filter((v) => v.localService);
  const chosen = uri ? local.find((v) => v.voiceURI === uri) : undefined;
  if (chosen) return chosen;
  const base = lang.split("-")[0]!.toLowerCase();
  const norm = (l: string) => l.replace("_", "-").toLowerCase();
  // Only a voice of the language counts; among those, the more natural one wins.
  const fit = (v: T) => (norm(v.lang) === lang.toLowerCase() ? 4 : 0) + (norm(v.lang).startsWith(`${base}-`) || norm(v.lang) === base ? 2 : 0);
  const score = (v: T) => (fit(v) ? fit(v) + quality(v.name) : 0);
  const best = [...local].sort((a, b) => score(b) - score(a))[0];
  return best && score(best) > 0 ? best : null;
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
  /** The piece being read right now. */
  caption: string;
}

/** The Mac app's own voices (through macOS' `say`): all of them, the natural ones included. */
export interface NativeSpeakBridge {
  available(): Promise<boolean>;
  voices(): Promise<{ name: string; lang: string; quality: string }[]>;
  say(text: string, voice: string | null, rate: number): Promise<boolean>;
  stop(): void;
}
const nativeBridge = (): NativeSpeakBridge | null => (typeof window === "undefined" ? null : ((window as unknown as { agenticDesktop?: { speak?: NativeSpeakBridge } }).agenticDesktop?.speak ?? null));
export const SAY_PREFIX = "say:";

class Speaker {
  state: SpeakState = { speaking: false, id: null, voiceMode: false, caption: "" };
  private native: VoiceInfo[] = [];
  private nativeReady = false;
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

  /** Can the browser speak (its own synthesiser)? */
  private web() {
    return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  }
  /** Can anything speak here: the browser's synthesiser, or the Mac app's voices. */
  available() {
    return this.web() || !!nativeBridge();
  }

  /** Asks the Mac app for its voices (once). */
  async loadNative() {
    if (this.nativeReady) return;
    const b = nativeBridge();
    if (!b) return;
    this.nativeReady = true;
    try {
      if (!(await b.available())) return;
      this.native = (await b.voices()).map((v) => ({ voiceURI: `${SAY_PREFIX}${v.name}`, name: v.name, lang: v.lang, localService: true }));
      this.set({});
    } catch {}
  }

  /** Local voices only: the Mac's own (all of them) and what the browser offers from the device. */
  voices(): VoiceInEntry[] {
    const web = this.web() ? window.speechSynthesis.getVoices().filter((v) => v.localService) : [];
    // The browser lists some macOS voices too: the ones `say` has are taken from there, not twice.
    const names = new Set(this.native.map((v) => v.name));
    return [...this.native, ...web.filter((v) => !names.has(v.name))];
  }

  setVoiceMode(on: boolean) {
    if (!on) this.stop();
    this.set({ voiceMode: on });
  }

  // ---- The queue: text can keep arriving while it speaks (an answer is read as it is written).
  private queue: string[] = [];
  private ended = true;
  private talking = false;
  private opts: SpeakOptions | null = null;
  private voice: VoiceInEntry | null = null;
  private pulse: ReturnType<typeof setInterval> | undefined;

  /** Starts reading something that will arrive in pieces: `push` what comes, then `end`. */
  begin(o: SpeakOptions) {
    this.stop();
    if (!this.web() && !this.native.length) return false;
    this.gen++;
    this.opts = o;
    this.voice = pickVoice(this.voices(), o.lang, o.voiceURI);
    this.queue = [];
    this.ended = false;
    this.talking = false;
    return true;
  }

  push(text: string) {
    if (!this.opts || this.ended) return;
    this.queue.push(...splitForSpeech(speechText(text)));
    this.pump();
  }

  /** Nothing more will come: when it has said everything, it is over. */
  end() {
    if (!this.opts) return;
    this.ended = true;
    this.pump();
  }

  /** Reads all of it (already complete). */
  speak(markdown: string, o: SpeakOptions) {
    if (!this.begin(o)) return void o.onEnd?.();
    this.push(markdown);
    this.end();
  }

  private finish(natural: boolean, gen: number) {
    if (gen !== this.gen) return;
    clearInterval(this.pulse);
    const o = this.opts;
    this.opts = null;
    this.queue = [];
    this.talking = false;
    this.set({ speaking: false, id: null, caption: "" });
    if (natural) o?.onEnd?.();
  }

  private pump() {
    const o = this.opts;
    if (!o || this.talking) return;
    const gen = this.gen;
    if (!this.queue.length) {
      if (this.ended) this.finish(true, gen);
      return;
    }
    // Pieces that are already waiting are joined into one breath (fewer gaps between them).
    let chunk = this.queue.shift()!;
    while (this.queue.length && (chunk + " " + this.queue[0]).length <= 220) chunk += " " + this.queue.shift();
    this.talking = true;
    const bridge = this.voice?.voiceURI.startsWith(SAY_PREFIX) ? nativeBridge() : null;
    if (!this.state.speaking) {
      this.set({ speaking: true, id: o.id });
      // The Mac's voices say nothing about words: the bars move at about the rhythm of speech.
      if (bridge) this.pulse = setInterval(() => (this.lvl = 0.35 + Math.random() * 0.55), 230);
    }
    this.set({ caption: chunk });
    const next = (ok: boolean) => {
      if (gen !== this.gen) return;
      this.talking = false;
      if (!ok) return this.finish(false, gen);
      this.pump();
    };
    if (bridge && this.voice) {
      void bridge.say(chunk, this.voice.name, o.rate ?? 1).then(next);
      return;
    }
    const u = new SpeechSynthesisUtterance(chunk);
    u.lang = this.voice?.lang ?? o.lang;
    if (this.voice && "default" in this.voice) u.voice = this.voice as SpeechSynthesisVoice;
    u.rate = Math.min(2, Math.max(0.5, o.rate ?? 1));
    u.onboundary = () => (this.lvl = 0.85);
    u.onend = () => next(true);
    u.onerror = (e) => (e.error === "interrupted" || e.error === "canceled" ? undefined : next(false));
    window.speechSynthesis.speak(u);
  }

  /** Silence (never counts as having finished: nobody listens afterwards). */
  stop() {
    this.gen++;
    clearInterval(this.pulse);
    this.opts = null;
    this.queue = [];
    this.talking = false;
    nativeBridge()?.stop();
    if (this.web()) window.speechSynthesis.cancel();
    if (this.state.speaking) this.set({ speaking: false, id: null, caption: "" });
  }
}

export const speaker = new Speaker();
