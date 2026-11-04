"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarIcon, CheckSquareIcon, FileStackIcon, FolderIcon, GitBranchIcon, KanbanSquareIcon, PlayIcon, PlusIcon, RocketIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage, PageHeader } from "@/components/app/common";
import { useLauncher } from "@/components/app/launcher";
import { PRIORITIES, STATUSES, TaskDialog, type Status } from "@/components/app/task-dialog";
import { TemplatePicker } from "@/components/app/template-picker";
import { useQueue } from "@/components/app/queue-panel";
import { api, useApi, type ProjectListItem, type Task } from "@/lib/api";
import { baseName, cn } from "@/lib/utils";

const ALL = "__all";
type TasksData = { tasks: Task[] };

function SortableTaskCard({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { status: task.status } });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
        listeners?.onKeyDown?.(e);
      }}
      className={cn("rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring", isDragging && "opacity-30")}
    >
      <TaskCard task={task} />
    </div>
  );
}

function TaskCard({ task, overlay }: { task: Task; overlay?: boolean }) {
  const launcher = useLauncher();
  const prio = PRIORITIES.find((p) => p.key === task.priority)!;
  const done = task.checklist.filter((c) => c.done).length;
  const overdue = task.dueDate && task.status !== "done" && task.dueDate < new Date().toISOString().slice(0, 10);

  return (
    <div
      className={cn(
        "group cursor-grab touch-none rounded-lg border bg-card p-3 text-left shadow-sm transition-colors hover:border-border-strong active:cursor-grabbing",
        overlay && "rotate-2 border-primary/60 shadow-2xl shadow-black/60",
      )}
    >
      <div className="flex items-start gap-2">
        <span className={cn("mt-1 text-[10px]", prio.className)} title={`Prioridad ${prio.label}`}>
          ●
        </span>
        <span className="flex-1 text-sm leading-snug font-medium">{task.title}</span>
        {task.projectPath && task.status !== "done" && (
          <button
            aria-label="Ejecutar con Claude"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              launcher.open({ taskId: task.id, projectPath: task.projectPath, prompt: task.prompt || `${task.title}\n\n${task.description}`.trim(), title: `Ejecutar tarea: ${task.title}`, worktree: !!task.worktree });
            }}
            className="cursor-pointer rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-success"
          >
            <PlayIcon className="size-3.5" />
          </button>
        )}
      </div>
      {task.description && <p className="mt-1 line-clamp-2 pl-4 text-xs text-muted-foreground">{task.description}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-4 text-[11px] text-muted-foreground">
        {task.labels.map((l) => (
          <Badge key={l} variant="blue" className="px-1.5 py-0 text-[10px]">
            {l}
          </Badge>
        ))}
        {task.projectPath && (
          <span className="flex items-center gap-1">
            <FolderIcon className="size-3" /> {baseName(task.projectPath)}
          </span>
        )}
        {task.checklist.length > 0 && (
          <span className={cn("flex items-center gap-1", done === task.checklist.length && "text-success")}>
            <CheckSquareIcon className="size-3" /> {done}/{task.checklist.length}
          </span>
        )}
        {task.worktree && (
          <span className="flex min-w-0 items-center gap-1 font-mono" title={`Worktree: ${task.worktree.branch}`}>
            <GitBranchIcon className="size-3 shrink-0" /> <span className="max-w-32 truncate">{task.worktree.branch.replace(/^agentic\//, "")}</span>
          </span>
        )}
        {task.runIds.length > 0 && (
          <span className="flex items-center gap-1">
            <RocketIcon className="size-3" /> {task.runIds.length}
          </span>
        )}
        {task.dueDate && (
          <span className={cn("flex items-center gap-1", overdue && "text-destructive")}>
            <CalendarIcon className="size-3" /> {task.dueDate}
          </span>
        )}
      </div>
    </div>
  );
}

function Column({ status, tasks, onOpen, onAdd }: { status: (typeof STATUSES)[number]; tasks: Task[]; onOpen: (t: Task) => void; onAdd: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status.key, data: { status: status.key } });
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl border bg-sidebar/60 lg:w-auto lg:min-w-0 lg:flex-1">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className={`size-2.5 rounded-full ${status.color}`} />
        <span className="text-sm font-semibold">{status.label}</span>
        <span className="rounded-full bg-secondary px-1.5 text-xs text-muted-foreground tabular-nums">{tasks.length}</span>
        <button aria-label={`Añadir tarea en ${status.label}`} onClick={onAdd} className="ml-auto cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <PlusIcon className="size-4" />
        </button>
      </div>
      <SortableContext id={status.key} items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className={cn("flex min-h-32 flex-1 flex-col gap-2 rounded-b-xl p-2 transition-colors", isOver && "bg-primary/5")}>
          <AnimatePresence initial={false}>
            {tasks.map((t) => (
              <motion.div key={t.id} layout="position" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}>
                <SortableTaskCard task={t} onOpen={() => onOpen(t)} />
              </motion.div>
            ))}
          </AnimatePresence>
          {tasks.length === 0 && <div className="grid flex-1 place-items-center rounded-lg border border-dashed text-xs text-muted-foreground">Suelta tareas aquí</div>}
        </div>
      </SortableContext>
    </div>
  );
}

