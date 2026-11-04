import * as React from "react";
import { ExternalLinkIcon, SparklesIcon } from "lucide-react";

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
/** Claude artifacts: claude.ai/artifact/<id> and claude.ai/code/artifact/<id>. */
const ARTIFACT_RE = /^https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+\/?$/;

/**
 * Plain text with clickable links, as React nodes (never HTML). Only http(s) URLs
 * become links (opened in a new tab / the default browser); Claude artifacts get a
 * recognisable button. Trailing punctuation stays outside the link.
 */
export function linkify(text: string, key = "l"): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0];
    const url = raw.replace(/[.,;:!?)\]}»]+$/, "");
    if (m.index! > last) out.push(text.slice(last, m.index));
    let ok = true;
    try {
      ok = ["http:", "https:"].includes(new URL(url).protocol);
    } catch {
      ok = false;
    }
    if (!ok) out.push(raw);
    else if (ARTIFACT_RE.test(url))
      out.push(
        <a key={`${key}-${k++}`} href={url} target="_blank" rel="noopener noreferrer" className="mx-0.5 inline-flex items-center gap-1.5 rounded-md border border-purple/40 bg-purple/10 px-2 py-0.5 align-baseline text-[0.9em] font-medium text-foreground no-underline hover:bg-purple/20">
          <SparklesIcon className="size-3.5 text-purple" /> Abrir artifact <ExternalLinkIcon className="size-3 text-muted-foreground" />
        </a>,
      );
    else
      out.push(
        <a key={`${key}-${k++}`} href={url} target="_blank" rel="noopener noreferrer" className="break-all text-link underline-offset-2 hover:underline">
          {url}
        </a>,
      );
    out.push(raw.slice(url.length));
    last = m.index! + raw.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Linkified({ text }: { text: string }) {
  return <>{linkify(text)}</>;
}
