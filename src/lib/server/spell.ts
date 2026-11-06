import fs from "node:fs";
import path from "node:path";
import nspell from "nspell";
import { z } from "zod";
import { levenshtein, type OllamaService } from "./ollama";
import type { JsonStore } from "./store";
import { parse, text } from "./util";

/**
 * Spelling with real dictionaries (Hunspell, the checker of LibreOffice, Firefox and macOS), in Spanish and English.
 * A dictionary says exactly which words are wrong and proposes the candidates; the local model (Ollama) is only asked
 * to choose between the candidates when the context decides, never to find the mistakes.
 */
export type SpellLang = "es" | "en";

export const spellSettingsSchema = z.object({
  /** "words": every word you finish is checked and a wrong one is fixed on the spot. */
  mode: z.enum(["off", "words"]).default("off"),
  /** "auto" looks at the words around to tell which language is being written. */
  lang: z.enum(["auto", "es", "en"]).default("auto"),
  /** Let the local model choose between candidates when the context decides. */
  useModel: z.boolean().default(true),
});
export type SpellSettings = z.infer<typeof spellSettingsSchema>;

export const spellWordSchema = z.object({
  word: text(60).refine((w) => w.length > 0 && !/\s/.test(w), "Una sola palabra"),
  before: text(300).default(""),
});

/** Dictionary files: public/dict/<lang>.aff|dic (public/ travels with the app, so does this). */
export function defaultDictDir() {
  return path.join(process.cwd(), "public", "dict");
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** Edit distance where swapping two neighbouring letters counts as one mistake (the commonest typo). */
export function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

export type Verdict = { kind: "fine" } | { kind: "fix"; to: string } | { kind: "choose"; options: string[] } | { kind: "unknown" };

/** What to do with a misspelt word given the dictionary's candidates: one sure fix, a choice, or nothing. */
export function decide(word: string, suggestions: string[]): Verdict {
  const w = word.toLowerCase();
  const near = suggestions.filter((s) => distance(w, s.toLowerCase()) <= Math.max(2, Math.ceil(w.length * 0.4)));
  if (!near.length) return { kind: "unknown" };
  // The same word with its accents or capitals put right is the sure answer.
  const accent = near.filter((s) => norm(s) === norm(w) && s.toLowerCase() !== w);
  if (accent.length) return { kind: "fix", to: accent[0]! };
  const ranked = near.map((s) => ({ s, d: distance(w, s.toLowerCase()) })).sort((x, y) => x.d - y.d);
  const best = ranked.filter((r) => r.d === ranked[0]!.d);
  if (best.length === 1 && ranked[0]!.d <= 2) return { kind: "fix", to: best[0]!.s };
  // Two letters swapped («recieve») is by far the commonest slip: among equals, the only swap wins.
  const swaps = best.filter((r) => levenshtein(w, r.s.toLowerCase()) > r.d);
  if (swaps.length === 1 && ranked[0]!.d <= 2) return { kind: "fix", to: swaps[0]!.s };
  return { kind: "choose", options: ranked.slice(0, 5).map((r) => r.s) };
}

/** Same capital letters as the word that was typed. */
const sameCase = (typed: string, fixed: string) => (typed[0] && typed[0] !== typed[0].toLowerCase() && fixed[0] === fixed[0]!.toLowerCase() ? fixed[0]!.toUpperCase() + fixed.slice(1) : fixed);

export class SpellService {
  private spellers = new Map<SpellLang, ReturnType<typeof nspell> | null>();

  constructor(
    private store: JsonStore,
    private ollama: OllamaService,
    private dictDir = defaultDictDir(),
  ) {}

  get(): SpellSettings {
    const raw = this.store.peek<unknown>("spell");
    if (raw === undefined) {
      // Before dictionaries existed, "word by word" lived in the local model's settings: it carries over.
      const legacy = this.ollama.get().autocorrect === "words";
      return spellSettingsSchema.parse({ mode: legacy ? "words" : "off" });
    }
    const r = spellSettingsSchema.safeParse(raw);
    return r.success ? r.data : spellSettingsSchema.parse({});
  }

  set(body: unknown): SpellSettings {
    const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const next = parse(spellSettingsSchema, { ...this.get(), ...input });
    this.store.write("spell", next);
    return next;
  }

  /** The dictionary of a language, read the first time it is needed (about a second for Spanish). */
  speller(l: SpellLang) {
    if (!this.spellers.has(l)) {
      try {
        this.spellers.set(l, nspell(fs.readFileSync(path.join(this.dictDir, `${l}.aff`)), fs.readFileSync(path.join(this.dictDir, `${l}.dic`))));
      } catch {
        this.spellers.set(l, null);
      }
    }
    return this.spellers.get(l) ?? null;
  }

  /** Which language the words around are in: the one whose dictionary knows more of them. */
  detect(context: string): SpellLang {
    const es = this.speller("es");
    const en = this.speller("en");
    if (!es || !en) return es ? "es" : "en";
    let ses = /[ñáéíóúü¿¡]/i.test(context) ? 2 : 0;
    let sen = 0;
    for (const t of context.match(/[\p{L}'’]{3,}/gu) ?? []) {
      const a = es.correct(t);
      const b = en.correct(t);
      if (a && !b) ses++;
      else if (b && !a) sen++;
    }
    return sen > ses ? "en" : "es";
  }

  /** Is this word right in any of the languages? */
  private known(word: string) {
    return (["es", "en"] as const).some((l) => this.speller(l)?.correct(word) || this.speller(l)?.correct(word.toLowerCase()));
  }

  /** The word as it should be: itself when it is fine, the fix when it is clearly wrong. */
  async word(body: unknown): Promise<{ word: string; changed: boolean; source: "dictionary" | "model" | null }> {
    const { word, before } = parse(spellWordSchema, body);
    const same = { word, changed: false, source: null } as const;
    if (this.known(word)) return same; // right in Spanish or in English: anglicisms and the like are left alone
    // A capital letter in the middle of a sentence is a name: not ours to correct.
    if (word[0] !== word[0]!.toLowerCase() && before.trim() && !/[.!?¿¡\n]\s*$/.test(before)) return same;
    const settings = this.get();
    const lang: SpellLang = settings.lang === "auto" ? this.detect(`${before} ${word}`) : settings.lang;
    const sp = this.speller(lang);
    if (!sp) return same;
    const v = decide(word, sp.suggest(word.toLowerCase() === word ? word : word.toLowerCase()));
    if (v.kind === "fix") return { word: sameCase(word, v.to), changed: true, source: "dictionary" };
    if (v.kind === "choose" && settings.useModel) {
      const o = this.ollama.get();
      if (o.enabled && o.model) {
        try {
          const picked = await this.ollama.choose({ word, before, options: v.options });
          if (picked && picked.toLowerCase() !== word.toLowerCase()) return { word: sameCase(word, picked), changed: true, source: "model" };
        } catch {
          // Without the model the doubtful word is left as typed.
        }
      }
    }
    return same;
  }
}
