import { route } from "@/lib/server/api";

export const GET = route(async ({ c }) => {
  await c.runs.refreshTmux();
  const sessions = c.sessions.list();
  const tasks = c.tasks.list();
  const runs = c.runs.list();
  const byStatus: Record<string, number> = {};
  for (const t of tasks) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  return {
    activeProcesses: c.sessions.active(),
    counts: {
      sessions: sessions.length,
      activeSessions: sessions.filter((s) => s.active).length,
      sessionsToday: sessions.filter((s) => s.lastActivity > dayAgo).length,
      runningRuns: runs.filter((r) => r.status === "running").length,
      tasks: tasks.length,
      openTasks: tasks.filter((t) => t.status !== "done").length,
      projects: c.projects.list().length,
      costUsd: runs.reduce((a, r) => a + (r.costUsd || 0), 0),
    },
    // What Claude is doing in the most recent run that is still working.
    activity: (() => {
      const r = runs.find((x) => x.status === "running" && x.mode === "headless");
      return r ? { ...c.runs.activity(r.id), runId: r.id } : null;
    })(),
    tasksByStatus: byStatus,
    recentSessions: sessions.slice(0, 8),
    recentRuns: runs.slice(0, 6),
  };
});
