import { route } from "@/lib/server/api";

export const GET = route(({ c, url }) => {
  const state = c.queue.state();
  const project = url.searchParams.get("project") ?? state.config?.projectPath ?? null;
  return { ...state, pending: c.queue.pending(project).map((t) => ({ id: t.id, title: t.title, priority: t.priority, projectPath: t.projectPath })) };
});
