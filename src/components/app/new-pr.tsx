"use client";

import * as React from "react";
import { GitPullRequestIcon, PlusIcon, SparklesIcon, SquareIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, refresh, useApi } from "@/lib/api";
import { parseDescription } from "@/lib/pr-description";
import { baseName } from "@/lib/utils";
import { LiquidOrb } from "./liquid-orb";
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
  const [reviewersSel, setReviewersSel] = React.useState<string[] | null>(null);
  const [reviewerFilter, setReviewerFilter] = React.useState("");
  const [body, setBody] = React.useState("");
  const [draft, setDraft] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [generating, setGenerating] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  const project = projectSel ?? repos[0]?.projectPath ?? "";
  const { data: info, error: infoError } = useApi<Branches>(project ? `/api/prs/branches?project=${encodeURIComponent(project)}` : null);

  const { data: rdata } = useApi<{ reviewers: { id: string; name: string; isDefault: boolean }[] }>(project ? `/api/prs/reviewers?project=${encodeURIComponent(project)}` : null, { revalidateOnFocus: false });
  const candidates = rdata?.reviewers ?? [];
  // Default reviewers of the repository start selected.
  const reviewers = reviewersSel ?? candidates.filter((r) => r.isDefault).map((r) => r.id);

  // Defaults: the current branch if it has work, else the newest branch that does.
  const withWork = info?.branches.filter((b) => b.ahead > 0) ?? [];
  const defaultHead = (withWork.find((b) => b.name === info?.current) ?? withWork[0])?.name ?? "";
  const head = headSel ?? defaultHead;
  const base = baseSel ?? info?.base ?? "";
  const headInfo = info?.branches.find((b) => b.name === head);
  const title = titleSel ?? headInfo?.subject ?? "";

  // Closing the dialog stops a generation in progress.
  React.useEffect(() => () => abortRef.current?.abort(), []);

  /** Claude writes title and description from the commits and diff; the text streams into the fields as it is written. */
  async function generate() {
    const ac = new AbortController();
    abortRef.current = ac;
    const backup = { title: titleSel, body };
    setGenerating(true);
    setError("");
    setBody("");
    let acc = "";
    try {
      const res = await fetch("/api/prs/describe", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectPath: project, head, base }), signal: ac.signal });
      if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo generar la descripción");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(frame)?.[1];
          const data = /^data: (.*)$/m.exec(frame)?.[1];
          if (!ev || !data) continue;
          const payload = JSON.parse(data) as { text?: string; message?: string };
          if (ev === "error") throw new Error(payload.message ?? "No se pudo generar la descripción");
          if (ev === "text" && payload.text) {
            acc += payload.text;
            const parsed = parseDescription(acc);
            setBody(parsed.body);
            if (parsed.title) setTitleSel(parsed.title);
          }
        }
      }
    } catch (e) {
      if (ac.signal.aborted) return; // stopped by the user: what was written stays
      setTitleSel(backup.title);
      setBody(backup.body);
      setError(errorMessage(e));
    } finally {
      abortRef.current = null;
      setGenerating(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const pr = await api<{ provider: "github" | "bitbucket"; number: number; url: string; reviewerError?: string }>("POST", "/api/prs", { projectPath: project, head, base, title, body, draft, reviewers });
      refresh("/api/prs");
      toast.success(`PR #${pr.number} creada`, { description: `${head} → ${base}`, action: pr.url ? { label: "Abrir", onClick: () => window.open(pr.url, "_blank", "noopener,noreferrer") } : undefined });
      if (pr.reviewerError) toast.warning("La PR se creó, pero no se pudieron añadir los revisores", { description: pr.reviewerError });
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
              <select id="pr-project" className={select} value={project} onChange={(e) => { setProjectSel(e.target.value); setHeadSel(null); setBaseSel(null); setTitleSel(null); setReviewersSel(null); }}>
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
                <div className="flex items-center gap-2 rounded-lg border bg-inset px-3 py-2">
                  {generating ? <LiquidOrb state="writing" size={28} /> : <SparklesIcon className="size-4 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 text-xs text-muted-foreground">{generating ? "Claude está escribiendo el título y la descripción…" : "Claude puede redactar el título y la descripción a partir de los commits y el diff."}</span>
                  {generating ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => abortRef.current?.abort()}>
                      <SquareIcon /> Parar
                    </Button>
                  ) : (
                    <Button type="button" size="sm" variant="outline" disabled={!head || !base || !headInfo?.ahead} onClick={() => void generate()}>
                      <SparklesIcon /> Generar con Claude
                    </Button>
                  )}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="pr-title">Título</Label>
                  <div className={generating ? "orb-border" : ""}>
                    <Input id="pr-title" value={title} onChange={(e) => setTitleSel(e.target.value)} maxLength={250} required readOnly={generating} />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="pr-body">Descripción</Label>
                  <div className={generating ? "orb-border" : ""}>
                    <textarea id="pr-body" value={body} onChange={(e) => setBody(e.target.value)} rows={8} readOnly={generating} className="w-full resize-y rounded-md border bg-inset p-2.5 text-sm" placeholder={generating ? "" : "Qué cambia y por qué (Markdown)"} />
                  </div>
                </div>
                {candidates.length > 0 && (
                  <fieldset className="grid gap-1.5">
                    <legend className="mb-1 flex items-center gap-2 text-sm font-medium">Revisores <span className="text-xs font-normal text-muted-foreground">{reviewers.length ? `${reviewers.length} elegidos` : "ninguno"}</span></legend>
                    {candidates.length > 6 && <Input aria-label="Buscar revisor" placeholder="Buscar persona…" value={reviewerFilter} onChange={(e) => setReviewerFilter(e.target.value)} className="h-8" />}
                    <div className="grid max-h-36 gap-0.5 overflow-y-auto rounded-md border bg-inset p-1.5">
                      {candidates.filter((r) => r.name.toLowerCase().includes(reviewerFilter.toLowerCase())).map((r) => (
                        <label key={r.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent/50">
                          <input type="checkbox" className="accent-primary" checked={reviewers.includes(r.id)} onChange={(e) => setReviewersSel(e.target.checked ? [...reviewers, r.id] : reviewers.filter((x) => x !== r.id))} />
                          <span className="min-w-0 truncate">{r.name}</span>
                          {r.isDefault && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">por defecto</span>}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
                <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} className="accent-primary" /> Crear como borrador</label>
              </>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy || generating || !head || !base || !title.trim()}>
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
