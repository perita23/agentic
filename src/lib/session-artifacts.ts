/** What a session leaves behind, read from its stream-json events: artifacts, files created or edited, Obsidian notes. */
export interface SessionItem {
  /** Absolute path (files, notes) or URL (artifacts). */
  key: string;
  label: string;
  /** Where it is: the folder of a file, the path of a note inside the vault, the URL of an artifact. */
  detail: string;
  href?: string;
}
export interface SessionArtifacts {
  artifacts: SessionItem[];
  created: SessionItem[];
  edited: SessionItem[];
  notes: SessionItem[];
}

type Block = { type?: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string; content?: unknown; tool_use_id?: string };
type Ev = { type?: string; message?: { content?: unknown } } & Record<string, unknown>;

const ARTIFACT_URL = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/g;
const base = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;
const dir = (p: string) => p.slice(0, Math.max(0, p.length - base(p).length)).replace(/\/+$/, "") || "/";

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : "")).join("\n");
  return "";
}

/**
 * Newest first inside each group. A file Claude created and then edited stays a created file; a note in the Obsidian vault is a
 * note, not a file. `vaultRoot` is the vault's absolute path (null when Obsidian is not connected).
 */
export function collectArtifacts(events: Ev[], vaultRoot: string | null): SessionArtifacts {
  const calls = new Map<string, { name: string; input: Record<string, unknown> }>();
  const created = new Map<string, number>();
  const edited = new Map<string, number>();
  const notes = new Map<string, number>();
  const artifacts = new Map<string, { at: number; title: string }>();
  let at = 0;
  for (const e of events) {
    at++;
    if (!e || typeof e !== "object" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message!.content as Block[]) {
      if (!b || typeof b !== "object") continue;
      if (e.type === "assistant" && b.type === "tool_use" && b.name) {
        const input = b.input ?? {};
        if (b.id) calls.set(b.id, { name: b.name, input });
        const f = typeof input.file_path === "string" ? input.file_path : typeof input.notebook_path === "string" ? input.notebook_path : "";
        if (!f) continue;
        if (vaultRoot && f.startsWith(`${vaultRoot}/`) && f.endsWith(".md") && ["Write", "Edit", "MultiEdit"].includes(b.name)) notes.set(f, at);
        else if (b.name === "Write") created.set(f, at);
        else if (["Edit", "MultiEdit", "NotebookEdit"].includes(b.name)) edited.set(f, at);
      }
      // Artifacts: their link comes back in a tool result or in what Claude says.
      const found = e.type === "user" && b.type === "tool_result" ? textOf(b.content) : e.type === "assistant" && b.type === "text" ? (b.text ?? "") : "";
      for (const url of found.match(ARTIFACT_URL) ?? []) {
        const call = b.tool_use_id ? calls.get(b.tool_use_id) : undefined;
        const f = typeof call?.input.file_path === "string" ? call.input.file_path : "";
        const title = typeof call?.input.title === "string" && call.input.title ? call.input.title : f ? base(f).replace(/\.[a-z]+$/i, "") : "";
        artifacts.set(url, { at, title: title || artifacts.get(url)?.title || "" });
      }
    }
  }
  const order = <T>(m: Map<string, T>, at: (v: T) => number) => [...m.entries()].sort((a, b) => at(b[1]) - at(a[1]));
  const file = (f: string): SessionItem => ({ key: f, label: base(f), detail: dir(f) });
  return {
    artifacts: order(artifacts, (v) => v.at).map(([url, v]) => ({ key: url, label: v.title || "Artifact", detail: url.replace(/^https:\/\//, ""), href: url })),
    created: order(created, (v) => v).map(([f]) => file(f)),
    edited: order(edited, (v) => v).filter(([f]) => !created.has(f)).map(([f]) => file(f)),
    notes: order(notes, (v) => v).map(([f]) => ({ key: f, label: base(f).replace(/\.md$/, ""), detail: f.slice((vaultRoot ?? "").length + 1), href: `obsidian://open?path=${encodeURIComponent(f)}` })),
  };
}
