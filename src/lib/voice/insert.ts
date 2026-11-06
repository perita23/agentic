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
