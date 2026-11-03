"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { FolderGit2Icon, PinIcon, PlusIcon, SearchIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader, StatusDot } from "@/components/app/common";
import { AddProjectDialog, PROJECT_COLORS } from "@/components/app/projects";
import { useApi, type ProjectListItem } from "@/lib/api";
import { cn, shortPath, timeAgo } from "@/lib/utils";

export default function ProjectsPage() {
  const { data } = useApi<{ projects: ProjectListItem[] }>("/api/projects", { refreshInterval: 10_000 });
  const [q, setQ] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const list = (data?.projects ?? []).filter((p) => `${p.name} ${p.path} ${p.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={FolderGit2Icon}
        title="Proyectos"
        description="Detectados desde tus sesiones de Claude Code o registrados manualmente."
        actions={
          <Button onClick={() => setAdding(true)}>
            <PlusIcon /> Registrar proyecto
          </Button>
        }
      />
      <div className="relative">
        <SearchIcon className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
        <Input placeholder="Buscar proyectos…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={FolderGit2Icon} title="No hay proyectos" description="Usa Claude Code en alguna carpeta o registra una ruta manualmente." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((p, i) => (
            <motion.div key={p.path} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }}>
              <Link
                href={`/projects/view?path=${encodeURIComponent(p.path)}`}
                className={cn("group relative flex h-full flex-col gap-3 overflow-hidden rounded-lg border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-border-strong", !p.exists && "opacity-60")}
              >
                <div className={cn("absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r to-transparent", PROJECT_COLORS[p.color] ?? PROJECT_COLORS.blue)} />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-semibold group-hover:text-link">
                      {p.pinned && <PinIcon className="size-3.5 text-warning" />}
                      <span className="truncate">{p.name}</span>
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">{shortPath(p.path)}</div>
                  </div>
                  {p.activeSessions > 0 && (
                    <Badge variant="green">
                      <StatusDot status="idle" className="size-1.5" /> {p.activeSessions} activa{p.activeSessions > 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
                {p.description && <p className="line-clamp-2 text-sm text-muted-foreground">{p.description}</p>}
                <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{p.sessionCount} sesiones</span>
                  <span>·</span>
                  <span>{timeAgo(p.lastActivity)}</span>
                  {!p.exists && <Badge variant="red">no existe</Badge>}
                  {p.registered && <Badge>registrado</Badge>}
                  {p.tags.map((t) => (
                    <Badge key={t} variant="blue">
                      {t}
                    </Badge>
                  ))}
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
      {adding && <AddProjectDialog onClose={() => setAdding(false)} />}
    </div>
  );
}
