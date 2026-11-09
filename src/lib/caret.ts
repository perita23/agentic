/** The properties that decide how text is laid out (and so where a word falls). */
const LAYOUT = /^(font|text-(?!shadow|decoration|emphasis|underline)|letter-spacing|word-|line-|white-space|hyphens|tab-size|direction|writing-mode|unicode-bidi|padding-|border-(top|right|bottom|left)-(width|style)|box-sizing|overflow-wrap|-webkit-text-size)/;

/**
 * Where a piece of a text field's text is on screen (viewport pixels): a hidden copy of the field, placed in the same
 * container (so it inherits what the field inherits) with the same layout properties, lays the text out and the piece
 * is measured in it.
 */
export function rangeRect(el: HTMLTextAreaElement | HTMLInputElement, start: number, end: number): { left: number; top: number; width: number; height: number } | null {
  const cs = getComputedStyle(el);
  const mirror = document.createElement("div");
  // Every layout property, not a shortlist: font features, optical sizing, kerning… all change the width of a word.
  for (let i = 0; i < cs.length; i++) {
    const name = cs[i]!;
    if (LAYOUT.test(name)) mirror.style.setProperty(name, cs.getPropertyValue(name));
  }
  // The text area is as wide as its content box minus the scrollbar (if it has one): the copy must wrap the same way.
  mirror.style.boxSizing = "border-box";
  mirror.style.width = `${el.clientWidth + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0)}px`;
  Object.assign(mirror.style, { position: "fixed", visibility: "hidden", pointerEvents: "none", top: "0", left: "-9999px", height: "auto", overflow: "hidden", whiteSpace: el instanceof HTMLTextAreaElement ? "pre-wrap" : "pre", overflowWrap: "break-word", transform: "none", zoom: "" });
  const span = document.createElement("span");
  span.textContent = el.value.slice(start, end) || "​";
  mirror.append(document.createTextNode(el.value.slice(0, start)), span);
  (el.parentElement ?? document.body).append(mirror);
  try {
    const r = span.getClientRects()[0];
    if (!r) return null;
    const m = mirror.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return { left: box.left + (r.left - m.left) - el.scrollLeft, top: box.top + (r.top - m.top) - el.scrollTop, width: r.width, height: r.height };
  } finally {
    mirror.remove();
  }
}
