import crypto from "node:crypto";
import { z } from "zod";
import type { JsonStore } from "./store";
import { absPath, HttpError, nowIso, parse, renderTemplate, text } from "./util";

export const TASK_STATUSES = ["backlog", "todo", "in_progress", "review", "done"] as const;
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

const checklistItem = z.object({
  id: z.string().max(64).optional(),
  text: text(500).min(1),
  done: z.boolean().default(false),
});

const taskFields = {
  title: text(200).trim().min(1),
  description: text(20_000).default(""),
  status: z.enum(TASK_STATUSES).default("todo"),
  priority: z.enum(PRIORITIES).default("medium"),
  projectPath: absPath.nullable().optional(),
  labels: z.array(text(40).trim().min(1)).max(20).default([]),
  checklist: z.array(checklistItem).max(100).default([]),
  prompt: text(50_000).default(""),
  dueDate: z.iso.date().nullable().optional(),
};

export const taskCreateSchema = z.object(taskFields);
export const taskUpdateSchema = z
  .object({
    ...taskFields,
    order: z.number().finite().optional(),
    runIds: z.array(z.uuid()).max(200).optional(),
  })
  .partial()
  .strict();

export type Task = z.infer<typeof taskCreateSchema> & {
  id: string;
  order: number;
  runIds: string[];
  templateId?: string | null;
  createdAt: string;
  updatedAt: string;
  checklist: { id: string; text: string; done: boolean }[];
};

const variableSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_]{1,40}$/, "variable names: letters, digits, _"),
  label: text(100).default(""),
  default: text(1000).default(""),
});

export const templateSchema = z.object({
  name: text(100).trim().min(1),
  description: text(1000).default(""),
  icon: z.string().regex(/^[a-z0-9-]{0,40}$/).default("file-text"),
  variables: z.array(variableSchema).max(20).default([]),
  title: text(200).min(1),
  body: text(20_000).default(""),
  prompt: text(50_000).default(""),
  priority: z.enum(PRIORITIES).default("medium"),
  labels: z.array(text(40).trim().min(1)).max(20).default([]),
  checklist: z.array(text(500).min(1)).max(100).default([]),
});
export type Template = z.infer<typeof templateSchema> & { id: string; builtin?: boolean; createdAt: string; updatedAt: string };

export const instantiateSchema = z.object({
  values: z.record(z.string().regex(/^[a-zA-Z0-9_]{1,40}$/), text(5000)).default({}),
  projectPath: absPath.nullable().optional(),
  status: z.enum(TASK_STATUSES).default("todo"),
});

const T = "tasks";
const TPL = "templates";
const newCheckId = () => crypto.randomBytes(6).toString("hex");

