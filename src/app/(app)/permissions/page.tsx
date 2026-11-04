"use client";

import * as React from "react";
import { CheckIcon, CircleHelpIcon, PlusIcon, SaveIcon, ShieldAlertIcon, ShieldCheckIcon, ShieldXIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, PageHeader } from "@/components/app/common";
import { api, useApi, type ProjectListItem } from "@/lib/api";
import { cn, shortPath } from "@/lib/utils";

type Scope = "user" | "project" | "local";
type Mode = "default" | "acceptEdits" | "plan" | "bypassPermissions";
type ListKey = "allow" | "ask" | "deny";
interface Permissions {
  allow: string[];
  ask: string[];
  deny: string[];
  defaultMode: Mode | null;
  additionalDirectories: string[];
}
interface PermsResponse {
  file: string;
  exists: boolean;
  permissions: Permissions;
  conflicts: string[];
}

const MODES: { id: Mode; label: string; help: string; danger?: boolean }[] = [
  { id: "default", label: "Preguntar", help: "Pide permiso la primera vez que usa cada herramienta." },
  { id: "acceptEdits", label: "Aceptar ediciones", help: "Edita ficheros sin preguntar; los comandos sí preguntan." },
  { id: "plan", label: "Sólo planificar", help: "Analiza y propone, pero no cambia nada." },
  { id: "bypassPermissions", label: "Sin preguntas", help: "Lo hace todo sin pedir permiso. Sólo en entornos aislados.", danger: true },
];

const LISTS: { key: ListKey; title: string; help: string; icon: typeof ShieldCheckIcon; tone: string; example: string }[] = [
  { key: "allow", title: "Permitir siempre", help: "Se ejecuta sin preguntar.", icon: ShieldCheckIcon, tone: "text-success", example: "Bash(npm run build:*)" },
  { key: "ask", title: "Preguntar siempre", help: "Pide confirmación aunque otra regla lo permita.", icon: CircleHelpIcon, tone: "text-warning", example: "Bash(git push:*)" },
  { key: "deny", title: "Bloquear", help: "Nunca se permite. Gana a todo lo demás.", icon: ShieldXIcon, tone: "text-destructive", example: "Read(./config/prod.json)" },
];

/** One-click recipes for the most common needs. */
const RECIPES: { id: string; label: string; help: string; add: Partial<Record<ListKey, string[]>> }[] = [
  { id: "secrets", label: "Proteger secretos", help: "Bloquea leer .env y claves.", add: { deny: ["Read(./.env)", "Read(./.env.*)", "Read(./secrets/**)", "Read(~/.ssh/**)"] } },
  { id: "tests", label: "Tests y lint sin preguntar", help: "npm test, lint y typecheck.", add: { allow: ["Bash(npm run test:*)", "Bash(npm test:*)", "Bash(npm run lint:*)", "Bash(npm run typecheck:*)"] } },
  { id: "git-read", label: "Git de sólo lectura", help: "status, diff, log y show sin preguntar.", add: { allow: ["Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)"] } },
  { id: "push", label: "Confirmar push", help: "Pregunta antes de git push.", add: { ask: ["Bash(git push:*)"] } },
  { id: "danger", label: "Bloquear comandos peligrosos", help: "rm -rf, sudo y curl a shell.", add: { deny: ["Bash(rm -rf:*)", "Bash(sudo:*)", "Bash(curl:* | sh)"] } },
  { id: "web", label: "Buscar en la web", help: "WebSearch sin preguntar.", add: { allow: ["WebSearch"] } },
];

const EMPTY: Permissions = { allow: [], ask: [], deny: [], defaultMode: null, additionalDirectories: [] };

