"use client";

import * as React from "react";
import { GaugeIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useApi } from "@/lib/api";
import { limitLabel, STATUS_LABEL, untilReset, type RateLimit } from "@/lib/usage";
import { cn, formatTokens } from "@/lib/utils";

const TONE = { ok: { bar: "bg-success", text: "text-success" }, warn: { bar: "bg-warning", text: "text-warning" }, over: { bar: "bg-destructive", text: "text-destructive" } } as const;

function Limit({ l, now }: { l: RateLimit; now: number }) {
  const expired = l.resetsAt !== null && l.resetsAt <= now;
  const st = STATUS_LABEL[l.status] ?? STATUS_LABEL.allowed;
  const tone = TONE[expired ? "ok" : st.level];
  const pct = l.utilization !== null && !expired ? Math.round(l.utilization * 100) : null;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline gap-2 text-sm">
        <span className="font-medium">{limitLabel(l.type)}</span>
        <span className={cn("ml-auto text-xs", tone.text)}>{expired ? "Reiniciado" : pct !== null ? `${pct} % usado` : st.text}</span>
      </div>
      {pct !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary" role="meter" aria-label={limitLabel(l.type)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className={cn("h-full rounded-full transition-[width] duration-700", tone.bar)} style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        {expired
          ? "La ventana ya se reinició: el uso actual se verá en la próxima ejecución."
          : l.resetsAt
            ? `Se reinicia en ${untilReset(l.resetsAt, now)} · ${new Date(l.resetsAt).toLocaleString("es-ES", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`
            : "Hora de reinicio no indicada."}
        {pct !== null && <span> · {st.text}</span>}
      </div>
    </div>
  );
}

/** Plan usage (as Claude Code reports it while it runs) and when each window resets. */
export function UsageCard({ className }: { className?: string }) {
  const { data } = useApi<{ limits: RateLimit[]; tokensToday: number }>("/api/usage", { refreshInterval: 60_000 });
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const order = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet", "overage"];
  const limits = [...(data?.limits ?? [])].sort((a, b) => (order.indexOf(a.type) + 99) % 99 - (order.indexOf(b.type) + 99) % 99);
  return (
    <Card className={className}>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <GaugeIcon className="size-4" /> Uso de Claude
          </CardTitle>
          <CardDescription>Según lo que informa Claude Code al ejecutar.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {data && !limits.length && <p className="text-xs text-muted-foreground">Todavía no hay datos: Claude Code informa de tu uso mientras corre. Lanza una ejecución y aparecerá aquí.</p>}
        {limits.map((l) => (
          <Limit key={l.type} l={l} now={now} />
        ))}
        {data && <p className="border-t pt-3 text-xs text-muted-foreground">Hoy en este dispositivo: <span className="font-mono text-foreground">{formatTokens(data.tokensToday)}</span> tokens (entrada + salida)</p>}
      </CardContent>
    </Card>
  );
}
