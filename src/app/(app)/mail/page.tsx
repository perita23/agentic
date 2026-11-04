"use client";

import * as React from "react";
import { AlertTriangleIcon, CheckIcon, InboxIcon, MailIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, errorMessage, PageHeader } from "@/components/app/common";
import { api, refresh, useApi, type ProjectListItem } from "@/lib/api";
import { MAIL_CATEGORIES, MAIL_CATEGORY_LABEL, type MailCategory } from "@/lib/mail";
import type { MailItem } from "@/lib/server/mail";
import { cn, timeAgo } from "@/lib/utils";

interface Overview {
  accounts: { id: string; label: string; host: string; user: string; lastSyncAt: string | null; lastError: string | null }[];
  settings: { enabled: boolean; intervalMin: number; days: number; lastRunAt: string | null };
  running: boolean;
  items: MailItem[];
}

const PRESETS = [
  { id: "gmail", name: "Gmail", host: "imap.gmail.com", help: "Crea una «contraseña de aplicación» en myaccount.google.com/apppasswords (hace falta la verificación en dos pasos)." },
  { id: "outlook", name: "Outlook / Microsoft 365", host: "outlook.office365.com", help: "Si tu cuenta tiene verificación en dos pasos, usa una contraseña de aplicación. Algunas cuentas de empresa no permiten IMAP." },
  { id: "icloud", name: "iCloud", host: "imap.mail.me.com", help: "Genera una contraseña específica de app en appleid.apple.com → Inicio de sesión y seguridad." },
  { id: "yahoo", name: "Yahoo", host: "imap.mail.yahoo.com", help: "Genera una contraseña de app en Seguridad de la cuenta de Yahoo." },
  { id: "fastmail", name: "Fastmail", host: "imap.fastmail.com", help: "Crea una contraseña de app en Ajustes → Privacidad y seguridad." },
  { id: "other", name: "Otro (IMAP)", host: "", help: "Servidor IMAP con TLS (normalmente el puerto 993)." },
];

const CAT_TONE: Record<MailCategory, string> = {
  urgente: "bg-destructive/15 text-destructive",
  reuniones: "bg-blue-500/15 text-blue-400",
  facturas: "bg-amber-500/15 text-amber-400",
  desarrollo: "bg-orange-500/15 text-orange-400",
  seguridad: "bg-rose-500/15 text-rose-400",
  newsletters: "bg-zinc-500/20 text-zinc-300",
  personal: "bg-emerald-500/15 text-emerald-400",
};

