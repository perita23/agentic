/** Split Claude's answer (possibly still streaming) into title and body. */
export function parseDescription(text: string): { title: string | null; body: string } {
  const m = /^\s*(?:TITULO|TÍTULO)\s*:\s*(.*)$/im.exec(text);
  if (!m) return { title: null, body: text.trim() };
  const rest = text.slice(m.index + m[0].length);
  const sep = /^\s*---\s*$/m.exec(rest);
  // The title is only final once its line is complete (something already follows it).
  return { title: rest.length > 0 ? m[1].trim().slice(0, 250) : null, body: (sep ? rest.slice(sep.index + sep[0].length) : rest).replace(/^\s*\n/, "").trimEnd() };
}
