/** The library: links to things Claude produced or worked on (artifacts, PRs, issues, documents) found in sessions. */
export type LibraryKind = "artifact" | "pr" | "issue" | "doc";

export const KIND_LABEL: Record<LibraryKind, string> = { artifact: "Artifacts", pr: "Pull requests", issue: "Incidencias", doc: "Documentos" };

export interface LibraryItem {
  url: string;
  kind: LibraryKind;
  /** The sentence around the link in the conversation. */
  title: string;
  sessionId: string;
  cwd: string | null;
  /** Latest mention (ISO). */
  at: string | null;
  mentions: number;
  sessions: number;
}

const URL_RE = /https?:\/\/[^\s<>"'`\\]+/g;
const RULES: [RegExp, LibraryKind][] = [
  [/^https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+\/?$/, "artifact"],
  [/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+$/, "pr"],
  [/^https:\/\/bitbucket\.org\/[^/\s]+\/[^/\s]+\/pull-requests\/\d+$/, "pr"],
  [/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+$/, "issue"],
  [/^https:\/\/[\w-]+\.atlassian\.net\/browse\/[A-Z][A-Z0-9]+-\d+$/, "issue"],
  [/^https:\/\/linear\.app\/[^/\s]+\/issue\/[\w-]+/, "issue"],
  [/^https:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/[\w-]+/, "doc"],
  [/^https:\/\/(?:www\.)?notion\.(?:so|site)\/\S+/, "doc"],
  [/^https:\/\/(?:www\.)?figma\.com\/(?:file|design|proto|board)\/[\w-]+/, "doc"],
];

/** Trailing punctuation and Markdown stay out of the link. */
export function cleanUrl(raw: string): string {
  return raw.replace(/[.,;:!?)\]}»*_]+$/, "").replace(/#.*$/, "").replace(/\?.*$/, (q) => (/github|atlassian|bitbucket|claude/.test(raw) ? "" : q));
}

export function classifyUrl(url: string): LibraryKind | null {
  for (const [re, kind] of RULES) if (re.test(url)) return kind;
  return null;
}

/** Every library link in a piece of text, in order, without duplicates. */
export function extractLibraryLinks(text: string): { url: string; kind: LibraryKind }[] {
  const seen = new Set<string>();
  const out: { url: string; kind: LibraryKind }[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = cleanUrl(m[0]);
    const kind = classifyUrl(url);
    if (kind && !seen.has(url)) {
      seen.add(url);
      out.push({ url, kind });
    }
  }
  return out;
}

/** A short human title for a link: the line around it, minus the URL and Markdown noise. */
export function contextOf(text: string, url: string): string {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.includes(url));
  if (i < 0) return "";
  const strip = (l: string) => l.replace(URL_RE, " ").replace(/[*_`>#|]+/g, " ").replace(/\[([^\]]*)\]\(\s*\)/g, "$1").replace(/[(\[]\s*[)\]]/g, "").replace(/\s+/g, " ").replace(/[\s:–—-]+$/, "").replace(/^[\s:–—-]+/, "").trim();
  let t = strip(lines[i]);
  for (let j = i - 1; t.length < 8 && j >= 0 && j >= i - 3; j--) t = strip(lines[j]) || t;
  return t.slice(0, 140);
}
