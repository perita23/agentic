import type { Run } from "@/lib/api";

/** The name of a run: what the person called it, else the first line of the prompt. */
export function runTitle(r: Pick<Run, "title" | "prompt" | "mode">): string {
  return r.title?.trim() || r.prompt.split("\n")[0]?.trim() || (r.mode === "tmux" ? "Sesión interactiva" : "(sin prompt)");
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);

/**
 * One row per conversation: the first run, with the status of its latest reply, and `activityAt`: the last time anything
 * happened in it (a reply started or ended) or the person opened it. Newest use first.
 */
export function collapseThreads(runs: Run[]): (Run & { messages: number; activityAt: number })[] {
  const byThread = new Map<string, Run[]>();
  for (const r of runs) if (r.threadId) byThread.set(r.threadId, [...(byThread.get(r.threadId) ?? []), r]);
  return runs
    .filter((r) => !r.threadId)
    .map((r) => {
      const replies = byThread.get(r.id) ?? [];
      const latest = [...replies, r].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
      const activityAt = Math.max(...[r, ...replies].flatMap((x) => [ms(x.startedAt), ms(x.endedAt), ms(x.lastOpenedAt)]));
      return { ...r, status: latest.status, messages: replies.length + 1, activityAt };
    })
    .sort((a, b) => b.activityAt - a.activityAt);
}
