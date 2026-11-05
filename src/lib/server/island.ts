import type { OrbState } from "@/lib/orb-state";
import type { RunManager, Run } from "./runs";

/** What the island at the top of the screen shows: runs in progress, and runs that ended a moment ago. */
export interface IslandRun {
  id: string;
  title: string;
  project: string;
  state: OrbState;
  label: string;
  startedAt: string;
  endedAt: string | null;
  /** Where "Abrir" goes. */
  href: string;
}
export interface IslandSnapshot {
  running: IslandRun[];
  recent: IslandRun[];
}

const RECENT_MS = 120_000;

function title(r: Run): string {
  const t = r.prompt.replace(/\s+/g, " ").trim();
  return t.length > 70 ? `${t.slice(0, 69)}…` : t || "Ejecución";
}

export function islandSnapshot(runs: RunManager, now = Date.now()): IslandSnapshot {
  const row = (r: Run): IslandRun => {
    const a = runs.activity(r.id);
    const failed = r.status === "failed";
    return {
      id: r.id,
      title: title(r),
      project: r.projectPath.split("/").filter(Boolean).pop() ?? "",
      state: failed ? "error" : a.state,
      label: failed ? "Ha fallado" : a.label,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      href: `/runs/${r.threadId ?? r.id}`,
    };
  };
  const all = runs.list().filter((r) => r.mode === "headless");
  return {
    running: all.filter((r) => r.status === "running").map(row),
    // A run you stopped yourself needs no notice.
    recent: all.filter((r) => (r.status === "completed" || r.status === "failed") && r.endedAt && now - Date.parse(r.endedAt) < RECENT_MS).map(row),
  };
}
