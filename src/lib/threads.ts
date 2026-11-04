import type { Run } from "@/lib/api";

/** One row per conversation: the first run, with the status of its latest reply. Input: newest first. */
export function collapseThreads(runs: Run[]): (Run & { messages: number })[] {
  const byThread = new Map<string, Run[]>();
  for (const r of runs) if (r.threadId) byThread.set(r.threadId, [...(byThread.get(r.threadId) ?? []), r]);
  return runs
    .filter((r) => !r.threadId)
    .map((r) => {
      const replies = byThread.get(r.id) ?? [];
      const latest = [...replies, r].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
      return { ...r, status: latest.status, messages: replies.length + 1 };
    });
}
