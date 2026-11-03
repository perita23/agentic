"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { GitBranchIcon, GitPullRequestIcon, MessageSquareIcon, SearchIcon, TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader } from "@/components/app/common";
import { ProviderIcon } from "@/components/app/provider-icon";
import { useApi } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";

export interface PullSummary {
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
  updatedAt: string | null;
  url: string;
  projectPath: string;
  comments: number | null;
}

const prHref = (p: Pick<PullSummary, "provider" | "owner" | "repo" | "number">) =>
  `/pulls/view?${new URLSearchParams({ provider: p.provider, owner: p.owner, repo: p.repo, number: String(p.number) })}`;

export default function PullsPage() {
  const { data: status } = useApi<Record<string, { configured: boolean }>>("/api/integrations");
  const anyConfigured = !!(status?.github?.configured || status?.bitbucket?.configured);
  const { data, isLoading } = useApi<{ items: PullSummary[]; errors: { repo: string; error: string }[] }>(anyConfigured ? "/api/prs" : null, { refreshInterval: 60_000 });
  const [q, setQ] = React.useState("");
  const [provider, setProvider] = React.useState<"all" | "github" | "bitbucket">("all");

  if (status && !anyConfigured)
    return (
      <div className="flex flex-col gap-5">
        <PageHeader icon={GitPullRequestIcon} title="Pull requests" description="Revisa, comenta y mergea PRs de GitHub y Bitbucket." />
        <EmptyState
          icon={GitPullRequestIcon}
          title="Conecta GitHub o Bitbucket"
          description="Añade un token en Integraciones. Se mostrarán las PRs abiertas de los repositorios de tus proyectos."
          action={
            <Button asChild size="sm">
              <Link href="/integrations">Ir a Integraciones</Link>
            </Button>
          }
        />
      </div>
    );

  const items = (data?.items ?? []).filter(
    (p) => (provider === "all" || p.provider === provider) && `${p.title} ${p.owner}/${p.repo} ${p.author} ${p.branch} #${p.number}`.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={GitPullRequestIcon} title="Pull requests" description="PRs abiertas en los repositorios de tus proyectos." />
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <SearchIcon className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input placeholder="Filtrar por título, repo, autor, rama…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex w-fit rounded-md border p-0.5" role="group" aria-label="Proveedor">
          {(["all", "github", "bitbucket"] as const).map((p) => (
            <button
              key={p}
              aria-pressed={provider === p}
              onClick={() => setProvider(p)}
              className={cn("flex cursor-pointer items-center gap-1.5 rounded px-3 py-1 text-sm", provider === p ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {p !== "all" && <ProviderIcon provider={p} className="size-3.5" />}
              {p === "all" ? "Todas" : p === "github" ? "GitHub" : "Bitbucket"}
            </button>
          ))}
        </div>
      </div>
      {data?.errors.map((e) => (
        <p key={e.repo} className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
          <TriangleAlertIcon className="size-4" /> {e.repo}: {e.error}
        </p>
      ))}
      <div className="overflow-hidden rounded-lg border bg-card">
        {isLoading && !data ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : items.length ? (
          <div className="divide-y">
            {items.map((p, i) => (
              <motion.div key={`${p.provider}:${p.owner}/${p.repo}#${p.number}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.02, 0.2) }}>
                <Link href={prHref(p)} className="group flex items-center gap-3 px-4 py-3 hover:bg-accent/60">
                  <GitPullRequestIcon className={cn("size-4 shrink-0", p.draft ? "text-muted-foreground" : "text-success")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium group-hover:text-link">{p.title}</span>
                      {p.draft && <Badge>borrador</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <ProviderIcon provider={p.provider} className="size-3" /> {p.owner}/{p.repo} #{p.number}
                      </span>
                      {p.branch && (
                        <span className="flex items-center gap-1 font-mono">
                          <GitBranchIcon className="size-3" /> {p.branch} → {p.base}
                        </span>
                      )}
                      {p.author && <span>por {p.author}</span>}
                    </div>
                  </div>
                  <div className="hidden shrink-0 items-center gap-3 text-xs text-muted-foreground sm:flex">
                    {p.comments != null && p.comments > 0 && (
                      <span className="flex items-center gap-1">
                        <MessageSquareIcon className="size-3.5" /> {p.comments}
                      </span>
                    )}
                    <span>{timeAgo(p.updatedAt)}</span>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="p-6">
            <EmptyState icon={GitPullRequestIcon} title="No hay PRs abiertas" description="Nada pendiente en los repositorios de tus proyectos." />
          </div>
        )}
      </div>
    </div>
  );
}