function RuleList({ list, rules, conflicts, onChange }: { list: (typeof LISTS)[number]; rules: string[]; conflicts: Set<string>; onChange: (r: string[]) => void }) {
  const [draft, setDraft] = React.useState("");
  function add(e: React.FormEvent) {
    e.preventDefault();
    const v = draft.trim();
    if (!v) return;
    if (!/^[A-Za-z][A-Za-z0-9_-]*(\(.+\))?$/.test(v)) {
      toast.error("Regla no válida", { description: "Formato: Herramienta o Herramienta(patrón). Ej.: Bash(npm run build:*)" });
      return;
    }
    if (!rules.includes(v)) onChange([...rules, v]);
    setDraft("");
  }
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <list.icon className={cn("size-4", list.tone)} /> {list.title}
            <span className="font-mono text-xs font-normal text-muted-foreground">{rules.length}</span>
          </CardTitle>
          <CardDescription>{list.help}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="flex max-h-72 min-h-16 flex-col gap-1.5 overflow-y-auto">
          {!rules.length && <p className="text-xs text-muted-foreground">Sin reglas.</p>}
          {rules.map((r) => (
            <div key={r} className={cn("group flex min-w-0 items-center gap-2 rounded-md border bg-inset px-2.5 py-1.5", conflicts.has(r) && "border-warning/60")}>
              <code className="min-w-0 flex-1 truncate text-xs" title={r}>
                {r}
              </code>
              <button type="button" aria-label={`Quitar ${r}`} onClick={() => onChange(rules.filter((x) => x !== r))} className="cursor-pointer text-muted-foreground hover:text-destructive">
                <XIcon className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        <form onSubmit={add} className="mt-auto flex gap-2">
          <Input aria-label={`Nueva regla: ${list.title}`} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={list.example} className="h-8 font-mono text-xs" />
          <Button type="submit" size="icon-sm" variant="outline" aria-label="Añadir regla">
            <PlusIcon />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function PermissionsPage() {
  const { data: projects } = useApi<{ projects: ProjectListItem[] }>("/api/projects");
  const [scope, setScope] = React.useState<Scope>("user");
  const [picked, setPicked] = React.useState("");
  const project = picked || projects?.projects[0]?.path || "";
  const target = scope === "user" ? "scope=user" : project ? `scope=${scope}&project=${encodeURIComponent(project)}` : null;
  const { data, error, mutate } = useApi<PermsResponse>(target ? `/api/permissions?${target}` : null, { revalidateOnFocus: false });
  // Unsaved edits belong to one file; switching scope/project shows that file's saved rules.
  const [edit, setEdit] = React.useState<{ target: string | null; perms: Permissions } | null>(null);
  const draft = edit && edit.target === target ? edit.perms : (data?.permissions ?? EMPTY);
  const setDraft = (fn: (d: Permissions) => Permissions) => setEdit({ target, perms: fn(draft) });
  const [busy, setBusy] = React.useState(false);

  const dirty = !!data && JSON.stringify(draft) !== JSON.stringify(data.permissions);
  const conflictSet = React.useMemo(() => {
    const all = [...draft.allow, ...draft.ask, ...draft.deny];
    return new Set(all.filter((r, i) => all.indexOf(r) !== i));
  }, [draft]);

  function applyRecipe(r: (typeof RECIPES)[number]) {
    setDraft((d) => {
      const next = { ...d };
      for (const k of Object.keys(r.add) as ListKey[]) next[k] = [...new Set([...d[k], ...(r.add[k] ?? [])])];
      return next;
    });
  }
  const recipeOn = (r: (typeof RECIPES)[number]) => (Object.keys(r.add) as ListKey[]).every((k) => r.add[k]!.every((x) => draft[k].includes(x)));

  async function save() {
    setBusy(true);
    try {
      const res = await api<PermsResponse>("PUT", "/api/permissions", { scope, projectPath: scope === "user" ? null : project, permissions: draft });
      await mutate(res, { revalidate: false });
      setEdit(null);
      toast.success("Permisos guardados", { description: "Claude Code los aplica en las próximas sesiones." });
    } catch (e) {
      toast.error("No se pudieron guardar", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const SCOPES: { id: Scope; label: string }[] = [
    { id: "user", label: "Todos los proyectos" },
    { id: "project", label: "Proyecto (compartido)" },
    { id: "local", label: "Proyecto (sólo yo)" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={ShieldCheckIcon}
        title="Permisos"
        description="Decide qué puede hacer Claude Code sin preguntarte, qué debe confirmar y qué tiene prohibido."
        actions={
          <Button onClick={save} disabled={!dirty || busy}>
            <SaveIcon /> {busy ? "Guardando…" : dirty ? "Guardar cambios" : "Guardado"}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Ámbito" className="flex rounded-lg border bg-inset p-0.5">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={scope === s.id}
              onClick={() => setScope(s.id)}
              className={cn("cursor-pointer rounded-md px-3 py-1 text-sm transition-colors", scope === s.id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {s.label}
            </button>
          ))}
        </div>
        {scope !== "user" && (
          <select aria-label="Proyecto" value={project} onChange={(e) => setPicked(e.target.value)} className="h-8 max-w-64 rounded-md border bg-inset px-2 text-sm">
            {!projects?.projects.length && <option value="">Sin proyectos</option>}
            {projects?.projects.map((p) => (
              <option key={p.path} value={p.path}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        {data && (
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={data.file}>
            {shortPath(data.file)}
            {!data.exists && " · se creará al guardar"}
          </span>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {!data && !error && target && <Skeleton className="h-64" />}
      {!target && <p className="text-sm text-muted-foreground">Añade un proyecto para editar sus permisos.</p>}

      {data && (
        <>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Modo por defecto</CardTitle>
                <CardDescription>Cómo arranca cada sesión. Puedes cambiarlo dentro de la sesión con Shift+Tab.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
              {MODES.map((m) => {
                const active = (draft.defaultMode ?? "default") === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setDraft((d) => ({ ...d, defaultMode: m.id === "default" ? null : m.id }))}
                    className={cn(
                      "flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
                      active ? (m.danger ? "border-destructive/70 bg-destructive/10" : "border-border-strong bg-accent") : "hover:border-border-strong",
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {m.danger && <ShieldAlertIcon className="size-3.5 text-destructive" />}
                      {m.label}
                      {active && <CheckIcon className="ml-auto size-3.5" />}
                    </span>
                    <span className="text-xs text-muted-foreground">{m.help}</span>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Recetas rápidas</h2>
            <div className="flex flex-wrap gap-1.5">
              {RECIPES.map((r) => {
                const on = recipeOn(r);
                return (
                  <button
                    key={r.id}
                    type="button"
                    title={r.help}
                    disabled={on}
                    onClick={() => applyRecipe(r)}
                    className={cn("flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors", on ? "border-success/40 text-success" : "text-muted-foreground hover:border-border-strong hover:text-foreground")}
                  >
                    {on ? <CheckIcon className="size-3" /> : <PlusIcon className="size-3" />} {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          {conflictSet.size > 0 && (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              Reglas repetidas en varias listas: {[...conflictSet].join(", ")}. Claude Code aplica primero «Bloquear», luego «Preguntar» y por último «Permitir».
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
            {LISTS.map((l) => (
              <RuleList key={l.key} list={l} rules={draft[l.key]} conflicts={conflictSet} onChange={(rules) => setDraft((d) => ({ ...d, [l.key]: rules }))} />
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Formato: <code>Herramienta</code> o <code>Herramienta(patrón)</code>. Ejemplos: <code>Bash(npm run test:*)</code>, <code>Read(./.env)</code>, <code>WebFetch(domain:github.com)</code>,{" "}
            <code>mcp__github</code>.
          </p>
        </>
      )}
    </div>
  );
}
