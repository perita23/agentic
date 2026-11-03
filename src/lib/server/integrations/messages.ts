import path from "node:path";
import type { QueueState } from "../queue";
import type { Run } from "../runs";

/** Escape Slack mrkdwn control characters in text that comes from user data. */
export const slackEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const ICON: Record<string, string> = { completed: "✅", stopped: "⏹️", failed: "❌", interrupted: "⚠️" };

export function runMessage(run: Run): string {
  const cost = run.costUsd != null ? ` · $${run.costUsd.toFixed(4)}` : "";
  const prompt = run.prompt.split("\n")[0].slice(0, 200) || "sesión interactiva";
  return `${ICON[run.status] ?? "•"} *Agentic* · ejecución ${run.status} en \`${slackEscape(path.basename(run.projectPath))}\`${cost}\n>${slackEscape(prompt)}`;
}

export function queueMessage(st: QueueState): string {
  const ok = st.processed.filter((p) => p.status === "completed").length;
  return `🧵 *Agentic* · cola finalizada: ${ok}/${st.processed.length} tareas completadas\n>${slackEscape(st.stopReason ?? "")}`;
}
