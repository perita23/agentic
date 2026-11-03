"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeftIcon,
  BotIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  CircleSlashIcon,
  ExternalLinkIcon,
  FileDiffIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  ListChecksIcon,
  MessageSquareIcon,
  ThumbsUpIcon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/components/app/common";
import { FileBlock, PatchLines } from "@/components/app/diff-view";
import { useLauncher } from "@/components/app/launcher";
import { ProviderIcon } from "@/components/app/provider-icon";
import { api, refresh, useApi } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";

interface PullDetail {
  provider: "github" | "bitbucket";
  owner: string;
  repo: string;
  number: number;
  title: string;
  author: string | null;
  state: string;
  draft: boolean;
  branch: string | null;
  base: string | null;
  url: string;
  projectPath: string;
  body: string;
  headSha: string | null;
  mergeable: boolean | null;
  mergeState: string | null;
  checks: { name: string; status: "success" | "failure" | "pending" | "neutral"; url: string | null }[];
  reviews: { author: string; state: string; body: string; at: string | null }[];
  comments_: { author: string; body: string; at: string | null; path?: string | null }[];
  files: { file: string; status: string; additions: number | null; deletions: number | null; patch: string | null }[];
  canMerge: boolean;
}

const CHECK_ICON = {
  success: <CheckCircle2Icon className="size-4 text-success" />,
  failure: <XCircleIcon className="size-4 text-destructive" />,
  pending: <CircleDotIcon className="size-4 text-warning" />,
  neutral: <CircleSlashIcon className="size-4 text-muted-foreground" />,
};

const REVIEW_LABEL: Record<string, { label: string; variant: "green" | "red" | "default" }> = {
  APPROVED: { label: "aprobó", variant: "green" },
  CHANGES_REQUESTED: { label: "pidió cambios", variant: "red" },
  COMMENTED: { label: "comentó", variant: "default" },
};

function TimelineItem({ author, at, children, badge }: { author: string; at: string | null; children?: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{author}</span>
        {badge}
        <span className="ml-auto">{timeAgo(at)}</span>
      </div>
      {children && <div className="px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words">{children}</div>}
    </div>
  );
}

