"use client";

import { BellIcon, CheckCircle2Icon, SettingsIcon, ShieldCheckIcon, XCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setNotificationsEnabled, useNotificationPref } from "@/lib/notify";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton, PageHeader } from "@/components/app/common";
import { useApi, type SystemInfo } from "@/lib/api";

function Row({ k, v, mono, copy }: { k: string; v: React.ReactNode; mono?: boolean; copy?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className={`flex items-center gap-1 truncate ${mono ? "font-mono text-xs" : ""}`}>
        {v}
        {copy && <CopyButton value={copy} />}
      </span>
    </div>
  );
}

const Ok = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
  <span className="flex items-center gap-1.5">
    {ok ? <CheckCircle2Icon className="size-4 text-success" /> : <XCircleIcon className="size-4 text-destructive" />} {children}
  </span>
);

function NotificationsCard() {
  const { supported, enabled: on } = useNotificationPref();
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <BellIcon className="size-4" /> Notificaciones
          </CardTitle>
          <CardDescription>Avisos de escritorio cuando termina una ejecución y la pestaña no está visible.</CardDescription>
        </div>
        <Switch
          aria-label="Notificaciones de escritorio"
          checked={on}
          disabled={!supported}
          onCheckedChange={async (v) => {
            const res = await setNotificationsEnabled(v);
            if (v && !res) toast.error("El navegador ha bloqueado las notificaciones");
          }}
        />
      </CardHeader>
      {!supported && (
        <CardContent className="text-xs text-muted-foreground">Este navegador no soporta notificaciones.</CardContent>
      )}
    </Card>
  );
}

export default function SettingsPage() {
  const { data } = useApi<SystemInfo>("/api/system");
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={SettingsIcon} title="Ajustes" description="Configuración del entorno local. Se cambia con variables de entorno al arrancar." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Sistema</CardTitle>
              <CardDescription>Dependencias detectadas en esta máquina.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {!data ? (
              <Skeleton className="h-40" />
            ) : (
              <>
                <Row k="Agentic" v={`v${data.version}`} mono />
                <Row k="Claude Code" v={<Ok ok={!!data.claudeVersion}>{data.claudeVersion ?? "no encontrado"}</Ok>} />
                <Row k="Binario (CLAUDE_BIN)" v={data.claudeBin} mono />
                <Row k="tmux" v={<Ok ok={data.tmux}>{data.tmux ? "disponible" : "no instalado"}</Ok>} />
                <Row k="Node.js" v={data.node} mono />
                <Row k="Plataforma" v={data.platform} mono />
                <Row k="Ejecuciones simultáneas (AGENTIC_MAX_RUNS)" v={data.maxConcurrentRuns} />
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Datos locales</CardTitle>
              <CardDescription>Todo se guarda en tu ordenador; nada sale de él.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {data && (
              <>
                <Row k="Datos de Agentic (AGENTIC_HOME)" v={data.dataDir} mono copy={data.dataDir} />
                <Row k="Datos de Claude Code (CLAUDE_HOME)" v={data.claudeHome} mono copy={data.claudeHome} />
                <Row k="Tareas / plantillas / proyectos" v={`${data.dataDir}/*.json`} mono />
                <Row k="Logs de ejecuciones" v={`${data.dataDir}/runs/`} mono />
              </>
            )}
          </CardContent>
        </Card>
        <NotificationsCard />
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheckIcon className="size-4 text-success" /> Seguridad
              </CardTitle>
              <CardDescription>Agentic puede ejecutar Claude Code en tu máquina, así que está protegido aunque sólo escuche en local.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            {[
              "Escucha sólo en 127.0.0.1 (loopback).",
              "Token aleatorio de 256 bits; cookie HttpOnly + SameSite=Strict.",
              "Allow-list de Host contra ataques de DNS rebinding.",
              "Comprobación de Origin / Sec-Fetch-Site y JSON obligatorio (anti-CSRF).",
              "CSP con nonce por petición, sin scripts inline ni eval en producción.",
              "Procesos lanzados sin shell; el prompt va tras `--`.",
              "git se ejecuta con fsmonitor/hooks desactivados.",
              "Límites de tamaño de petición, logs y ejecuciones simultáneas.",
            ].map((t) => (
              <div key={t} className="flex items-start gap-2">
                <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" /> {t}
              </div>
            ))}
            <p className="mt-2 sm:col-span-2">
              Para cerrar todas las sesiones del navegador ejecuta <code className="rounded bg-secondary px-1 font-mono text-xs">npm run rotate-token</code> y reinicia.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
