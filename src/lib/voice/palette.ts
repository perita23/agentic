/** The colours of Agentic's orb, for the dictation animation (their own copy: the orb itself is never touched). */
export const VOICE_COLORS = ["#8b6cf5", "#ff8a5b", "#5aa9ff"] as const;

function hex(c: string): [number, number, number] {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

/** A colour along violet → coral → blue; t in 0..1. */
export function voiceColor(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (VOICE_COLORS.length - 1);
  const i = Math.min(VOICE_COLORS.length - 2, Math.floor(x));
  const f = x - i;
  const a = hex(VOICE_COLORS[i]!);
  const b = hex(VOICE_COLORS[i + 1]!);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k]! - v) * f)).join(" ")})`;
}
