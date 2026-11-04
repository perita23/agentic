/** Finds the plan Claude proposed in plan mode, from its stream-json events. */
export interface FoundPlan {
  plan: string;
  /** Id of the ExitPlanMode call, or null when the plan was only written to a plan file. */
  id: string | null;
}

type Block = { type?: string; id?: string; name?: string; input?: Record<string, unknown> };

/** Claude Code keeps plans as markdown files under ~/.claude/plans/. */
const PLAN_FILE = /\/\.claude\/plans\/[^/]+\.md$/;

function applyEdit(text: string, old: unknown, next: unknown, all: unknown): string {
  if (typeof old !== "string" || typeof next !== "string" || !old) return text;
  return all ? text.split(old).join(next) : text.replace(old, () => next);
}

export function extractPlan(events: unknown[]): FoundPlan | null {
  const files = new Map<string, string>();
  let lastFile: string | null = null;
  let exit: { id: string | null; plan: string; file: string } | null = null;
  for (const ev of events) {
    const e = ev as { type?: string; message?: { content?: unknown } } | null;
    if (!e || e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message!.content as Block[]) {
      if (b?.type !== "tool_use" || !b.name) continue;
      const i = b.input ?? {};
      const path = typeof i.file_path === "string" ? i.file_path : "";
      if (PLAN_FILE.test(path)) {
        if (b.name === "Write" && typeof i.content === "string") files.set(path, i.content);
        else if (b.name === "Edit") files.set(path, applyEdit(files.get(path) ?? "", i.old_string, i.new_string, i.replace_all));
        else if (b.name === "MultiEdit" && Array.isArray(i.edits)) {
          let t = files.get(path) ?? "";
          for (const x of i.edits as Record<string, unknown>[]) t = applyEdit(t, x.old_string, x.new_string, x.replace_all);
          files.set(path, t);
        }
        lastFile = path;
      } else if (b.name === "ExitPlanMode") {
        exit = { id: b.id ?? null, plan: typeof i.plan === "string" ? i.plan : "", file: typeof i.planFilePath === "string" ? i.planFilePath : "" };
      }
    }
  }
  const fromFile = (exit?.file && files.get(exit.file)) || (lastFile ? files.get(lastFile) : "") || "";
  const plan = (exit?.plan || fromFile).trim();
  return plan ? { plan, id: exit?.id ?? null } : null;
}
