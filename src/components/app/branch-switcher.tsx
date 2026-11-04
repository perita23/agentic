"use client";

import * as React from "react";
import { CheckIcon, ChevronDownIcon, GitBranchIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { api, refresh, useApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { errorMessage } from "./common";

interface BranchInfo {
  isRepo: boolean;
  current: string | null;
  detached: boolean;
  local: string[];
  remote: string[];
  dirty: number;
}

/** Which branch the project is on, with a menu to move to another one (or create one). */
export function BranchSwitcher({ project, disabled, disabledReason }: { project: string; disabled?: boolean; disabledReason?: string }) {
  const { data, mutate } = useApi<BranchInfo>(`/api/git/branches?project=${encodeURIComponent(project)}`, { refreshInterval: 10_000 });
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!data?.isRepo) return null;
  const ql = q.trim().toLowerCase();
  const local = data.local.filter((b) => b.toLowerCase().includes(ql));
  const remote = data.remote.filter((b) => b.toLowerCase().includes(ql));
  const exists = data.local.includes(q.trim()) || data.remote.includes(q.trim());
  const canCreate = !!q.trim() && !exists && /^[A-Za-z0-9][\w./-]*$/.test(q.trim()) && !q.includes("..");

  async function go(branch: string, create = false) {
    setBusy(true);
    try {
      await api("POST", "/api/git/switch", { project, branch, create });
      toast.success(create ? `Rama «${branch}» creada` : `Ahora estás en «${branch}»`);
      setOpen(false);
      setQ("");
      await mutate();
      refresh("/api/projects", "/api/runs", "/api/overview");
    } catch (e) {
      toast.error("No se pudo cambiar de rama", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const row = "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-60";
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        disabled={disabled}
        title={disabled ? disabledReason : "Cambiar de rama"}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 max-w-56 cursor-pointer items-center gap-1.5 rounded-md border bg-inset px-2.5 font-mono text-xs hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{data.current ?? "—"}</span>
        {data.dirty > 0 && <span className="shrink-0 rounded bg-warning/15 px-1 text-[10px] text-warning" title={`${data.dirty} archivos con cambios sin commit`}>{data.dirty}</span>}
        <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div role="listbox" aria-label="Ramas" className="absolute bottom-full left-0 z-30 mb-1.5 w-72 overflow-hidden rounded-lg border bg-popover p-1.5 shadow-xl">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar o crear una rama…" aria-label="Buscar rama" className="mb-1 h-8 w-full rounded-md border bg-inset px-2 text-sm" />
          <div className="max-h-64 overflow-y-auto">
            {canCreate && (
              <button type="button" disabled={busy} onClick={() => void go(q.trim(), true)} className={cn(row, "text-link")}>
                <PlusIcon className="size-3.5" /> Crear y cambiar a «{q.trim()}»
              </button>
            )}
            {local.map((b) => (
              <button key={b} type="button" role="option" aria-selected={b === data.current} disabled={busy} onClick={() => b !== data.current && void go(b)} className={row}>
                <CheckIcon className={cn("size-3.5 shrink-0", b === data.current ? "text-success" : "opacity-0")} />
                <span className="min-w-0 truncate font-mono">{b}</span>
              </button>
            ))}
            {remote.length > 0 && <div className="mt-1 px-2.5 py-1 text-[10px] tracking-wide text-muted-foreground uppercase">En el remoto (origin)</div>}
            {remote.map((b) => (
              <button key={`r:${b}`} type="button" role="option" aria-selected={false} disabled={busy} onClick={() => void go(b)} className={row}>
                <span className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate font-mono text-muted-foreground">{b}</span>
              </button>
            ))}
            {!local.length && !remote.length && !canCreate && <p className="px-2.5 py-2 text-xs text-muted-foreground">Ninguna rama coincide.</p>}
          </div>
          {data.dirty > 0 && <p className="mt-1 border-t px-2.5 pt-1.5 text-[11px] text-muted-foreground">Hay {data.dirty} archivos sin commit: viajan contigo; si chocaran con la otra rama, git no cambia nada.</p>}
        </div>
      )}
    </div>
  );
}
