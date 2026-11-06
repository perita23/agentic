/** Where dictated text goes: the text field you were last in, written as if you had typed it. */

export type TextField = HTMLInputElement | HTMLTextAreaElement;

const TEXT_INPUTS = new Set(["text", "search", "email", "url", "tel", ""]);

export function isTextField(el: Element | null): el is TextField {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  return el instanceof HTMLInputElement && TEXT_INPUTS.has(el.type) && !el.readOnly && !el.disabled;
}

let last: TextField | null = null;

/** Remembers the last text field you were in (the microphone button takes the focus away from it). */
export function trackFocus(): () => void {
  const onFocus = (e: FocusEvent) => {
    const t = e.target as Element | null;
    if (isTextField(t)) last = t;
  };
  document.addEventListener("focusin", onFocus);
  return () => document.removeEventListener("focusin", onFocus);
}

/** The field to dictate into: the one you were last in, or the page's own message box. */
export function dictationTarget(): TextField | null {
  if (last && last.isConnected) return last;
  return document.querySelector<TextField>("textarea[aria-label='Mensaje para Claude'], textarea[aria-label='Responder a Claude']");
}

/** Writes at the caret the way typing does, so React-controlled fields notice (their setter is bypassed on purpose). */
export function insertAtCaret(el: TextField, text: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  const sep = before && !/\s$/.test(before) ? " " : "";
  const next = `${before}${sep}${text}${after}`;
  set.call(el, next);
  const pos = before.length + sep.length + text.length;
  el.focus();
  el.setSelectionRange(pos, pos);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** The send button of the message box the text went into (a few levels up), if it can be pressed. */
export function sendButtonFor(el: TextField): HTMLButtonElement | null {
  let p: HTMLElement | null = el.parentElement;
  for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
    const b = p.querySelector<HTMLButtonElement>("button[aria-label='Enviar']");
    if (b) return b.disabled ? null : b;
  }
  return null;
}

/**
 * Dictating live: the words appear in the field as they are heard and are replaced by the next version of the
 * sentence (never appended twice). What was in the field before, around the caret, is kept as it was.
 */
export class LiveInsert {
  private before: string;
  private after: string;
  private sep: string;
  private focused = false;
  private written: string | null = null;
  /** The person typed or deleted in the field meanwhile: from then on it is theirs, not dictation's. */
  private edited = false;
  constructor(readonly el: TextField) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    this.before = el.value.slice(0, start);
    this.after = el.value.slice(end);
    this.sep = this.before && !/\s$/.test(this.before) ? " " : "";
  }

  private write(value: string, caret: number) {
    const el = this.el;
    if (this.edited || (this.written !== null && el.value !== this.written)) {
      this.edited = true;
      return;
    }
    if (el.value === value) return;
    this.written = value;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    if (!this.focused) {
      el.focus();
      this.focused = true;
    }
    el.setSelectionRange(caret, caret);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    if (el instanceof HTMLTextAreaElement) el.scrollTop = el.scrollHeight; // keep the newest words in view
  }

  /** The whole sentence heard so far. */
  update(text: string) {
    if (!this.el.isConnected) return;
    if (!text) return this.restore();
    this.write(`${this.before}${this.sep}${text}${this.after}`, this.before.length + this.sep.length + text.length);
  }

  /** As it was before dictating. */
  restore() {
    if (!this.el.isConnected) return;
    this.write(this.before + this.after, this.before.length);
  }
}
