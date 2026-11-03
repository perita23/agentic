"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRightLeftIcon, BotIcon, DownloadIcon, ExternalLinkIcon, PlayIcon, SquareKanbanIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, errorMessage, PageHeader } from "@/components/app/common";
import { useLauncher } from "@/components/app/launcher";
import { ProviderIcon } from "@/components/app/provider-icon";
import { api, refresh, useApi, type ProjectListItem } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";

interface Issue {
  key: string;
  summary: string;
  type: string | null;
  status: string;
  statusCategory: string;
  priority: string | null;
  assignee: string | null;
  updated: string | null;
  url: string;
  imported: string | null;
}
interface IssueDetail extends Issue {
  description: string;
  reporter: string | null;
  labels: string[];
  comments: { author: string; body: string; at: string | null }[];
  transitions: { id: string; name: string; to: string; category: string }[];
}

const CATEGORY: Record<string, "default" | "blue" | "green"> = { new: "default", indeterminate: "blue", done: "green" };
const PRESETS = [
  { label: "Asignadas a mí", jql: "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC" },
  { label: "Creadas por mí", jql: "reporter = currentUser() ORDER BY created DESC" },
  { label: "Actualizadas (7 días)", jql: "updated >= -7d ORDER BY updated DESC" },
];
const NONE = "__none";