function Board() {
  const router = useRouter();
  const params = useSearchParams();
  const { data, mutate } = useApi<TasksData>("/api/tasks");
  const { data: projects } = useApi<{ projects: ProjectListItem[] }>("/api/projects");
  const [q, setQ] = React.useState("");
  const [project, setProject] = React.useState(ALL);
  const [dialog, setDialog] = React.useState<{ task?: Task; status?: Status } | null>(params.get("new") ? {} : null);
  const [picker, setPicker] = React.useState(false);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const queue = useQueue(project !== ALL ? project : undefined);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  // Open a task from ?task=<id> (e.g. linked from a run).
  const taskParam = params.get("task");
  const linked = taskParam ? data?.tasks.find((t) => t.id === taskParam) : undefined;
  const effectiveDialog = dialog ?? (linked ? { task: linked } : null);

  const all = data?.tasks ?? [];
  const ql = q.toLowerCase();
  const visible = all.filter(
    (t) => (project === ALL || t.projectPath === project) && (!ql || `${t.title} ${t.description} ${t.labels.join(" ")}`.toLowerCase().includes(ql)),
  );
  const byStatus = (s: Status) => visible.filter((t) => t.status === s).sort((a, b) => a.order - b.order);

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const task = all.find((t) => t.id === active.id);
    if (!task) return;
    const overTask = all.find((t) => t.id === over.id);
    const target = (overTask?.status ?? (over.data.current?.status as Status) ?? over.id) as Status;
    if (!STATUSES.some((s) => s.key === target)) return;
    const column = byStatus(target).filter((t) => t.id !== task.id);
    let index = overTask ? column.findIndex((t) => t.id === overTask.id) : column.length;
    if (overTask && task.status === target) {
      const oldIndex = byStatus(target).findIndex((t) => t.id === task.id);
      const overIndex = byStatus(target).findIndex((t) => t.id === overTask.id);
      if (oldIndex < overIndex) index += 1; // moving down: drop after the hovered card
    }
    if (index < 0) index = column.length;
    const prev = column[index - 1];
    const next = column[index];
    const order = prev && next ? (prev.order + next.order) / 2 : prev ? prev.order + 1 : next ? next.order - 1 : 0;
    if (task.status === target && task.order === order) return;

    const optimistic = { tasks: all.map((t) => (t.id === task.id ? { ...t, status: target, order } : t)) };
    try {
      await mutate(
        async () => {
          await api("PATCH", `/api/tasks/${task.id}`, { status: target, order });
          return optimistic;
        },
        { optimisticData: optimistic, rollbackOnError: true, revalidate: true },
      );
    } catch (err) {
      toast.error("No se pudo mover la tarea", { description: errorMessage(err) });
    }
  }

  const activeTask = activeId ? all.find((t) => t.id === activeId) : null;
  const closeDialog = () => {
    setDialog(null);
    if (params.get("new") || params.get("task")) router.replace("/tasks");
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={KanbanSquareIcon}
        title="Tareas"
        description="Planifica el trabajo, arrastra entre columnas y lánzalo con Claude Code."
        actions={
          <>
            {queue.button}
            <Button variant="outline" onClick={() => setPicker(true)}>
              <FileStackIcon /> Desde plantilla
            </Button>
            <Button onClick={() => setDialog({})}>
              <PlusIcon /> Nueva tarea
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <SearchIcon className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input placeholder="Filtrar tareas…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={project} onValueChange={setProject}>
          <SelectTrigger className="sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los proyectos</SelectItem>
            {projects?.projects.map((p) => (
              <SelectItem key={p.path} value={p.path}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {queue.banner}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
          {STATUSES.map((s) => (
            <Column key={s.key} status={s} tasks={byStatus(s.key)} onOpen={(t) => setDialog({ task: t })} onAdd={() => setDialog({ status: s.key })} />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}>{activeTask ? <TaskCard task={activeTask} overlay /> : null}</DragOverlay>
      </DndContext>

      {effectiveDialog && (
        <TaskDialog
          key={effectiveDialog.task?.id ?? "new"}
          task={effectiveDialog.task}
          defaults={{ status: effectiveDialog.status, projectPath: project !== ALL ? project : undefined }}
          onClose={closeDialog}
        />
      )}
      {queue.dialog}
      {picker && <TemplatePicker defaultProject={project !== ALL ? project : undefined} onClose={() => setPicker(false)} />}
    </div>
  );
}

export default function TasksPage() {
  return (
    <React.Suspense>
      <Board />
    </React.Suspense>
  );
}
