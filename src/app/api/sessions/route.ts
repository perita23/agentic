import { route } from "@/lib/server/api";

export const GET = route(({ c, url }) => {
  const q = (url.searchParams.get("q") || "").toLowerCase().slice(0, 200);
  const project = url.searchParams.get("project");
  const activeOnly = url.searchParams.get("active") === "1";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 500, 1), 5000);
  let list = c.sessions.list();
  if (project) list = list.filter((s) => s.cwd === project);
  if (activeOnly) list = list.filter((s) => s.active);
  if (q) list = list.filter((s) => `${s.title} ${s.firstPrompt ?? ""} ${s.cwd ?? ""} ${s.gitBranch ?? ""} ${s.id}`.toLowerCase().includes(q));
  return { total: list.length, sessions: list.slice(0, limit) };
});