function IssuePanel({ issueKey, onClose, onChanged }: { issueKey: string; onClose: () => void; onChanged: () => void }) {
  const key = `/api/jira/issues/${encodeURIComponent(issueKey)}`;
  const { data: d, error } = useApi<IssueDetail>(key);
  const { data: projects } = useApi<{ projects: ProjectListItem[] }>("/api/projects");
  const launcher = useLauncher();
  const [comment, setComment] = React.useState("");
  const [project, setProject] = React.useState(NONE);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function act(action: string, body: unknown) {
    setBusy(action);
    try {
      const r = await api<{ task?: { id: string }; created?: boolean }>("POST", `${key}/${action}`, body);
      refresh(key, "/api/tasks");
      onChanged();
      return r;
    } catch (e) {
      toast.error("La acción falló", { description: errorMessage(e) });
      return null;
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="p-4 text-sm text-destructive">{error.message}</p>;
  if (!d) return <Skeleton className="m-4 h-64" />;
  const projectPath = project === NONE ? null : project;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-2 border-b p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{d.key}</span>
            {d.type && <span>· {d.type}</span>}
            <Badge variant={CATEGORY[d.statusCategory] ?? "default"}>{d.status}</Badge>
          </div>
          <h2 className="mt-1 text-base font-semibold">{d.summary}</h2>
          <div className="mt-1 text-xs text-muted-foreground">
            {d.assignee ? `Asignada a ${d.assignee}` : "Sin asignar"} · {d.priority ?? "sin prioridad"} · {timeAgo(d.updated)}
          </div>
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Cerrar">
          <XIcon />
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex flex-wrap gap-2">
          {/^https?:\/\//.test(d.url) && (
            <Button size="sm" variant="outline" asChild>
              <a href={d.url} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon /> Jira
              </a>
            </Button>
          )}
          {d.transitions.length > 0 && (
            <Select
              value=""
              onValueChange={async (id) => {
                const t = d.transitions.find((x) => x.id === id);
                if (t && (await act("transition", { transitionId: id }))) toast.success(`${d.key} → ${t.to || t.name}`);
              }}
            >
              <SelectTrigger className="h-7 w-auto gap-1.5 text-xs" aria-label="Cambiar estado">
                <ArrowRightLeftIcon className="size-3.5" />
                <SelectValue placeholder="Cambiar estado" />
              </SelectTrigger>
              <SelectContent>
                {d.transitions.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                    {t.to && t.to !== t.name ? ` → ${t.to}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <section>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">Descripción</h3>
          <div className="rounded-md border bg-inset p-3 text-sm leading-relaxed whitespace-pre-wrap break-words">{d.description || <span className="text-muted-foreground italic">Sin descripción.</span>}</div>
          {d.labels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {d.labels.map((l) => (
                <Badge key={l} variant="blue">
                  {l}
                </Badge>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-md border p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <SquareKanbanIcon className="size-3.5" /> Trabajar en Agentic
          </h3>
          <div className="grid gap-2">
            <Label>Proyecto</Label>
            <Select value={project} onValueChange={setProject}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sin proyecto</SelectItem>
                {projects?.projects
                  .filter((p) => p.exists)
                  .map((p) => (
                    <SelectItem key={p.path} value={p.path}>
                      {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <div className="flex flex-wrap gap-2">
              {d.imported ? (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/tasks?task=${d.imported}`}>Ver tarea vinculada</Link>
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === "import"}
                  onClick={async () => {
                    const r = await act("import", { projectPath });
                    if (r?.task) toast.success(`${d.key} importada como tarea`);
                  }}
                >
                  <DownloadIcon /> Importar como tarea
                </Button>
              )}
              <Button
                size="sm"
                disabled={!projectPath}
                onClick={() =>
                  launcher.open({
                    projectPath,
                    title: `Resolver ${d.key} con Claude`,
                    prompt: `Resuelve la incidencia de Jira ${d.key} «${d.summary}» (${d.url}).\n\n${d.description}`,
                  })
                }
              >
                <BotIcon /> Resolver con Claude
              </Button>
            </div>
            {!projectPath && <p className="text-xs text-muted-foreground">Elige un proyecto para lanzar Claude.</p>}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">Comentarios ({d.comments.length})</h3>
          {d.comments.map((c, i) => (
            <div key={i} className="rounded-md border bg-card">
              <div className="flex justify-between border-b px-3 py-1.5 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{c.author}</span>
                <span>{timeAgo(c.at)}</span>
              </div>
              <div className="px-3 py-2 text-sm whitespace-pre-wrap break-words">{c.body}</div>
            </div>
          ))}
          <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Añadir comentario…" />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!comment.trim() || busy === "comment"}
              onClick={async () => {
                if (await act("comment", { body: comment })) {
                  setComment("");
                  toast.success("Comentario publicado en Jira");
                }
              }}
            >
              Comentar
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

function JiraInner() {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("key");
  const { data: status } = useApi<Record<string, { configured: boolean; defaultJql?: string }>>("/api/integrations");
  const configured = status?.jira?.configured;
  const [jql, setJql] = React.useState<string | null>(null);
  const effective = jql ?? status?.jira?.defaultJql ?? PRESETS[0].jql;
  const [draft, setDraft] = React.useState<string | null>(null);
  const [issues, setIssues] = React.useState<Issue[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const run = React.useCallback(async (q: string) => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api<{ issues: Issue[] }>("POST", "/api/jira/search", { jql: q });
      setIssues(r.issues);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    // Fetching on mount / when the query changes is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (configured) void run(effective);
  }, [configured, effective, run]);

  const select = (k: string | null) => router.replace(k ? `/jira?key=${encodeURIComponent(k)}` : "/jira");

  if (status && !configured)
    return (
      <div className="flex flex-col gap-5">
        <PageHeader icon={SquareKanbanIcon} title="Jira" description="Tus incidencias de Jira dentro de Agentic." />
        <EmptyState
          icon={SquareKanbanIcon}
          title="Conecta Jira"
          description="Añade tu sitio, email y API token en Integraciones."
          action={
            <Button asChild size="sm">
              <Link href="/integrations">Ir a Integraciones</Link>
            </Button>
          }
        />
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon={SquareKanbanIcon} title="Jira" description="Consulta, comenta, mueve e importa incidencias." />
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft?.trim()) setJql(draft.trim());
          else void run(effective);
        }}
      >
        <div className="relative flex-1">
          <ProviderIcon provider="jira" className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8 font-mono text-xs" value={draft ?? effective} onChange={(e) => setDraft(e.target.value)} aria-label="JQL" />
        </div>
        <Button type="submit" variant="outline">
          <PlayIcon /> Buscar
        </Button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => {
              setDraft(null);
              setJql(p.jql);
            }}
            className={cn("cursor-pointer rounded-full border px-2.5 py-0.5 text-xs", effective === p.jql ? "border-primary/60 bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {p.label}
          </button>
        ))}
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="flex min-h-[520px] overflow-hidden rounded-lg border bg-card">
        <div className={cn("min-w-0 flex-1 overflow-y-auto", selected && "hidden lg:block")}>
          {loading && !issues ? (
            <Skeleton className="m-4 h-40" />
          ) : issues?.length ? (
            <div className="divide-y">
              {issues.map((i) => (
                <button
                  key={i.key}
                  onClick={() => select(i.key)}
                  className={cn("flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/60", selected === i.key && "bg-accent")}
                >
                  <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{i.key}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{i.summary}</span>
                    <span className="block text-xs text-muted-foreground">
                      {i.type ?? "—"} · {i.assignee ?? "sin asignar"} · {timeAgo(i.updated)}
                    </span>
                  </span>
                  {i.imported && <Badge variant="purple">tarea</Badge>}
                  <Badge variant={CATEGORY[i.statusCategory] ?? "default"}>{i.status}</Badge>
                </button>
              ))}
            </div>
          ) : (
            issues && <p className="p-6 text-center text-sm text-muted-foreground">Ninguna incidencia coincide con la consulta.</p>
          )}
        </div>
        {selected && (
          <aside className="w-full border-l lg:w-[460px]">
            <IssuePanel key={selected} issueKey={selected} onClose={() => select(null)} onChanged={() => void run(effective)} />
          </aside>
        )}
      </div>
    </div>
  );
}

export default function JiraPage() {
  return (
    <React.Suspense>
      <JiraInner />
    </React.Suspense>
  );
}
