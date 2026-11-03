"use client";

import * as React from "react";
import { FileStackIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, errorMessage, PageHeader } from "@/components/app/common";
import { PRIORITIES } from "@/components/app/task-dialog";
import { TEMPLATE_ICONS, TemplateIcon, TemplatePicker } from "@/components/app/template-picker";
import { api, refresh, useApi, type Template } from "@/lib/api";

type Draft = Omit<Template, "id" | "createdAt" | "updatedAt" | "builtin" | "labels" | "checklist"> & { labels: string; checklist: string };

const empty: Draft = { name: "", description: "", icon: "file-text", variables: [], title: "", body: "", prompt: "", priority: "medium", labels: "", checklist: "" };

function TemplateEditor({ tpl, onClose }: { tpl?: Template; onClose: () => void }) {
  const [d, setD] = React.useState<Draft>(() => (tpl ? { ...tpl, labels: tpl.labels.join(", "), checklist: tpl.checklist.join("\n") } : empty));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const [busy, setBusy] = React.useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = {
      ...d,
      labels: d.labels.split(",").map((s) => s.trim()).filter(Boolean),
      checklist: d.checklist.split("\n").map((s) => s.trim()).filter(Boolean),
    };
    try {
      if (tpl) await api("PUT", `/api/templates/${tpl.id}`, body);
      else await api("POST", "/api/templates", body);
      refresh("/api/templates");
      toast.success("Plantilla guardada");
      onClose();
    } catch (err) {
      toast.error("No se pudo guardar", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{tpl ? "Editar plantilla" : "Nueva plantilla"}</DialogTitle>
            <DialogDescription>
              Usa <code className="rounded bg-secondary px-1 font-mono text-xs">{"{{variable}}"}</code> en título, cuerpo, prompt y checklist.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-[1fr_160px_140px]">
            <F label="Nombre">
              <Input required value={d.name} onChange={(e) => set("name", e.target.value)} />
            </F>
            <F label="Icono">
              <Select value={d.icon} onValueChange={(v) => set("icon", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(TEMPLATE_ICONS).map((k) => (
                    <SelectItem key={k} value={k}>
                      <TemplateIcon name={k} /> {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </F>
            <F label="Prioridad">
              <Select value={d.priority} onValueChange={(v) => set("priority", v as Draft["priority"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </F>
          </div>
          <F label="Descripción">
            <Input value={d.description} onChange={(e) => set("description", e.target.value)} />
          </F>
          <F label="Variables">
            <div className="flex flex-col gap-2">
              {d.variables.map((v, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
                  <Input placeholder="nombre" className="font-mono" value={v.name} onChange={(e) => set("variables", d.variables.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <Input placeholder="etiqueta" value={v.label} onChange={(e) => set("variables", d.variables.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  <Input placeholder="valor por defecto" value={v.default} onChange={(e) => set("variables", d.variables.map((x, j) => (j === i ? { ...x, default: e.target.value } : x)))} />
                  <Button type="button" variant="ghost" size="icon" aria-label="Quitar variable" onClick={() => set("variables", d.variables.filter((_, j) => j !== i))}>
                    <XIcon />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => set("variables", [...d.variables, { name: "", label: "", default: "" }])}>
                <PlusIcon /> Variable
              </Button>
            </div>
          </F>
          <F label="Título de la tarea">
            <Input required value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="Bug: {{bug}}" className="font-mono" />
          </F>
          <F label="Cuerpo / descripción">
            <Textarea rows={3} value={d.body} onChange={(e) => set("body", e.target.value)} />
          </F>
          <F label="Prompt para Claude">
            <Textarea rows={4} value={d.prompt} onChange={(e) => set("prompt", e.target.value)} className="font-mono text-[13px]" />
          </F>
          <div className="grid gap-3 sm:grid-cols-2">
            <F label="Etiquetas (comas)">
              <Input value={d.labels} onChange={(e) => set("labels", e.target.value)} />
            </F>
            <F label="Checklist (una por línea)">
              <Textarea rows={3} value={d.checklist} onChange={(e) => set("checklist", e.target.value)} />
            </F>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export default function TemplatesPage() {
  const { data } = useApi<{ templates: Template[] }>("/api/templates");
  const [editing, setEditing] = React.useState<{ tpl?: Template } | null>(null);
  const [using, setUsing] = React.useState<string | null>(null);

  async function remove(t: Template) {
    if (!confirm(`¿Borrar la plantilla "${t.name}"?`)) return;
    try {
      await api("DELETE", `/api/templates/${t.id}`);
      refresh("/api/templates");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={FileStackIcon}
        title="Plantillas"
        description="Plantillas reutilizables para crear tareas (y sus prompts) en segundos."
        actions={
          <Button onClick={() => setEditing({})}>
            <PlusIcon /> Nueva plantilla
          </Button>
        }
      />
      {data && data.templates.length === 0 && <EmptyState icon={FileStackIcon} title="Sin plantillas" />}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data?.templates.map((t, i) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            className="group flex flex-col gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-[#8b949e]/40"
          >
            <div className="flex items-start gap-3">
              <span className="rounded-md border bg-secondary/50 p-2">
                <TemplateIcon name={t.icon} className="size-4 text-primary" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium">
                  {t.name} {t.builtin && <Badge>incluida</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {t.variables.map((v) => (
                <Badge key={v.name} variant="purple" className="font-mono">
                  {`{{${v.name}}}`}
                </Badge>
              ))}
              {t.labels.map((l) => (
                <Badge key={l} variant="blue">
                  {l}
                </Badge>
              ))}
            </div>
            <div className="mt-auto flex items-center gap-2">
              <Button size="sm" onClick={() => setUsing(t.id)}>
                Usar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing({ tpl: t })} aria-label="Editar">
                <PencilIcon />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => remove(t)} aria-label="Borrar" className="ml-auto hover:text-destructive">
                <Trash2Icon />
              </Button>
            </div>
          </motion.div>
        ))}
      </div>
      {editing && <TemplateEditor tpl={editing.tpl} onClose={() => setEditing(null)} />}
      {using && <TemplatePicker initialTemplateId={using} onClose={() => setUsing(null)} />}
    </div>
  );
}
