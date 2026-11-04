"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { ChartColumnIcon, CircleDollarSignIcon, CoinsIcon, MessagesSquareIcon, SparklesIcon, TableIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader, Stat } from "@/components/app/common";
import { BudgetCard } from "@/components/app/budget";
import { useApi, type ProjectListItem, type Run } from "@/lib/api";
import { baseName, cn, formatTokens } from "@/lib/utils";

interface Day {
  date: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  messages: number;
  sessions: number;
}
interface Analytics {
  days: Day[];
  byProject: { path: string; tokens: number; sessions: number }[];
  byModel: { model: string; tokens: number }[];
  tools: { name: string; count: number }[];
  totals: Omit<Day, "date">;
}

const ALL = "__all";
const RANGES = [7, 30, 90] as const;
const total = (d: Omit<Day, "date" | "messages" | "sessions">) => d.input + d.output + d.cacheRead + d.cacheWrite;
const fmtDate = (d: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => new Date(`${d}T12:00:00Z`).toLocaleDateString("es-ES", opts);

/** Single-series daily column chart with a per-bar hover tooltip. */
function DailyChart({ days }: { days: Day[] }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const max = Math.max(1, ...days.map(total));
  const ticks = [max, max / 2, 0];
  const h = days[hover ?? -1];
  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="flex h-48 flex-col justify-between py-0 text-right text-[11px] text-muted-foreground tabular-nums">
          {ticks.map((t, i) => (
            <span key={i} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {formatTokens(Math.round(t))}
            </span>
          ))}
        </div>
        <div className="relative h-48 flex-1" onMouseLeave={() => setHover(null)}>
          {/* recessive grid */}
          {[0, 50, 100].map((p) => (
            <div key={p} className="pointer-events-none absolute inset-x-0 border-t border-border/60" style={{ top: `${p}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {days.map((d, i) => {
              const v = total(d);
              return (
                <button
                  key={d.date}
                  aria-label={`${fmtDate(d.date)}: ${formatTokens(v)} tokens`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="group relative flex h-full min-w-0 flex-1 cursor-default items-end outline-none"
                >
                  <motion.span
                    initial={{ height: 0 }}
                    animate={{ height: `${(v / max) * 100}%` }}
                    transition={{ duration: 0.4, delay: Math.min(i * 0.008, 0.3) }}
                    className={cn("block w-full rounded-t-[4px] bg-primary transition-opacity", v > 0 && "min-h-[2px]", hover !== null && hover !== i && "opacity-40")}
                  />
                </button>
              );
            })}
          </div>
          {h && (
            <div
              className={cn(
                "pointer-events-none absolute top-2 z-10 w-52 rounded-md border bg-popover p-2.5 text-xs shadow-xl",
                // keep the tooltip inside the plot near the edges
                hover! < days.length * 0.2 ? "translate-x-2" : hover! > days.length * 0.8 ? "-translate-x-[calc(100%+0.5rem)]" : "-translate-x-1/2",
              )}
              style={{ left: `${((hover! + 0.5) / days.length) * 100}%` }}
            >
              <div className="mb-1.5 font-medium">{fmtDate(h.date, { weekday: "short", day: "numeric", month: "long" })}</div>
              {[
                ["Total", total(h)],
                ["Entrada", h.input],
                ["Salida", h.output],
                ["Caché lectura", h.cacheRead],
                ["Caché escritura", h.cacheWrite],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="tabular-nums">{formatTokens(v as number)}</span>
                </div>
              ))}
              <div className="mt-1 flex justify-between gap-3 border-t pt-1">
                <span className="text-muted-foreground">Sesiones · mensajes</span>
                <span className="tabular-nums">
                  {h.sessions} · {h.messages}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="mt-1.5 ml-10 flex justify-between text-[11px] text-muted-foreground">
        <span>{fmtDate(days[0].date)}</span>
        <span>{fmtDate(days[days.length - 1].date)}</span>
      </div>
    </div>
  );
}

/** Ranked horizontal bars (single series). */
function RankedBars({ items, format }: { items: { key: string; label: React.ReactNode; value: number }[]; format: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="text-sm text-muted-foreground">Sin datos en este periodo.</p>;
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((it, i) => (
        <div key={it.key} className="grid gap-1">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">{it.label}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{format(it.value)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <motion.div className="h-full rounded-full bg-primary" initial={{ width: 0 }} animate={{ width: `${(it.value / max) * 100}%` }} transition={{ delay: i * 0.03 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const [days, setDays] = React.useState<(typeof RANGES)[number]>(30);
  const [project, setProject] = React.useState(ALL);
  const [table, setTable] = React.useState(false);
  const qs = new URLSearchParams({ days: String(days) });
  if (project !== ALL) qs.set("project", project);
  const { data, error, isLoading } = useApi<Analytics>(`/api/analytics?${qs}`, { keepPreviousData: true });
  const { data: projects } = useApi<{ projects: ProjectListItem[] }>("/api/projects");
  const { data: runs } = useApi<{ runs: Run[] }>("/api/runs");

  const since = data?.days[0]?.date ?? "";
  const runCost = (runs?.runs ?? [])
    .filter((r) => r.startedAt.slice(0, 10) >= since && (project === ALL || r.projectPath === project))
    .reduce((a, r) => a + (r.costUsd ?? 0), 0);
  const t = data?.totals;
  const hasData = !!t && total(t) + t.messages > 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={ChartColumnIcon} title="Analítica" description="Uso de Claude Code calculado a partir de tus transcripciones locales (días en UTC)." />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex w-fit rounded-md border p-0.5" role="group" aria-label="Periodo">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setDays(r)}
              aria-pressed={days === r}
              className={cn("cursor-pointer rounded px-3 py-1 text-sm", days === r ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {r} días
            </button>
          ))}
        </div>
        <Select value={project} onValueChange={setProject}>
          <SelectTrigger className="sm:w-60">
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

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Tokens totales" value={t ? formatTokens(total(t)) : <Skeleton className="h-7 w-16" />} hint={t ? `${formatTokens(t.cacheRead)} desde caché` : undefined} icon={CoinsIcon} accent="text-primary" />
        <Stat label="Tokens de salida" value={t ? formatTokens(t.output) : <Skeleton className="h-7 w-16" />} hint={t ? `${formatTokens(t.input)} de entrada` : undefined} icon={SparklesIcon} accent="text-purple" />
        <Stat label="Sesiones" value={t ? t.sessions : <Skeleton className="h-7 w-10" />} hint={t ? `${t.messages} mensajes` : undefined} icon={MessagesSquareIcon} accent="text-success" />
        <Stat label="Coste (ejecuciones Agentic)" value={runs ? `$${runCost.toFixed(2)}` : <Skeleton className="h-7 w-14" />} hint="coste real reportado por Claude" icon={CircleDollarSignIcon} accent="text-warning" />
      </div>

      <BudgetCard />

      {data && !hasData && !isLoading ? (
        <EmptyState icon={ChartColumnIcon} title="Sin actividad en este periodo" description="Prueba un rango mayor u otro proyecto." />
      ) : (
        <>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Tokens por día</CardTitle>
                <CardDescription>Entrada + salida + caché. Pasa el ratón por una barra para ver el desglose.</CardDescription>
              </div>
              <button
                onClick={() => setTable(!table)}
                aria-pressed={table}
                className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <TableIcon className="size-3.5" /> {table ? "Gráfico" : "Tabla"}
              </button>
            </CardHeader>
            <CardContent>
              {!data ? (
                <Skeleton className="h-52" />
              ) : table ? (
                <div className="max-h-80 overflow-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                      <tr>
                        {["Día", "Total", "Entrada", "Salida", "Caché lect.", "Caché escr.", "Sesiones", "Mensajes"].map((h) => (
                          <th key={h} className="px-3 py-2 text-right font-medium first:text-left">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {[...data.days].reverse().map((d) => (
                        <tr key={d.date} className="border-t">
                          <td className="px-3 py-1.5">{fmtDate(d.date, { day: "2-digit", month: "short", year: "numeric" })}</td>
                          {[total(d), d.input, d.output, d.cacheRead, d.cacheWrite, d.sessions, d.messages].map((v, i) => (
                            <td key={i} className="px-3 py-1.5 text-right">
                              {i < 5 ? formatTokens(v) : v}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <DailyChart days={data.days} />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Por proyecto</CardTitle>
              </CardHeader>
              <CardContent>
                <RankedBars
                  format={formatTokens}
                  items={(data?.byProject ?? []).slice(0, 8).map((p) => ({
                    key: p.path,
                    value: p.tokens,
                    label: (
                      <Link href={`/projects/view?path=${encodeURIComponent(p.path)}`} className="hover:text-link">
                        {baseName(p.path)} <span className="text-xs text-muted-foreground">· {p.sessions} ses.</span>
                      </Link>
                    ),
                  }))}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Por modelo</CardTitle>
              </CardHeader>
              <CardContent>
                <RankedBars format={formatTokens} items={(data?.byModel ?? []).slice(0, 8).map((m) => ({ key: m.model, value: m.tokens, label: <span className="font-mono text-xs">{m.model}</span> }))} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Herramientas más usadas</CardTitle>
              </CardHeader>
              <CardContent>
                <RankedBars format={(n) => `${n}×`} items={(data?.tools ?? []).slice(0, 8).map((x) => ({ key: x.name, value: x.count, label: <span className="font-mono text-xs">{x.name}</span> }))} />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
