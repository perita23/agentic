/** Files Claude has created or edited in a run, read live from its stream-json tool calls. */
export interface ChangedFile {
  /** Path relative to the project when possible. */
  path: string;
  /** "created" when the file was written with Write and never edited before, else "edited". */
  action: "created" | "edited";
  /** How many times it was touched. */
  touches: number;
}

const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

type Block = { type?: string; name?: string; input?: Record<string, unknown> };

/** The file a tool call modifies, or null when the call does not modify files. */
export function editedPath(name: string, input: unknown): string | null {
  if (!FILE_TOOLS.has(name) || !input || typeof input !== "object") return null;
  const i = input as Record<string, unknown>;
  const p = i.file_path ?? i.notebook_path ?? i.path;
  return typeof p === "string" && p ? p : null;
}

function relative(p: string, projectPath?: string) {
  if (projectPath) {
    const base = projectPath.replace(/\/+$/, "") + "/";
    if (p.startsWith(base)) return p.slice(base.length);
  }
  return p;
}

/** Most recently touched first. */
export function changedFiles(events: unknown[], projectPath?: string): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>();
  for (const ev of events) {
    const e = ev as { type?: string; message?: { content?: unknown } } | null;
    if (!e || e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message!.content as Block[]) {
      if (b?.type !== "tool_use" || !b.name) continue;
      const p = editedPath(b.name, b.input);
      if (!p) continue;
      const key = relative(p, projectPath);
      const prev = byPath.get(key);
      byPath.delete(key); // re-insert so the map stays ordered by last touch
      byPath.set(key, { path: key, action: prev ? prev.action : b.name === "Write" ? "created" : "edited", touches: (prev?.touches ?? 0) + 1 });
    }
  }
  return [...byPath.values()].reverse();
}
