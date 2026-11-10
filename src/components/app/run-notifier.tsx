"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { refresh, useApi, type Run } from "@/lib/api";
import { notificationsEnabled } from "@/lib/notify";
import { baseName } from "@/lib/utils";

const LABEL: Record<string, string> = { completed: "completada", failed: "fallida", stopped: "detenida", interrupted: "interrumpida" };

/** Watches runs and notifies (toast + optional desktop notification) when one finishes. */
export function RunNotifier() {
  const router = useRouter();
  const { data } = useApi<{ runs: Run[] }>("/api/runs", { refreshInterval: 4000 });
  const seen = React.useRef<Map<string, Run["status"]> | null>(null);
  const mountedAt = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!data) return;
    const prev = seen.current;
    const next = new Map(data.runs.map((r) => [r.id, r.status]));
    seen.current = next;
    if (!prev) {
      // First load: remember what exists so we never notify about historical runs.
      mountedAt.current = new Date().toISOString();
      return;
    }
    for (const r of data.runs) {
      if (r.status === "running") continue;
      const wasRunning = prev.get(r.id) === "running";
      // Runs shorter than the poll interval are never observed as running.
      const newAndFinished = !prev.has(r.id) && !!mountedAt.current && r.startedAt >= mountedAt.current;
      if (!wasRunning && !newAndFinished) continue;
      const title = `Ejecución ${LABEL[r.status] ?? r.status}`;
      const body = `${baseName(r.projectPath)} · ${(r.title || r.prompt.split("\n")[0] || "sesión interactiva").slice(0, 100)}`;
      const open = () => router.push(`/runs/${r.id}`);
      (r.status === "completed" ? toast.success : toast.error)(title, { description: body, action: { label: "Ver", onClick: open } });
      if (notificationsEnabled() && document.visibilityState !== "visible") {
        try {
          // The system notification never carries the prompt: it is shown on the lock
          // screen and kept in Notification Center.
          const n = new Notification(`Agentic · ${title}`, { body: baseName(r.projectPath), tag: r.id, silent: false });
          n.onclick = () => {
            window.focus();
            open();
            n.close();
          };
        } catch {}
      }
      refresh("/api/overview", "/api/tasks", `/api/runs/${r.id}`);
    }
  }, [data, router]);

  return null;
}
