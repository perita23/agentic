const COPY = ["boxSizing", "width", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "fontFamily", "lineHeight", "letterSpacing", "wordSpacing", "textTransform", "textIndent", "tabSize", "textAlign", "direction"] as const;

/**
 * Where a piece of a text field's text is on screen (viewport pixels): a hidden copy of the field with the same
 * look lays out the text, and the piece is measured in it.
 */
export function rangeRect(el: HTMLTextAreaElement | HTMLInputElement, start: number, end: number): { left: number; top: number; width: number; height: number } | null {
  const cs = getComputedStyle(el);
  const mirror = document.createElement("div");
  for (const k of COPY) (mirror.style as unknown as Record<string, string>)[k] = cs[k];
  // The text area is as wide as its content box minus the scrollbar (if it has one): the copy must wrap the same way.
  mirror.style.boxSizing = "border-box";
  mirror.style.width = `${el.clientWidth + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0)}px`;
  Object.assign(mirror.style, { position: "fixed", visibility: "hidden", pointerEvents: "none", top: "0", left: "-9999px", height: "auto", overflow: "hidden", whiteSpace: el instanceof HTMLTextAreaElement ? "pre-wrap" : "pre", overflowWrap: "break-word" });
  const span = document.createElement("span");
  span.textContent = el.value.slice(start, end) || "​";
  mirror.append(document.createTextNode(el.value.slice(0, start)), span);
  document.body.append(mirror);
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