export const DEFAULT_TEMPLATES: Omit<Template, "createdAt" | "updatedAt">[] = [
  {
    id: "tpl-bugfix",
    builtin: true,
    name: "Corregir bug",
    description: "Reproducir, encontrar la causa raíz, arreglar y añadir test de regresión.",
    icon: "bug",
    variables: [
      { name: "bug", label: "Descripción del bug", default: "" },
      { name: "area", label: "Módulo / zona", default: "" },
    ],
    title: "Bug: {{bug}}",
    body: "Zona afectada: {{area}}\n\nPasos para reproducir:\n1. \n\nComportamiento esperado:\n",
    prompt:
      "Investiga y corrige este bug: {{bug}} (zona: {{area}}).\n1. Reprodúcelo con un test que falle.\n2. Encuentra la causa raíz.\n3. Aplica el arreglo mínimo.\n4. Ejecuta los tests y resume los cambios.",
    priority: "high",
    labels: ["bug"],
    checklist: ["Reproducido", "Causa raíz identificada", "Fix aplicado", "Test de regresión"],
  },
  {
    id: "tpl-feature",
    builtin: true,
    name: "Nueva funcionalidad",
    description: "Plan, implementación y tests de una funcionalidad.",
    icon: "sparkles",
    variables: [
      { name: "feature", label: "Funcionalidad", default: "" },
      { name: "criteria", label: "Criterios de aceptación", default: "" },
    ],
    title: "Feature: {{feature}}",
    body: "Criterios de aceptación:\n{{criteria}}",
    prompt:
      "Implementa la funcionalidad: {{feature}}.\nCriterios de aceptación:\n{{criteria}}\n\nPrimero propone un plan breve, después implementa siguiendo las convenciones del proyecto y añade tests.",
    priority: "medium",
    labels: ["feature"],
    checklist: ["Plan", "Implementación", "Tests", "Documentación"],
  },
  {
    id: "tpl-review",
    builtin: true,
    name: "Code review",
    description: "Revisión de cambios buscando bugs, seguridad y legibilidad.",
    icon: "search-code",
    variables: [{ name: "target", label: "Rama / PR / ruta", default: "HEAD~1..HEAD" }],
    title: "Review: {{target}}",
    body: "",
    prompt:
      "Revisa los cambios de {{target}}. Busca bugs, problemas de seguridad, casos límite y mejoras de legibilidad. Devuelve una lista priorizada de hallazgos con fichero y línea. No modifiques código.",
    priority: "medium",
    labels: ["review"],
    checklist: [],
  },
  {
    id: "tpl-tests",
    builtin: true,
    name: "Escribir tests",
    description: "Aumentar cobertura de un módulo.",
    icon: "flask-conical",
    variables: [{ name: "module", label: "Módulo", default: "" }],
    title: "Tests para {{module}}",
    body: "",
    prompt:
      "Escribe tests para {{module}} cubriendo los caminos felices, errores y casos límite. Usa el framework de tests existente en el proyecto y ejecútalos.",
    priority: "medium",
    labels: ["tests"],
    checklist: ["Casos felices", "Errores", "Casos límite"],
  },
  {
    id: "tpl-refactor",
    builtin: true,
    name: "Refactor",
    description: "Refactor sin cambio de comportamiento.",
    icon: "wand-sparkles",
    variables: [
      { name: "target", label: "Código a refactorizar", default: "" },
      { name: "goal", label: "Objetivo", default: "legibilidad" },
    ],
    title: "Refactor {{target}}",
    body: "Objetivo: {{goal}}",
    prompt:
      "Refactoriza {{target}} con el objetivo de mejorar {{goal}} sin cambiar el comportamiento. Asegúrate de que los tests siguen pasando antes y después.",
    priority: "low",
    labels: ["refactor"],
    checklist: [],
  },
  {
    id: "tpl-security",
    builtin: true,
    name: "Auditoría de seguridad",
    description: "Revisión de seguridad del proyecto.",
    icon: "shield-check",
    variables: [{ name: "scope", label: "Alcance", default: "todo el repositorio" }],
    title: "Auditoría de seguridad: {{scope}}",
    body: "",
    prompt:
      "Haz una auditoría de seguridad de {{scope}}: inyección, autenticación, secretos en el código, dependencias vulnerables, validación de entradas y permisos de ficheros. Clasifica los hallazgos por severidad y propone arreglos.",
    priority: "high",
    labels: ["security"],
    checklist: [],
  },
];

export class TaskService {
  constructor(private store: JsonStore) {}

  list(): Task[] {
    return this.store.read<Task[]>(T, []);
  }

  get(id: string): Task {
    const t = this.list().find((x) => x.id === id);
    if (!t) throw new HttpError(404, "Task not found");
    return t;
  }

  create(input: unknown, extra: Partial<Task> = {}): Task {
    const data = parse(taskCreateSchema, input);
    const now = nowIso();
    const siblings = this.list().filter((t) => t.status === data.status);
    const task: Task = {
      ...data,
      projectPath: data.projectPath ?? null,
      dueDate: data.dueDate ?? null,
      checklist: data.checklist.map((c) => ({ id: c.id || newCheckId(), text: c.text, done: c.done })),
      id: crypto.randomUUID(),
      order: siblings.length ? Math.max(...siblings.map((t) => t.order)) + 1 : 0,
      runIds: [],
      templateId: null,
      createdAt: now,
      updatedAt: now,
      ...extra,
    };
    this.store.update<Task[]>(T, [], (all) => {
      if (all.length >= 5000) throw new HttpError(400, "Too many tasks (max 5000)");
      all.push(task);
    });
    return task;
  }

