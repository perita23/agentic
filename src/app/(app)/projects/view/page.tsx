"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeftIcon, BotIcon, FileTextIcon, FolderIcon, GitBranchIcon, GitCommitHorizontalIcon, KanbanSquareIcon, MessagesSquareIcon, PinIcon, PinOffIcon, PlusIcon, RocketIcon, TerminalIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopyButton, EmptyState, errorMessage } from "@/components/app/common";
import { useLauncher } from "@/components/app/launcher";
import { AddProjectDialog } from "@/components/app/projects";
import { SessionRow } from "@/components/app/session-row";
import { STATUSES } from "@/components/app/task-dialog";
import { api, refresh, useApi, type Agent, type ProjectInfo, type SessionSummary, type Task } from "@/lib/api";
import { shortPath, timeAgo } from "@/lib/utils";

function ProjectView() {
  const params = useSearchParams();
  const path = params.get("path") ?? "";
  const launcher = useLauncher();
  const [registering, setRegistering] = React.useState(false);
  const { data, error } = useApi<ProjectInfo>(path ? `/api/projects/info?path=${encodeURIComponent(path)}` : null);
  const { data: sessions } = useApi<{ sessions: SessionSummary[] }>(path ? `/api/sessions?project=${encodeURIComponent(path)}` : null, { refreshInterval: 5000 });
  const { data: tasks } = useApi<{ tasks: Task[] }>("/api/tasks");
  const { data: agents } = useApi<{ agents: Agent[] }>("/api/agents");

  if (!path) return <p className="text-sm text-muted-foreground">Falta el parámetro path.</p>;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!data)
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-48" />
      </div>
    );

  const projectTasks = (tasks?.tasks ?? []).filter((t) => t.projectPath === path);
  const projectAgents = (agents?.agents ?? []).filter((a) => a.projectPath === path);

  async function togglePin() {
    if (!data?.id) return;
    try {
      await api("PATCH", `/api/projects/${data.id}`, { pinned: !data.pinned });
      refresh("/api/projects");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 border-b pb-4">
        <Link href="/projects" className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-3" /> Proyectos
        </Link>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <FolderIcon className="size-5 text-muted-foreground" /> {data.name}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{shortPath(data.path)}</span>
              <CopyButton value={data.path} label="Copiar ruta" />
              {data.git?.branch && (
                <Badge variant="blue">
                  <GitBranchIcon /> {data.git.branch}
                </Badge>
              )}
              {data.stack.map((s) => (
                <Badge key={s}>{s}</Badge>
              ))}
              {!data.exists && <Badge variant="red">la carpeta no existe</Badge>}
            </div>
            {data.description && <p className="mt-2 text-sm text-muted-foreground">{data.description}</p>}
          </div>
          <div className="flex shrink-0 gap-2">
            {data.registered ? (
              <Button variant="outline" onClick={togglePin}>
                {data.pinned ? <PinOffIcon /> : <PinIcon />} {data.pinned ? "Desfijar" : "Fijar"}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setRegistering(true)}>
                <PlusIcon /> Registrar
              </Button>
            )}
            <Button disabled={!data.exists} onClick={() => launcher.open({ projectPath: data.path })}>
              <RocketIcon /> Nueva sesión aquí
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">
            <FolderIcon /> Resumen
          </TabsTrigger>
          <TabsTrigger value="sessions">
            <MessagesSquareIcon /> Sesiones <span className="text-xs text-muted-foreground">{sessions?.sessions.length ?? ""}</span>
          </TabsTrigger>
          <TabsTrigger value="tasks">
            <KanbanSquareIcon /> Tareas <span className="text-xs text-muted-foreground">{projectTasks.length}</span>
          </TabsTrigger>
          <TabsTrigger value="claude">
            <FileTextIcon /> CLAUDE.md
          </TabsTrigger>
          <TabsTrigger value="agents">
            <BotIcon /> Agentes <span className="text-xs text-muted-foreground">{projectAgents.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid items-start gap-4 lg:grid-cols-3">
          <Card className="min-w-0 lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitCommitHorizontalIcon className="size-4" /> Git
              </CardTitle>
              {data.git && <span className="text-xs text-muted-foreground">{data.git.commitCount} commits</span>}
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {!data.git ? (
                <p className="text-muted-foreground">No es un repositorio git.</p>
              ) : (
                <>
                  <div className="flex min-w-0 flex-wrap gap-2">
                    <Badge variant={data.git.changes ? "yellow" : "green"}>{data.git.changes ? `${data.git.changes} cambios sin commitear` : "árbol limpio"}</Badge>
                    {data.git.remotes.map((r) => (
                      <Badge key={r} className="block max-w-full min-w-0 truncate font-mono" title={r}>
                        {r}
                      </Badge>
                    ))}
                  </div>
                  <div className="scroll-area divide-y rounded-md border">
                    {data.git.recentCommits.map((c) => (
                      <div key={c.hash} className="flex items-center gap-3 px-3 py-2">
                        <span className="font-mono text-xs text-link">{c.hash}</span>
                        <span className="flex-1 truncate">{c.subject}</span>
                        <span className="hidden text-xs text-muted-foreground sm:inline">{c.author}</span>
                        <span className="text-xs text-muted-foreground">{timeAgo(c.date)}</span>
                      </div>
                    ))}
                  </div>
                  {data.git.changedFiles.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">Ficheros modificados</summary>
                      <ul className="scroll-area mt-2 space-y-0.5 font-mono">
                        {data.git.changedFiles.map((f) => (
                          <li key={f.file}>
                            <span className="inline-block w-6 text-warning">{f.status}</span> {f.file}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </CardContent>
          </Card>
          <div className="flex min-w-0 flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TerminalIcon className="size-4" /> Scripts
                </CardTitle>
                {data.package?.dependencies != null && <span className="text-xs text-muted-foreground">{data.package.dependencies} deps</span>}
              </CardHeader>
              <CardContent className="scroll-area flex flex-col gap-1.5">
                {Object.keys(data.scripts).length === 0 && <span className="text-xs text-muted-foreground">Sin scripts de npm.</span>}
                {Object.entries(data.scripts).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 text-xs">
                    <span className="font-mono font-medium">{k}</span>
                    <span className="truncate font-mono text-muted-foreground" title={v}>
                      {v}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Ficheros</CardTitle>
              </CardHeader>
              <CardContent className="scroll-area flex flex-wrap content-start gap-1">
                {data.files.map((f) => (
                  <Badge key={f} className="font-mono">
                    {f}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="sessions">
          <div className="overflow-hidden rounded-lg border bg-card">
            {sessions?.sessions.length ? (
              <div className="divide-y">{sessions.sessions.map((s) => <SessionRow key={s.id} s={s} />)}</div>
            ) : (
              <div className="p-6">
                <EmptyState icon={MessagesSquareIcon} title="Sin sesiones en este proyecto" />
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="tasks">
          {projectTasks.length === 0 ? (
            <EmptyState
              icon={KanbanSquareIcon}
              title="Sin tareas"
              action={
                <Button size="sm" asChild>
                  <Link href="/tasks?new=1">
                    <PlusIcon /> Nueva tarea
                  </Link>
                </Button>
              }
            />
          ) : (
            <div className="divide-y overflow-hidden rounded-lg border bg-card">
              {projectTasks.map((t) => {
                const st = STATUSES.find((s) => s.key === t.status)!;
                return (
                  <Link key={t.id} href={`/tasks?task=${t.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/60">
                    <span className={`size-2 rounded-full ${st.color}`} />
                    <span className="flex-1 truncate text-sm">{t.title}</span>
                    <span className="text-xs text-muted-foreground">{st.label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="claude">
          {data.claudeMd ? (
            <Card>
              <CardContent>
                <pre className="overflow-x-auto font-mono text-[13px] leading-relaxed whitespace-pre-wrap">{data.claudeMd}</pre>
              </CardContent>
            </Card>
          ) : (
            <EmptyState icon={FileTextIcon} title="Este proyecto no tiene CLAUDE.md" description="Lanza Claude Code y ejecuta /init para generarlo." />
          )}
        </TabsContent>

        <TabsContent value="agents">
          {projectAgents.length === 0 ? (
            <EmptyState
              icon={BotIcon}
              title="Sin agentes de proyecto"
              action={
                <Button size="sm" asChild>
                  <Link href="/agents?new=1">
                    <PlusIcon /> Nuevo agente
                  </Link>
                </Button>
              }
            />
          ) : (
            <div className="divide-y overflow-hidden rounded-lg border bg-card">
              {projectAgents.map((a) => (
                <div key={a.name} className="flex items-center gap-3 px-4 py-2.5">
                  <BotIcon className="size-4 text-muted-foreground" />
                  <span className="font-mono text-sm">{a.name}</span>
                  <span className="flex-1 truncate text-xs text-muted-foreground">{a.description}</span>
                  <Button size="sm" variant="outline" onClick={() => launcher.open({ projectPath: path, agent: a.name })}>
                    <RocketIcon /> Lanzar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
      {registering && <AddProjectDialog initialPath={path} onClose={() => setRegistering(false)} />}
    </div>
  );
}

export default function ProjectViewPage() {
  return (
    <React.Suspense>
      <ProjectView />
    </React.Suspense>
  );
}
