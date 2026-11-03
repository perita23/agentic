"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "motion/react";
import { ArrowLeftIcon, BotIcon, GitBranchIcon, PlayIcon, UserIcon, WrenchIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton, StatusDot } from "@/components/app/common";
import { useLauncher } from "@/components/app/launcher";
import { useApi, type Transcript } from "@/lib/api";
import { cn, formatTokens, shortPath, timeAgo } from "@/lib/utils";

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useApi<Transcript>(`/api/sessions/${id}`, { refreshInterval: (d) => (d?.active ? 3000 : 0) });
  const launcher = useLauncher();
  const resumeCmd = data?.cwd ? `cd ${JSON.stringify(data.cwd)} && claude --resume ${id}` : `claude --resume ${id}`;

  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!data)
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-40" />
      </div>
    );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 border-b pb-4">
        <Link href="/sessions" className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-3" /> Sesiones
        </Link>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <StatusDot status={data.status} /> <span className="truncate">{data.title}</span>
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={data.active ? (data.status === "busy" ? "yellow" : "green") : "default"}>{data.active ? data.status : "cerrada"}</Badge>
              <span className="font-mono">{shortPath(data.cwd)}</span>
              {data.gitBranch && (
                <span className="flex items-center gap-1">
                  <GitBranchIcon className="size-3" /> {data.gitBranch}
                </span>
              )}
              {data.model && <span>{data.model}</span>}
              <span>{timeAgo(data.lastActivity)}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex items-center rounded-md border bg-inset pl-3 font-mono text-xs text-muted-foreground">
              <span className="max-w-64 truncate">claude --resume {id.slice(0, 8)}…</span>
              <CopyButton value={resumeCmd} label="Copiar comando de reanudación" />
            </div>
            {data.cwd && (
              <Button onClick={() => launcher.open({ projectPath: data.cwd, resumeSessionId: id })}>
                <PlayIcon /> Continuar
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="flex min-w-0 flex-col gap-3">
          {data.truncated && <p className="text-xs text-muted-foreground">Mostrando los últimos {data.messages.length} de {data.totalMessages} mensajes.</p>}
          {data.messages.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.01, 0.3) }}
              className={cn("rounded-lg border", m.role === "user" ? "border-primary/30 bg-primary/5" : "bg-card")}
            >
              <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
                {m.role === "user" ? <UserIcon className="size-3.5 text-primary" /> : <BotIcon className="size-3.5 text-orange" />}
                <span className="font-medium text-foreground">{m.role === "user" ? "Tú" : "Claude"}</span>
                {m.timestamp && <span className="ml-auto">{new Date(m.timestamp).toLocaleString("es-ES")}</span>}
              </div>
              {m.text && <div className="px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words">{m.text}</div>}
              {!!m.tools?.length && (
                <div className="flex flex-col gap-1 px-3 pb-2">
                  {m.tools.map((t, j) => (
                    <details key={j} className="group rounded border bg-inset text-xs">
                      <summary className="flex cursor-pointer items-center gap-1.5 px-2 py-1 font-mono text-muted-foreground">
                        <WrenchIcon className="size-3" /> {t.name}
                      </summary>
                      <pre className="overflow-x-auto px-2 py-1.5 font-mono text-[11px] text-muted-foreground">{t.input}</pre>
                    </details>
                  ))}
                </div>
              )}
            </motion.div>
          ))}
          {data.messages.length === 0 && <p className="text-sm text-muted-foreground">Esta sesión no tiene mensajes visibles.</p>}
        </div>

        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Tokens</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              {[
                ["Entrada", data.usage.input],
                ["Salida", data.usage.output],
                ["Caché (lect.)", data.usage.cacheRead],
                ["Caché (escr.)", data.usage.cacheWrite],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <div className="text-xs text-muted-foreground">{k}</div>
                  <div className="font-semibold tabular-nums">{formatTokens(v as number)}</div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Herramientas usadas</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 text-sm">
              {Object.entries(data.tools)
                .sort((a, b) => b[1] - a[1])
                .map(([name, n]) => (
                  <div key={name} className="flex items-center gap-2">
                    <span className="truncate font-mono text-xs">{name}</span>
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">{n}</span>
                  </div>
                ))}
              {Object.keys(data.tools).length === 0 && <span className="text-xs text-muted-foreground">Ninguna</span>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Detalles</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-xs">
              <Detail k="ID" v={data.id} mono />
              <Detail k="Versión CLI" v={data.version ?? "—"} />
              <Detail k="Inicio" v={data.startedAt ? new Date(data.startedAt).toLocaleString("es-ES") : "—"} />
              <Detail k="Mensajes" v={String(data.totalMessages)} />
              {data.pid && <Detail k="PID" v={String(data.pid)} />}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Detail({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{k}</span>
      <span className={cn("truncate", mono && "font-mono")}>{v}</span>
    </div>
  );
}