function PullView() {
  const params = useSearchParams();
  const provider = params.get("provider") ?? "";
  const owner = params.get("owner") ?? "";
  const repo = params.get("repo") ?? "";
  const number = params.get("number") ?? "";
  const base = `/api/prs/${encodeURIComponent(provider)}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(number)}`;
  const { data: pr, error } = useApi<PullDetail>(provider ? base : null, { refreshInterval: 30_000 });
  const launcher = useLauncher();
  const [comment, setComment] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<null | "changes" | "merge" | "close">(null);
  const [mergeMethod, setMergeMethod] = React.useState("squash");
  const [reviewBody, setReviewBody] = React.useState("");

  async function act(action: string, body: unknown, ok: string) {
    setBusy(action);
    try {
      await api("POST", `${base}/${action}`, body);
      toast.success(ok);
      setDialog(null);
      refresh(base, "/api/prs");
      return true;
    } catch (e) {
      toast.error("La acción falló", { description: errorMessage(e) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!pr)
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64" />
      </div>
    );

  const open = pr.state === "open";
  const failing = pr.checks.filter((c) => c.status === "failure").length;
  const pending = pr.checks.filter((c) => c.status === "pending").length;
  const timeline = [
    ...pr.reviews.map((r) => ({ kind: "review" as const, ...r })),
    ...pr.comments_.map((c) => ({ kind: "comment" as const, ...c })),
  ].sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  const providerName = pr.provider === "github" ? "GitHub" : "Bitbucket";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 border-b pb-4">
        <Link href="/pulls" className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-3" /> Pull requests
        </Link>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">
              {pr.title} <span className="font-normal text-muted-foreground">#{pr.number}</span>
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={pr.state === "merged" ? "purple" : open ? (pr.draft ? "default" : "green") : "red"}>
                {pr.state === "merged" ? "mergeada" : open ? (pr.draft ? "borrador" : "abierta") : "cerrada"}
              </Badge>
              <span className="flex items-center gap-1">
                <ProviderIcon provider={pr.provider} className="size-3" /> {pr.owner}/{pr.repo}
              </span>
              {pr.branch && (
                <span className="flex items-center gap-1 font-mono">
                  <GitBranchIcon className="size-3" /> {pr.branch} → {pr.base}
                </span>
              )}
              {pr.author && <span>por {pr.author}</span>}
              {pr.checks.length > 0 && (
                <span className={cn("flex items-center gap-1", failing ? "text-destructive" : pending ? "text-warning" : "text-success")}>
                  <ListChecksIcon className="size-3.5" /> {failing ? `${failing} checks fallan` : pending ? `${pending} checks en curso` : "checks OK"}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {/^https?:\/\//.test(pr.url) && (
              <Button variant="outline" asChild>
                <a href={pr.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLinkIcon /> {providerName}
                </a>
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() =>
                launcher.open({
                  projectPath: pr.projectPath,
                  title: `Revisar PR #${pr.number} con Claude`,
                  prompt: `Revisa la pull request #${pr.number} «${pr.title}» (${pr.url}), rama ${pr.branch} contra ${pr.base}. Usa git para ver el diff (${pr.base}...${pr.branch}). Busca bugs, problemas de seguridad, casos límite y tests que falten. Devuelve una lista priorizada de hallazgos con fichero y línea. No modifiques código.`,
                })
              }
            >
              <BotIcon /> Revisar con Claude
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Tabs defaultValue="conversation" className="min-w-0">
          <TabsList>
            <TabsTrigger value="conversation">
              <MessageSquareIcon /> Conversación <span className="text-xs text-muted-foreground">{timeline.length}</span>
            </TabsTrigger>
            <TabsTrigger value="files">
              <FileDiffIcon /> Archivos <span className="text-xs text-muted-foreground">{pr.files.length}</span>
            </TabsTrigger>
            <TabsTrigger value="checks">
              <ListChecksIcon /> Checks <span className="text-xs text-muted-foreground">{pr.checks.length}</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="conversation" className="flex flex-col gap-3">
            <TimelineItem author={pr.author ?? "?"} at={null} badge={<span>abrió la PR</span>}>
              {pr.body || <span className="text-muted-foreground italic">Sin descripción.</span>}
            </TimelineItem>
            {timeline.map((t, i) =>
              t.kind === "review" ? (
                <TimelineItem
                  key={i}
                  author={t.author}
                  at={t.at}
                  badge={<Badge variant={REVIEW_LABEL[t.state]?.variant ?? "default"}>{REVIEW_LABEL[t.state]?.label ?? t.state.toLowerCase()}</Badge>}
                >
                  {t.body || null}
                </TimelineItem>
              ) : (
                <TimelineItem key={i} author={t.author} at={t.at} badge={t.path ? <span className="font-mono">{t.path}</span> : undefined}>
                  {t.body}
                </TimelineItem>
              ),
            )}
            {open && (
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <Label htmlFor="pr-comment">Añadir comentario</Label>
                <Textarea id="pr-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Escribe un comentario…" />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={!comment.trim() || busy === "comment"}
                    onClick={async () => {
                      if (await act("comment", { body: comment }, "Comentario publicado")) setComment("");
                    }}
                  >
                    Comentar
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="files" className="flex flex-col gap-3">
            {pr.files.map((f) => (
              <FileBlock
                key={f.file}
                title={f.file}
                defaultOpen={pr.files.length <= 8}
                badge={<Badge>{f.status}</Badge>}
                stats={
                  f.additions != null && (
                    <span className="font-mono text-xs tabular-nums">
                      <span className="text-success">+{f.additions}</span> <span className="text-destructive">−{f.deletions}</span>
                    </span>
                  )
                }
              >
                {f.patch ? <PatchLines lines={f.patch.split("\n")} /> : <p className="px-3 py-2 text-xs text-muted-foreground">Diff no disponible (binario o demasiado grande).</p>}
              </FileBlock>
            ))}
            {!pr.files.length && <p className="text-sm text-muted-foreground">Sin cambios de ficheros.</p>}
          </TabsContent>

          <TabsContent value="checks">
            <Card className="py-2">
              <CardContent className="divide-y px-0">
                {pr.checks.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 px-4 py-2 text-sm">
                    {CHECK_ICON[c.status]}
                    <span className="flex-1 truncate">{c.name}</span>
                    {c.url && /^https?:\/\//.test(c.url) && (
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-xs text-link hover:underline">
                        detalles
                      </a>
                    )}
                  </div>
                ))}
                {!pr.checks.length && <p className="px-4 py-3 text-sm text-muted-foreground">Esta PR no tiene checks.</p>}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <aside className="flex flex-col gap-3">
          {open ? (
            <Card>
              <CardContent className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">Review</p>
                <Button variant="outline" disabled={busy === "review"} onClick={() => act("review", { event: "APPROVE", body: "" }, "PR aprobada")}>
                  <ThumbsUpIcon /> Aprobar
                </Button>
                <Button variant="outline" onClick={() => setDialog("changes")}>
                  <XCircleIcon /> Pedir cambios
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">Resolver</p>
                <Button onClick={() => setDialog("merge")} disabled={!pr.canMerge || !pr.headSha}>
                  <GitMergeIcon /> Mergear
                </Button>
                {!pr.canMerge && <p className="text-xs text-muted-foreground">{pr.draft ? "Es un borrador." : pr.mergeable === false ? "Tiene conflictos." : "No se puede mergear ahora."}</p>}
                {failing > 0 && pr.canMerge && <p className="text-xs text-warning">Atención: {failing} checks fallan.</p>}
                <Button variant="destructive" onClick={() => setDialog("close")}>
                  <GitPullRequestClosedIcon /> {pr.provider === "github" ? "Cerrar" : "Rechazar (decline)"}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-muted-foreground">Esta PR ya no está abierta.</p>
          )}
        </aside>
      </div>

      <Dialog open={dialog === "changes"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pedir cambios</DialogTitle>
            <DialogDescription>Explica qué hay que cambiar antes de mergear.</DialogDescription>
          </DialogHeader>
          <Textarea rows={5} value={reviewBody} onChange={(e) => setReviewBody(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancelar
            </Button>
            <Button
              disabled={!reviewBody.trim() || busy === "review"}
              onClick={async () => {
                if (await act("review", { event: "REQUEST_CHANGES", body: reviewBody }, "Cambios solicitados")) setReviewBody("");
              }}
            >
              Enviar review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "merge"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mergear #{pr.number}</DialogTitle>
            <DialogDescription>
              {pr.branch} → {pr.base} en {pr.owner}/{pr.repo}. Si la PR cambia mientras tanto, el merge se rechazará.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label>Método</Label>
            <Select value={mergeMethod} onValueChange={setMergeMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="squash">Squash and merge</SelectItem>
                <SelectItem value="merge">Merge commit</SelectItem>
                <SelectItem value="rebase">{pr.provider === "github" ? "Rebase and merge" : "Fast-forward"}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {failing > 0 && <p className="text-sm text-warning">{failing} checks están fallando.</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancelar
            </Button>
            <Button disabled={busy === "merge"} onClick={() => act("merge", { method: mergeMethod, expectedHeadSha: pr.headSha }, `PR #${pr.number} mergeada`)}>
              <GitMergeIcon /> Confirmar merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "close"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pr.provider === "github" ? "Cerrar" : "Rechazar"} #{pr.number}</DialogTitle>
            <DialogDescription>La PR quedará cerrada sin mergear.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={busy === "close"} onClick={() => act("close", {}, "PR cerrada")}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PullViewPage() {
  return (
    <React.Suspense>
      <PullView />
    </React.Suspense>
  );
}