function ConnectDialog({ onClose }: { onClose: () => void }) {
  const [preset, setPreset] = React.useState(PRESETS[0]);
  const [host, setHost] = React.useState(PRESETS[0].host);
  const [user, setUser] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("POST", "/api/mail/accounts", { host: host.trim(), user: user.trim(), password });
      toast.success("Correo conectado", { description: "Estoy leyendo y organizando tus mensajes…" });
      refresh("/api/mail");
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Conectar un correo</DialogTitle>
          <DialogDescription>Sólo lectura: Agentic nunca envía, mueve ni borra nada de tu correo. La contraseña se guarda cifrada en este dispositivo.</DialogDescription>
        </DialogHeader>
        <form onSubmit={connect} className="grid gap-3">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Proveedor">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={preset.id === p.id} onClick={() => { setPreset(p); setHost(p.host); }} className={cn("cursor-pointer rounded-md border px-2.5 py-1 text-xs", preset.id === p.id ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {p.name}
              </button>
            ))}
          </div>
          <p className="rounded-md border bg-inset p-2.5 text-xs text-muted-foreground">{preset.help}</p>
          {preset.id === "other" && (
            <div className="grid gap-1.5">
              <Label htmlFor="mail-host">Servidor IMAP</Label>
              <Input id="mail-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.tudominio.com" autoComplete="off" />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="mail-user">Correo</Label>
            <Input id="mail-user" type="email" value={user} onChange={(e) => setUser(e.target.value)} placeholder="tu@correo.com" autoComplete="off" required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mail-pass">Contraseña de aplicación</Label>
            <Input id="mail-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" required />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy || !host || !user || !password}>
            {busy ? "Comprobando…" : "Conectar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MailRow({ m, projects }: { m: MailItem; projects: ProjectListItem[] }) {
  async function patch(body: object) {
    try {
      await api("PATCH", `/api/mail/items/${m.id}`, body);
      refresh("/api/mail");
    } catch (e) {
      toast.error("No se pudo guardar", { description: errorMessage(e) });
    }
  }
  return (
    <li className={cn("flex items-start gap-3 px-4 py-2.5", m.done && "opacity-50")} title={m.reason}>
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", m.unread ? "bg-primary" : "bg-transparent")} aria-label={m.unread ? "Sin leer" : "Leído"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className={cn("truncate", m.unread && "font-semibold")}>{m.fromName || m.fromAddress}</span>
          <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", CAT_TONE[m.category])}>{MAIL_CATEGORY_LABEL[m.category]}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{timeAgo(m.date)}</span>
        </div>
        <div className={cn("truncate text-sm", m.unread ? "text-foreground" : "text-muted-foreground")}>{m.subject}</div>
        {m.snippet && <div className="truncate text-xs text-muted-foreground">{m.snippet}</div>}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <select aria-label={`Proyecto de «${m.subject}»`} value={m.projectPath ?? ""} onChange={(e) => void patch({ projectPath: e.target.value || null })} className="h-7 max-w-48 rounded-md border bg-inset px-1.5 text-xs">
            <option value="">Sin proyecto</option>
            {projects.map((p) => <option key={p.path} value={p.path}>{p.name}</option>)}
          </select>
          <select aria-label={`Categoría de «${m.subject}»`} value={m.category} onChange={(e) => void patch({ category: e.target.value })} className="h-7 rounded-md border bg-inset px-1.5 text-xs">
            {MAIL_CATEGORIES.map((c) => <option key={c} value={c}>{MAIL_CATEGORY_LABEL[c]}</option>)}
          </select>
          <button type="button" onClick={() => void patch({ done: !m.done })} className="flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:text-foreground">
            <CheckIcon className="size-3" /> {m.done ? "Reabrir" : "Hecho"}
          </button>
        </div>
      </div>
    </li>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b py-2.5">
        <CardTitle className="flex items-center gap-2 text-sm">{title} <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span></CardTitle>
      </CardHeader>
      <CardContent className="p-0"><ul className="divide-y">{children}</ul></CardContent>
    </Card>
  );
}

export default function MailPage() {
  const { data, error } = useApi<Overview>("/api/mail", { refreshInterval: (d) => (d?.running ? 2000 : 60_000) });
  const { data: pdata } = useApi<{ projects: ProjectListItem[] }>("/api/projects");
  const [connecting, setConnecting] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [view, setView] = React.useState<"project" | "category">("project");
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [showDone, setShowDone] = React.useState(false);
  const projects = React.useMemo(() => (pdata?.projects ?? []).filter((p) => p.registered || p.sessionCount > 0), [pdata]);

  async function syncNow() {
    setSyncing(true);
    try {
      const r = await api<{ added: number; errors: string[] }>("POST", "/api/mail/sync");
      if (r.errors.length) toast.error("Alguna cuenta falló", { description: r.errors[0] });
      else toast.success(r.added ? `${r.added} mensajes nuevos` : "Todo al día");
      refresh("/api/mail");
    } catch (e) {
      toast.error("No se pudo sincronizar", { description: errorMessage(e) });
    } finally {
      setSyncing(false);
    }
  }
  async function setSettings(body: object) {
    try {
      await api("PUT", "/api/mail/settings", body);
      refresh("/api/mail");
    } catch (e) {
      toast.error("No se pudo guardar", { description: errorMessage(e) });
    }
  }

  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!data) return <Skeleton className="h-64" />;
  const items = data.items.filter((m) => (showDone || !m.done) && (!unreadOnly || m.unread));
  const unread = data.items.filter((m) => m.unread && !m.done).length;

  const groups: { key: string; title: string; items: MailItem[] }[] =
    view === "project"
      ? [...projects.map((p) => ({ key: p.path, title: p.name, items: items.filter((m) => m.projectPath === p.path) })), { key: "none", title: "Sin proyecto", items: items.filter((m) => !m.projectPath || !projects.some((p) => p.path === m.projectPath)) }]
      : MAIL_CATEGORIES.map((c) => ({ key: c, title: MAIL_CATEGORY_LABEL[c], items: items.filter((m) => m.category === c) }));

  return (
    <div className="grid gap-5">
      <PageHeader
        icon={MailIcon}
        title="Correo"
        description="Tus bandejas, organizadas por proyecto y por tipo. Sólo lectura, sin IA: las reglas corren en tu dispositivo."
        actions={
          <>
            {data.accounts.length > 0 && (
              <Button variant="outline" onClick={() => void syncNow()} disabled={syncing || data.running}>
                <RefreshCwIcon className={cn((syncing || data.running) && "animate-spin")} /> Sincronizar
              </Button>
            )}
            <Button onClick={() => setConnecting(true)}><PlusIcon /> Conectar correo</Button>
          </>
        }
      />
      {connecting && <ConnectDialog onClose={() => setConnecting(false)} />}

      {data.accounts.length === 0 ? (
        <EmptyState icon={InboxIcon} title="Conecta tu correo" description="Agentic leerá tu bandeja de entrada, la clasificará (urgente, facturas, reuniones, desarrollo…) y colgará cada mensaje del proyecto al que pertenece." action={<Button onClick={() => setConnecting(true)}><PlusIcon /> Conectar correo</Button>} />
      ) : (
        <>
          <Card>
            <CardContent className="grid gap-3 pt-5 text-sm">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <label className="flex items-center gap-2"><Switch checked={data.settings.enabled} onCheckedChange={(v) => void setSettings({ enabled: v })} aria-label="Rutina automática" /> Rutina automática</label>
                <label className="flex items-center gap-2 text-muted-foreground">Cada
                  <select aria-label="Frecuencia" value={data.settings.intervalMin} onChange={(e) => void setSettings({ intervalMin: Number(e.target.value) })} className="h-8 rounded-md border bg-inset px-2 text-xs text-foreground">
                    {[5, 15, 30, 60, 120].map((n) => <option key={n} value={n}>{n < 60 ? `${n} min` : `${n / 60} h`}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-muted-foreground">Últimos
                  <select aria-label="Días" value={data.settings.days} onChange={(e) => void setSettings({ days: Number(e.target.value) })} className="h-8 rounded-md border bg-inset px-2 text-xs text-foreground">
                    {[3, 7, 14, 30].map((n) => <option key={n} value={n}>{n} días</option>)}
                  </select>
                </label>
                <span className="text-xs text-muted-foreground">{data.settings.lastRunAt ? `Última vez ${timeAgo(data.settings.lastRunAt)}` : "Aún no se ha ejecutado"}</span>
              </div>
              <ul className="grid gap-1.5">
                {data.accounts.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-xs">
                    <MailIcon className="size-3.5 text-muted-foreground" />
                    <span className="font-medium">{a.label}</span>
                    <span className="text-muted-foreground">{a.host}</span>
                    {a.lastError ? <span className="flex items-center gap-1 text-destructive"><AlertTriangleIcon className="size-3" /> {a.lastError}</span> : a.lastSyncAt ? <span className="text-muted-foreground">· sincronizada {timeAgo(a.lastSyncAt)}</span> : null}
                    <button type="button" aria-label={`Desconectar ${a.label}`} className="ml-auto cursor-pointer text-muted-foreground hover:text-destructive" onClick={async () => { if (!confirm(`¿Desconectar ${a.label}? Se borran sus mensajes de Agentic (no del correo).`)) return; await api("DELETE", `/api/mail/accounts/${a.id}`); refresh("/api/mail"); }}>
                      <Trash2Icon className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={view} onValueChange={(v) => setView(v as "project" | "category")}>
              <TabsList>
                <TabsTrigger value="project">Por proyecto</TabsTrigger>
                <TabsTrigger value="category">Por tipo</TabsTrigger>
              </TabsList>
            </Tabs>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} className="accent-primary" /> Sólo sin leer</label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="accent-primary" /> Mostrar hechos</label>
            <Badge variant="blue" className="ml-auto">{unread} sin leer</Badge>
          </div>

          {items.length === 0 ? (
            <EmptyState icon={InboxIcon} title="Nada que mostrar" description={data.running ? "Leyendo tu correo…" : "No hay mensajes con estos filtros."} />
          ) : (
            <div className="grid gap-4">
              {groups.filter((g) => g.items.length).map((g) => (
                <Group key={g.key} title={g.title} count={g.items.length}>
                  {g.items.map((m) => <MailRow key={m.id} m={m} projects={projects} />)}
                </Group>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