  update(id: string, input: unknown): Task {
    const patch = parse(taskUpdateSchema, input);
    let updated: Task | undefined;
    this.store.update<Task[]>(T, [], (all) => {
      const i = all.findIndex((t) => t.id === id);
      if (i < 0) throw new HttpError(404, "Task not found");
      const next = { ...all[i], ...patch, updatedAt: nowIso() } as Task;
      if (patch.checklist) next.checklist = patch.checklist.map((c) => ({ id: c.id || newCheckId(), text: c.text, done: c.done }));
      if (patch.status && patch.status !== all[i].status && patch.order === undefined) {
        const col = all.filter((t) => t.status === patch.status);
        next.order = col.length ? Math.max(...col.map((t) => t.order)) + 1 : 0;
      }
      all[i] = next;
      updated = next;
    });
    return updated!;
  }

  /** Link a run to a task (and move it to in_progress). */
  attachRun(id: string, runId: string) {
    this.store.update<Task[]>(T, [], (all) => {
      const t = all.find((x) => x.id === id);
      if (!t) return;
      t.runIds = [...(t.runIds || []), runId].slice(-200);
      if (t.status === "backlog" || t.status === "todo") t.status = "in_progress";
      t.updatedAt = nowIso();
    });
  }

  /** When a run finishes successfully, move its task to review. */
  onRunFinished(id: string, ok: boolean) {
    this.store.update<Task[]>(T, [], (all) => {
      const t = all.find((x) => x.id === id);
      if (t && ok && t.status === "in_progress") {
        t.status = "review";
        t.updatedAt = nowIso();
      }
    });
  }

  remove(id: string) {
    this.store.update<Task[]>(T, [], (all) => {
      const i = all.findIndex((t) => t.id === id);
      if (i < 0) throw new HttpError(404, "Task not found");
      all.splice(i, 1);
    });
  }

  // ---- templates ----

  templates(): Template[] {
    const stored = this.store.read<Template[] | null>(TPL, null);
    if (stored) return stored;
    const now = nowIso();
    return this.store.write<Template[]>(TPL, DEFAULT_TEMPLATES.map((t) => ({ ...t, createdAt: now, updatedAt: now })));
  }

  template(id: string): Template {
    const t = this.templates().find((x) => x.id === id);
    if (!t) throw new HttpError(404, "Template not found");
    return t;
  }

  createTemplate(input: unknown): Template {
    const data = parse(templateSchema, input);
    const now = nowIso();
    const tpl: Template = { ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    this.templates();
    this.store.update<Template[]>(TPL, [], (all) => {
      if (all.length >= 500) throw new HttpError(400, "Too many templates");
      all.push(tpl);
    });
    return tpl;
  }

  updateTemplate(id: string, input: unknown): Template {
    const data = parse(templateSchema, input);
    let out: Template | undefined;
    this.templates();
    this.store.update<Template[]>(TPL, [], (all) => {
      const i = all.findIndex((t) => t.id === id);
      if (i < 0) throw new HttpError(404, "Template not found");
      out = { ...all[i], ...data, updatedAt: nowIso() };
      all[i] = out;
    });
    return out!;
  }

  removeTemplate(id: string) {
    this.templates();
    this.store.update<Template[]>(TPL, [], (all) => {
      const i = all.findIndex((t) => t.id === id);
      if (i < 0) throw new HttpError(404, "Template not found");
      all.splice(i, 1);
    });
  }

  /** Create a task from a template, filling `{{variables}}`. */
  instantiate(templateId: string, input: unknown): Task {
    const tpl = this.template(templateId);
    const { values, projectPath, status } = parse(instantiateSchema, input);
    const vars: Record<string, string> = {};
    for (const v of tpl.variables) vars[v.name] = (values[v.name] ?? "").trim() || v.default;
    const title = renderTemplate(tpl.title, vars).trim() || tpl.name;
    return this.create(
      {
        title: title.slice(0, 200),
        description: renderTemplate(tpl.body, vars),
        prompt: renderTemplate(tpl.prompt, vars),
        priority: tpl.priority,
        labels: tpl.labels,
        checklist: tpl.checklist.map((c) => ({ text: renderTemplate(c, vars) || c, done: false })),
        projectPath: projectPath ?? null,
        status,
      },
      { templateId: tpl.id },
    );
  }
}
