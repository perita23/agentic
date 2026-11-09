import { api } from "@/lib/api";
import { rangeRect } from "@/lib/caret";
import { checkable, shorthandFix, wordsOf, type Token } from "@/lib/word-fix";

export type Field = HTMLTextAreaElement | HTMLInputElement;

/** A corrected word shown morphing in place (viewport pixels; the look of the field it is in). */
export interface Morph {
  id: number;
  /** Where the corrected word is, to follow it while the box changes (it grows, the page scrolls). */
  field: Field;
  start: number;
  len: number;
  left: number;
  top: number;
  width: number;
  height: number;
  from: string;
  to: string;
  bg: string;
  font: Record<string, string>;
}

const MAX_CHARS = 3000;
const DELAY_MS = 140;

/**
 * Word by word, for any text field: every word you finish is checked (frequent misspellings at once, the rest against
 * the dictionaries of the server, with the local model only choosing between candidates); a wrong one is fixed on the spot, keeping the caret and the undo history, and reported as a Morph.
 * One shared instance: what the model said about a word in one field is known in all.
 */
export class WordAssist {
  private cache = new Map<string, string>(); // «previous word|word» → the word as it should be (itself when fine)
  private queue: { field: Field; tok: Token }[] = [];
  private busy = false;
  private downUntil = 0; // after a failure it leaves the model alone for a while
  private timers = new WeakMap<Field, ReturnType<typeof setTimeout>>();
  private listeners = new Set<(f: Field, m: Morph) => void>();

  onMorph(cb: (f: Field, m: Morph) => void) {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  /** The field changed: look at it in a moment (the person may still be typing). */
  schedule(field: Field) {
    clearTimeout(this.timers.get(field));
    this.timers.set(field, setTimeout(() => this.scan(field), DELAY_MS));
  }

  private scan(field: Field) {
    if (!field.isConnected) return;
    const text = field.value;
    if (text.length > MAX_CHARS) return;
    const caret = field.selectionStart ?? text.length;
    for (const tok of wordsOf(text)) {
      if (!checkable(text, tok) || (caret > tok.start && caret <= tok.end)) continue; // not the one being edited
      const key = `${tok.before.split(" ").pop() ?? ""}|${tok.word}`;
      const known = shorthandFix(tok.word) ?? this.cache.get(key);
      if (known !== undefined) {
        if (known !== tok.word && this.fix(field, tok, known)) return; // the next scan (this edit triggers one) carries on
        continue;
      }
      if (Date.now() < this.downUntil) continue;
      // The same word in the same context is asked once (a pasted text repeats words a lot).
      const asked = (q: { tok: Token }) => `${q.tok.before.split(" ").pop() ?? ""}|${q.tok.word}` === key;
      if (!this.queue.some((q) => asked(q))) this.queue.push({ field, tok });
    }
    void this.pump();
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let item = this.queue.shift(); item; item = this.queue.shift()) {
        const { field, tok } = item;
        const key = `${tok.before.split(" ").pop() ?? ""}|${tok.word}`;
        try {
          const r = await api<{ word: string; changed: boolean }>("POST", "/api/spell/word", { word: tok.word, before: tok.before.slice(-200) });
          if (this.cache.size > 3000) this.cache.clear();
          this.cache.set(key, r.word);
          if (r.changed) this.fix(field, tok, r.word);
        } catch {
          // A model that is not there never interrupts typing (the settings page says what is wrong).
          this.downUntil = Date.now() + 20_000;
          this.queue = [];
          break;
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private fix(f: Field, tok: Token, to: string) {
    if (!f.isConnected || f.value.slice(tok.start, tok.end) !== tok.word) return false; // it moved or changed meanwhile
    const rect = rangeRect(f, tok.start, tok.end);
    const caret = f.selectionStart ?? f.value.length;
    const caretEnd = f.selectionEnd ?? caret;
    const delta = to.length - tok.word.length;
    if (document.activeElement === f) {
      f.setSelectionRange(tok.start, tok.end);
      let done = false;
      try {
        done = document.execCommand("insertText", false, to);
      } catch {}
      if (!done || f.value.slice(tok.start, tok.start + to.length) !== to) f.setRangeText(to, tok.start, tok.end, "end");
    } else f.setRangeText(to, tok.start, tok.end, "end");
    const shift = (p: number) => (p >= tok.end ? p + delta : p > tok.start ? tok.start + to.length : p);
    f.setSelectionRange(shift(caret), shift(caretEnd));
    f.dispatchEvent(new Event("input", { bubbles: true }));
    if (rect) {
      const cs = getComputedStyle(f);
      let bg = "";
      for (let e: HTMLElement | null = f; e && !bg; e = e.parentElement) {
        const c = getComputedStyle(e).backgroundColor;
        if (c && !/rgba?\(0, 0, 0, 0\)|transparent/.test(c)) bg = c;
      }
      const m: Morph = { id: Date.now() + Math.random(), field: f, start: tok.start, len: to.length, ...rect, from: tok.word, to, bg: bg || "var(--card)", font: { fontSize: cs.fontSize, fontFamily: cs.fontFamily, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing } };
      for (const l of this.listeners) l(f, m);
    }
    return true;
  }
}

export const wordAssist = new WordAssist();

/** Fields where correcting words is not wanted: searches, addresses, paths, keys, e-mails, commands, tags… */
const NOT_PROSE = /buscar|search|filtr|url|ruta|path|token|clave|key|contrase|password|correo|e-?mail|comando|command|cwd|rama|branch|usuario|username|host|puerto|port|\bid\b|slug|regex|expresi[oó]n|dominio|domain|direcci[oó]n de|etiqueta|label|tag|https?:|\.com|\.md|jql|query|consulta|nombre del archivo|archivo|carpeta|folder|modelo|model|vault|bearer|secret|hex|color|atajo|shortcut/i;

/** A text field the person writes prose in (task titles and descriptions, notes, comments…): worth correcting. */
export function proseField(t: EventTarget | null): t is Field {
  if (!(t instanceof HTMLTextAreaElement) && !(t instanceof HTMLInputElement)) return false;
  if (t instanceof HTMLInputElement && t.type !== "text" && t.type !== "") return false;
  if (t.readOnly || t.disabled || t.spellcheck === false || t.dataset.assist === "own") return false;
  if (t.closest("[data-no-assist], [role=combobox], [cmdk-root], [data-slot=command]") || t.getAttribute("aria-autocomplete") || t.getAttribute("role") === "combobox") return false;
  const what = [t.getAttribute("aria-label"), t.placeholder, t.name, t.id, t.autocomplete === "off" ? "" : t.autocomplete, ...(t.labels ? [...t.labels].map((l) => l.textContent) : []), t.closest("label")?.textContent, t.parentElement?.querySelector(":scope > label, :scope > [data-slot=label]")?.textContent].filter(Boolean).join(" ");
  return !NOT_PROSE.test(what);
}
