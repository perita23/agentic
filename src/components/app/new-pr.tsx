"use client";

import * as React from "react";
import { GitPullRequestIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, refresh, useApi } from "@/lib/api";
import { baseName } from "@/lib/utils";
import { errorMessage } from "./common";

interface Branches {
  repo: { provider: "github" | "bitbucket"; owner: string; repo: string };
  branches: { name: string; ahead: number; subject: string }[];
  current: string | null;
  base: string;
  dirty: number;
}

function NewPrDialog({ onClose }: { onClose: () => void }) {
  const { data: reposData } = useApi<{ repos: { provider: string; owner: string; repo: string; projectPath: string }[] }>("/api/prs/repos");
  const repos = reposData?.repos ?? [];
  // Choices the user made; everything else is derived (no state syncing in effects).
  const [projectSel, setProjectSel] = React.useState<string | null>(null);
  const [headSel, setHeadSel] = React.useState<string | null>(null);
  const [baseSel, setBaseSel] = React.useState<string | null>(null);
  const [titleSel, setTitleSel] = React.useState<string | null>(null);
  const [body, setBody] = React.useState("");
  const [draft, setDraft] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const project = projectSel ?? repos[0]?.projectPath ?? "";
  const { data: info, error: infoError } = useApi<Branches>(project ? `/api/prs/branches?project=${encodeURIComponent(project)}` : null);

  // Defaults: the current branch if it has work, else the newest branch that does.
  const withWork = info?.branches.filter((b) => b.ahead > 0) ?? [];
  const defaultHead = (withWork.find((b) => b.name === info?.current) ?? withWork[0])?.name ?? "";
  const head = headSel ?? defaultHead;
  const base = baseSel ?? info?.base ?? "";
  const headInfo = info?.branches.find((b) => b.name === head);
  const title = titleSel ?? headInfo?.subject ?? "";

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const pr = await api<{ provider: "github" | "bitbucket"; number: number; url: string }>("POST", "/api/prs", { projectPath: project, head, base, title, body, draft });
      refresh("/api/prs");
      toast.success(`PR #${pr.number} creada`, { description: `${head} → ${base}`, action: pr.url ? { label: "Abrir", onClick: () => window.open(pr.url, "_blank", "noopener,noreferrer") } : undefined });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const select = "h-9 w-full rounded-md border bg-inset px-2 text-sm";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nueva pull request</DialogTitle>
          <DialogDescription>Agentic sube la rama a «origin» y abre la PR con tu cuenta conectada.</DialogDescription>
        </DialogHeader>
        {!reposData ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : !repos.length ? (
          <p className="text-sm text-muted-foreground">Ningún proyecto tiene un remoto «origin» en GitHub o Bitbucket conectado. Añade el proyecto y conecta la cuenta en Integraciones.</p>
        ) : (
          <form onSubmit={create} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pr-project">Proyecto</Label>
              <select id="pr-project" className={select} value={project} onChange={(e) => { setProjectSel(e.target.value); setHeadSel(null); setBaseSel(null); setTitleSel(null); }}>
                {repos.map((r) => (
                  <option key={r.projectPath} value={r.projectPath}>
                    {baseName(r.projectPath)} · {r.owner}/{r.repo}
                  </option>
                ))}
              </select>
            </div>
            {infoError && <p className="text-sm text-destructive">{errorMessage(infoError)}</p>}
            {info && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="pr-head">Rama con los cambios</Label>
                    <select id="pr-head" className={select} value={head} onChange={(e) => { setHeadSel(e.target.value); setTitleSel(null); }}>
                      {!head && <option value="">Elige una rama…</option>}
                      {info.branches.filter((b) => b.name !== base).map((b) => (
                        <option key={b.name} value={b.name}>
                          {b.name}{b.ahead ? ` (+${b.ahead})` : " (sin cambios)"}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="pr-base">Hacia</Label>
                    <select id="pr-base" className={select} value={base} onChange={(e) => setBaseSel(e.target.value)}>
                      {info.branches.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
                    </select>
                  </div>
                </div>
                {!info.branches.some((b) => b.ahead > 0) && <p className="text-xs text-muted-foreground">Ninguna rama tiene commits nuevos respecto a «{info.base}»: haz commit de tus cambios en una rama.</p>}
                {info.dirty > 0 && (
                  <p className="flex items-center gap-1.5 text-xs text-warning">
                    <TriangleAlertIcon className="size-3.5" /> Hay {info.dirty} cambios sin commit: la PR sólo incluye lo que ya está en commits.
                  </p>
                )}
                <div className="grid gap-1.5">
                  <Label htmlFor="pr-title">Título</Label>
                  <Input id="pr-title" value={title} onChange={(e) => setTitleSel(e.target.value)} maxLength={250} required />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="pr-body">Descripción</Label>
                  <textarea id="pr-body" value={body} onChange={(e) => setBody(e.target.value)} rows={5} className="w-full resize-y rounded-md border bg-inset p-2.5 text-sm" placeholder="Qué cambia y por qué (Markdown)" />
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} className="accent-primary" /> Crear como borrador</label>
              </>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy || !head || !base || !title.trim()}>
              <GitPullRequestIcon /> {busy ? "Subiendo y creando…" : "Crear pull request"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function NewPrButton() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon /> Nueva PR
      </Button>
      {open && <NewPrDialog onClose={() => setOpen(false)} />}
    </>
  );
}
