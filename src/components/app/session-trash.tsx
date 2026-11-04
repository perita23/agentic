"use client";

import * as React from "react";
import { ArchiveRestoreIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, refresh, useApi } from "@/lib/api";
import { baseName, formatBytes, timeAgo } from "@/lib/utils";
import { errorMessage } from "./common";

interface TrashItem {
  id: string;
  title: string;
  cwd: string | null;
  deletedAt: string;
  sizeBytes: number;
}

async function restore(ids: string[]) {
  for (const id of ids) await api("POST", "/api/trash/restore", { id });
  refresh("/api/sessions", "/api/trash", "/api/overview", "/api/library");
}

/**
 * Move sessions to the trash (restorable for 30 days). Running sessions are skipped.
 * Returns the ids that were removed.
 */
export async function deleteSessions(ids: string[]): Promise<string[]> {
  try {
    const res = await api<{ removed: string[]; skipped: { id: string; reason: string }[] }>("POST", "/api/sessions/delete", { ids });
    refresh("/api/sessions", "/api/trash", "/api/overview", "/api/library");
    if (res.removed.length) {
      toast.success(res.removed.length === 1 ? "Sesión movida a la papelera" : `${res.removed.length} sesiones movidas a la papelera`, {
        description: "Puedes recuperarlas durante 30 días.",
        action: {
          label: "Deshacer",
          onClick: () => restore(res.removed).then(
            () => toast.success("Restauradas"),
            (e) => toast.error("No se pudo restaurar", { description: errorMessage(e) }),
          ),
        },
      });
    }
    if (res.skipped.length) toast.error(`${res.skipped.length} sin borrar`, { description: res.skipped[0].reason });
    return res.removed;
  } catch (e) {
    toast.error("No se pudo borrar", { description: errorMessage(e) });
    return [];
  }
}

/** Button + dialog with the deleted sessions: restore, erase for good, empty. */
export function TrashButton() {
  const { data } = useApi<{ items: TrashItem[] }>("/api/trash", { refreshInterval: 30_000 });
  const [open, setOpen] = React.useState(false);
  const items = data?.items ?? [];

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      refresh("/api/sessions", "/api/trash", "/api/overview", "/api/library");
      toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Trash2Icon /> Papelera{items.length > 0 && <span className="ml-0.5 text-xs text-muted-foreground tabular-nums">{items.length}</span>}
      </Button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Papelera de sesiones</DialogTitle>
              <DialogDescription>Las sesiones borradas se guardan 30 días y luego se eliminan solas. Aquí puedes recuperarlas.</DialogDescription>
            </DialogHeader>
            {!items.length ? (
              <p className="py-6 text-center text-sm text-muted-foreground">La papelera está vacía.</p>
            ) : (
              <div className="scroll-area grid gap-1.5">
                {items.map((i) => (
                  <div key={i.id} className="flex min-w-0 items-center gap-2 rounded-md border px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{i.title}</div>
                      <div className="flex gap-3 text-xs text-muted-foreground">
                        {i.cwd && <span className="truncate font-mono">{baseName(i.cwd)}</span>}
                        <span>borrada {timeAgo(i.deletedAt)}</span>
                        <span className="tabular-nums">{formatBytes(i.sizeBytes)}</span>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => act(() => restore([i.id]), "Sesión restaurada")}>
                      <ArchiveRestoreIcon /> Restaurar
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Eliminar «${i.title}» para siempre`}
                      className="hover:text-destructive"
                      onClick={() => confirm(`¿Eliminar «${i.title}» para siempre? No se podrá recuperar.`) && act(() => api("POST", "/api/trash/purge", { id: i.id }), "Eliminada para siempre")}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {items.length > 0 && (
              <Button variant="destructive" className="w-fit" onClick={() => confirm(`¿Vaciar la papelera (${items.length} sesiones)? No se podrán recuperar.`) && act(() => api("POST", "/api/trash/purge", { all: true }), "Papelera vaciada")}>
                <Trash2Icon /> Vaciar papelera
              </Button>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
