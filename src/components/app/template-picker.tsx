"use client";

import * as React from "react";
import { BookOpenIcon, BotIcon, BugIcon, FileTextIcon, FlaskConicalIcon, GaugeIcon, GitPullRequestIcon, RocketIcon, SearchCodeIcon, ShieldCheckIcon, SparklesIcon, WandSparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, refresh, useApi, type ProjectListItem, type Task, type Template } from "@/lib/api";
import { errorMessage } from "./common";

const NONE = "__none";

export const TEMPLATE_ICONS: Record<string, React.ElementType> = {
  "file-text": FileTextIcon,
  bug: BugIcon,
  sparkles: SparklesIcon,
  "search-code": SearchCodeIcon,
  "flask-conical": FlaskConicalIcon,
  "wand-sparkles": WandSparklesIcon,
  "shield-check": ShieldCheckIcon,
  rocket: RocketIcon,
  "book-open": BookOpenIcon,
  "git-pull-request": GitPullRequestIcon,
  gauge: GaugeIcon,
  bot: BotIcon,
};

export function TemplateIcon({ name, className }: { name: string; className?: string }) {
  const Icon = TEMPLATE_ICONS[name] ?? FileTextIcon;
  return <Icon className={className} />;
}

/** Choose a template, fill its variables and create a task. */
export function TemplatePicker({ initialTemplateId, defaultProject, onClose, onCreated }: { initialTemplateId?: string; defaultProject?: string; onClose: () => void; onCreated?: (t: Task) => void }) {
  const { data } = useApi<{ templates: Template[] }>("/api/templates");
  const { data: projects } = useApi<{ projects: ProjectListItem[] }>("/api/projects");
  const [selected, setSelected] = React.useState<string | null>(initialTemplateId ?? null);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [project, setProject] = React.useState(defaultProject ?? NONE);
  const [busy, setBusy] = React.useState(false);
  const tpl = data?.templates.find((t) => t.id === selected);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!tpl) return;
    setBusy(true);
    try {
      const task = await api<Task>("POST", `/api/templates/${tpl.id}/instantiate`, { values, projectPath: project === NONE ? null : project });
      refresh("/api/tasks", "/api/overview");
      toast.success("Tarea creada desde plantilla", { description: task.title });
      onCreated?.(task);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tpl ? tpl.name : "Crear tarea desde plantilla"}</DialogTitle>
          <DialogDescription>{tpl ? tpl.description : "Elige una plantilla; podrás rellenar sus variables."}</DialogDescription>
        </DialogHeader>
        {!tpl ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {data?.templates.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setSelected(t.id);
                  setValues(Object.fromEntries(t.variables.map((v) => [v.name, v.default])));
                }}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary/60 hover:bg-accent"
              >
                <TemplateIcon name={t.icon} className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>
                  <span className="block text-sm font-medium">{t.name}</span>
                  <span className="block text-xs text-muted-foreground">{t.description}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <form onSubmit={create} className="grid gap-3">
            {tpl.variables.map((v) => (
              <div key={v.name} className="grid gap-1.5">
                <Label htmlFor={`var-${v.name}`}>{v.label || v.name}</Label>
                {v.name.match(/criteria|descripcion|description/i) ? (
                  <Textarea id={`var-${v.name}`} rows={3} value={values[v.name] ?? ""} onChange={(e) => setValues({ ...values, [v.name]: e.target.value })} />
                ) : (
                  <Input id={`var-${v.name}`} value={values[v.name] ?? ""} onChange={(e) => setValues({ ...values, [v.name]: e.target.value })} placeholder={v.default} />
                )}
              </div>
            ))}
            <div className="grid gap-1.5">
              <Label>Proyecto</Label>
              <Select value={project} onValueChange={setProject}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sin proyecto</SelectItem>
                  {projects?.projects.map((p) => (
                    <SelectItem key={p.path} value={p.path}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              {!initialTemplateId && (
                <Button type="button" variant="ghost" onClick={() => setSelected(null)} className="mr-auto">
                  ← Plantillas
                </Button>
              )}
              <Button type="submit" disabled={busy}>
                Crear tarea
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
