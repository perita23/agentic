"use client";

import * as React from "react";
import Link from "next/link";
import { CircleAlertIcon, CircleCheckIcon, OctagonXIcon, PencilIcon, PiggyBankIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api, refresh, useApi } from "@/lib/api";
import type { BudgetConfig, BudgetLine, BudgetStatus } from "@/lib/server/budgets";
import { cn, formatTokens } from "@/lib/utils";
import { errorMessage } from "./common";

const KEY = "/api/budgets";
const LABEL: Record<BudgetLine["meter"], Record<BudgetLine["period"], string>> = {
  runsUsd: { daily: "Gasto hoy · ejecuciones", monthly: "Gasto del mes · ejecuciones" },
  tokens: { daily: "Tokens hoy · todo Claude Code", monthly: "Tokens del mes · todo Claude Code" },
};
const LEVEL = {
  ok: { icon: CircleCheckIcon, text: "En orden", tone: "text-success", bar: "bg-success" },
  warn: { icon: CircleAlertIcon, text: "Cerca del límite", tone: "text-warning", bar: "bg-warning" },
  over: { icon: OctagonXIcon, text: "Superado", tone: "text-destructive", bar: "bg-destructive" },
} as const;

const fmt = (l: Pick<BudgetLine, "meter">, n: number) => (l.meter === "runsUsd" ? `$${n > 0 && n < 0.01 ? n.toPrecision(1) : n.toFixed(2)}` : formatTokens(n));
const pctText = (r: number) => (r > 9.99 ? ">999 %" : `${Math.round(r * 100)} %`);

function Meter({ line }: { line: BudgetLine }) {
  const lv = LEVEL[line.level];
  const pct = Math.min(100, line.ratio * 100);
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium">{LABEL[line.meter][line.period]}</span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {fmt(line, line.used)} / {fmt(line, line.limit)}
        </span>
        <span className={cn("ml-auto flex items-center gap-1 text-xs", lv.tone)}>
          <lv.icon className="size-3.5" /> {lv.text} · {pctText(line.ratio)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary" role="meter" aria-label={LABEL[line.meter][line.period]} aria-valuemin={0} aria-valuemax={line.limit} aria-valuenow={line.used}>
        <div className={cn("h-full rounded-full transition-[width]", lv.bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function num(v: string) {
  const n = Number(v.replace(",", "."));
  return v.trim() && Number.isFinite(n) && n > 0 ? n : null;
}

function EditDialog({ config, onClose }: { config: BudgetConfig; onClose: () => void }) {
  const str = (n: number | null) => (n === null ? "" : String(n));
  const [f, setF] = React.useState({
    usdDaily: str(config.runsUsd.daily),
    usdMonthly: str(config.runsUsd.monthly),
    tokDaily: config.tokens.daily ? String(config.tokens.daily / 1e6) : "",
    tokMonthly: config.tokens.monthly ? String(config.tokens.monthly / 1e6) : "",
    warnAt: String(Math.round(config.warnAt * 100)),
    blockAutomation: config.blockAutomation,
  });
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const m = (v: string) => (num(v) === null ? null : Math.round(num(v)! * 1e6));
    try {
      await api("PUT", KEY, {
        runsUsd: { daily: num(f.usdDaily), monthly: num(f.usdMonthly) },
        tokens: { daily: m(f.tokDaily), monthly: m(f.tokMonthly) },
        warnAt: Math.min(99, Math.max(50, Number(f.warnAt) || 80)) / 100,
        blockAutomation: f.blockAutomation,
      });
      toast.success("Presupuesto guardado");
      refresh(KEY);
      onClose();
    } catch (err) {
      toast.error("No se pudo guardar", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  const field = (id: keyof typeof f, label: string, placeholder: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`b-${id}`}>{label}</Label>
      <Input id={`b-${id}`} inputMode="decimal" placeholder={placeholder} value={f[id] as string} onChange={(e) => set(id, e.target.value)} />
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Presupuesto</DialogTitle>
            <DialogDescription>Deja un campo vacío para no limitarlo. Te avisamos aquí y por Slack (si está conectado).</DialogDescription>
          </DialogHeader>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Dinero (ejecuciones lanzadas desde Agentic, coste real)</legend>
            <div className="grid grid-cols-2 gap-3">
              {field("usdDaily", "Al día (USD)", "p. ej. 5")}
              {field("usdMonthly", "Al mes (USD)", "p. ej. 100")}
            </div>
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Tokens (todo Claude Code en este dispositivo, entrada + salida)</legend>
            <div className="grid grid-cols-2 gap-3">
              {field("tokDaily", "Al día (millones)", "p. ej. 2")}
              {field("tokMonthly", "Al mes (millones)", "p. ej. 40")}
            </div>
          </fieldset>
          <div className="grid grid-cols-[auto_1fr] items-center gap-3">
            <Input aria-label="Avisar al (%)" type="number" min={50} max={99} value={f.warnAt} onChange={(e) => set("warnAt", e.target.value)} className="w-20" />
            <span className="text-sm text-muted-foreground">% del límite: aviso previo</span>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
            <Switch checked={f.blockAutomation} onCheckedChange={(v) => set("blockAutomation", v)} aria-label="Pausar lo automático al superar el gasto" />
            <span className="grid gap-0.5 text-sm">
              <span className="font-medium">Pausar lo automático al superar el gasto</span>
              <span className="text-xs text-muted-foreground">La cola de tareas y las programadas no arrancan mientras se supere un límite en USD. Lo que lances tú a mano sigue funcionando.</span>
            </span>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BudgetCard() {
  const { data } = useApi<BudgetStatus>(KEY, { refreshInterval: 60_000 });
  const [editing, setEditing] = React.useState(false);
  return (
    <Card id="presupuesto">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <PiggyBankIcon className="size-4" /> Presupuesto
          </CardTitle>
          <CardDescription>Límites de gasto con aviso previo. Los días van en UTC.</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={!data} className="ml-auto">
          <PencilIcon /> {data?.lines.length ? "Editar" : "Definir límites"}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4">
        {data && !data.lines.length && <p className="text-sm text-muted-foreground">Sin límites. Define un tope diario o mensual y te avisaremos antes de llegar.</p>}
        {data?.lines.map((l) => <Meter key={`${l.meter}.${l.period}`} line={l} />)}
        {data?.blocked && <p className="text-xs text-destructive">La cola y las programadas están en pausa hasta que el gasto vuelva a estar dentro del límite.</p>}
      </CardContent>
      {editing && data && <EditDialog config={data.config} onClose={() => setEditing(false)} />}
    </Card>
  );
}

/** Thin strip under the top bar while a limit is near or exceeded. */
export function BudgetBanner() {
  const { data } = useApi<BudgetStatus>(KEY, { refreshInterval: 60_000 });
  if (!data || data.level === "ok") return null;
  const worst = [...data.lines].sort((a, b) => b.ratio - a.ratio)[0];
  const over = data.level === "over";
  const Icon = over ? OctagonXIcon : CircleAlertIcon;
  return (
    <div role="status" className={cn("flex items-center gap-2 border-b px-4 py-1.5 text-xs md:px-6", over ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning")}>
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">
        {over ? "Presupuesto superado" : "Cerca del presupuesto"} · {LABEL[worst.meter][worst.period]}: {fmt(worst, worst.used)} de {fmt(worst, worst.limit)}
        {data.blocked && " · lo automático está en pausa"}
      </span>
      <Link href="/analytics#presupuesto" className="ml-auto shrink-0 underline-offset-2 hover:underline">
        Ver
      </Link>
    </div>
  );
}
