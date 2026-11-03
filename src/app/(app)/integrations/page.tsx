"use client";

import * as React from "react";
import { CheckCircle2Icon, CircleDashedIcon, PlugIcon, PlugZapIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { errorMessage, PageHeader } from "@/components/app/common";
import { ProviderIcon } from "@/components/app/provider-icon";
import { api, refresh, useApi } from "@/lib/api";

type Status = Record<string, { configured: boolean; secretHint?: string | null; updatedAt?: string } & Record<string, unknown>>;

interface Field {
  name: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  required?: boolean;
  help?: string;
}

const PROVIDERS: {
  id: "slack" | "github" | "bitbucket" | "jira";
  name: string;
  description: string;
  fields: Field[];
  help: React.ReactNode;
}[] = [
  {
    id: "slack",
    name: "Slack",
    description: "Lee y responde mensajes de tus canales y recibe avisos de Agentic.",
    fields: [
      { name: "botToken", label: "Bot token", placeholder: "xoxb-…", secret: true, required: true },
      { name: "notifyChannel", label: "Canal para avisos (ID, opcional)", placeholder: "C0123ABCD" },
      { name: "webhookUrl", label: "Incoming webhook (alternativa para avisos, opcional)", placeholder: "https://hooks.slack.com/services/…" },
    ],
    help: (
      <>
        Crea una app en api.slack.com/apps, añade los scopes de bot <code>channels:read</code>, <code>channels:history</code>, <code>groups:read</code>,{" "}
        <code>groups:history</code>, <code>chat:write</code> y <code>users:read</code>, instálala en tu workspace e invita al bot a los canales.
      </>
    ),
  },
  {
    id: "github",
    name: "GitHub",
    description: "Pull requests e issues de los repositorios de tus proyectos.",
    fields: [
      { name: "token", label: "Token de acceso", placeholder: "github_pat_… / ghp_…", secret: true, required: true },
      { name: "apiUrl", label: "API URL (GitHub Enterprise)", placeholder: "https://api.github.com" },
    ],
    help: (
      <>
        Token fine-grained con acceso a tus repos: <em>Pull requests</em>, <em>Issues</em> y <em>Contents</em> (lectura y escritura para comentar y mergear), y{" "}
        <em>Checks</em> (lectura).
      </>
    ),
  },
  {
    id: "bitbucket",
    name: "Bitbucket",
    description: "Pull requests de los repositorios de Bitbucket Cloud.",
    fields: [
      { name: "username", label: "Email de Atlassian (para API token) o vacío (access token)", placeholder: "tu@empresa.com" },
      { name: "token", label: "API token / access token", secret: true, required: true },
      { name: "apiUrl", label: "API URL", placeholder: "https://api.bitbucket.org/2.0" },
    ],
    help: <>API token de tu cuenta Atlassian con scopes de lectura/escritura de repositorios y pull requests, o un access token del repositorio/workspace.</>,
  },
  {
    id: "jira",
    name: "Jira",
    description: "Incidencias de Jira Cloud: verlas, comentarlas, moverlas e importarlas como tareas.",
    fields: [
      { name: "siteUrl", label: "URL del sitio", placeholder: "https://tu-empresa.atlassian.net", required: true },
      { name: "email", label: "Email de Atlassian", placeholder: "tu@empresa.com", required: true },
      { name: "token", label: "API token", secret: true, required: true },
      { name: "defaultJql", label: "JQL por defecto", placeholder: "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC" },
    ],
    help: <>Genera un API token en id.atlassian.com → Seguridad → API tokens.</>,
  },
];

function ConfigureDialog({ provider, current, onClose }: { provider: (typeof PROVIDERS)[number]; current?: Status[string]; onClose: () => void }) {
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(provider.fields.map((f) => [f.name, f.secret || f.name === "webhookUrl" ? "" : String(current?.[f.name] ?? "")])),
  );
  const [events, setEvents] = React.useState<{ runFinished: boolean; queueFinished: boolean; onlyFailures: boolean }>(
    (current?.events as { runFinished: boolean; queueFinished: boolean; onlyFailures: boolean }) ?? { runFinished: true, queueFinished: true, onlyFailures: false },
  );
  const [busy, setBusy] = React.useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body: Record<string, unknown> = {};
    for (const f of provider.fields) {
      const v = values[f.name].trim();
      if (v || !f.secret) body[f.name] = v || undefined;
    }
    if (provider.id === "slack") {
      body.events = events;
      // Keep the stored webhook unless a new one is typed.
      if (!values.webhookUrl.trim()) delete body.webhookUrl;
    }
    try {
      await api("PUT", `/api/integrations/${provider.id}`, body);
      const t = await api<{ account: string }>("POST", `/api/integrations/${provider.id}/test`);
      toast.success(`${provider.name} conectado`, { description: t.account });
      refresh("/api/integrations");
      onClose();
    } catch (err) {
      refresh("/api/integrations");
      toast.error(`No se pudo conectar ${provider.name}`, { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="grid gap-4" autoComplete="off">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ProviderIcon provider={provider.id} className="size-4" /> Conectar {provider.name}
            </DialogTitle>
            <DialogDescription>Las credenciales se guardan sólo en tu máquina (~/.agentic, permisos 0600) y nunca se envían al navegador.</DialogDescription>
          </DialogHeader>
          <p className="rounded-md border bg-inset p-3 text-xs leading-relaxed text-muted-foreground [&_code]:font-mono [&_code]:text-foreground">{provider.help}</p>
          {provider.fields.map((f) => (
            <div key={f.name} className="grid gap-1.5">
              <Label htmlFor={`f-${f.name}`}>{f.label}</Label>
              <Input
                id={`f-${f.name}`}
                type={f.secret ? "password" : "text"}
                className="font-mono"
                placeholder={f.secret && current?.configured ? `${current.secretHint} (déjalo vacío para mantenerlo)` : f.placeholder}
                value={values[f.name]}
                required={f.required && !(f.secret && current?.configured)}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              />
            </div>
          ))}
          {provider.id === "slack" && (
            <div className="grid gap-2 rounded-md border p-3 text-sm">
              {(
                [
                  ["runFinished", "Avisar al terminar una ejecución"],
                  ["queueFinished", "Avisar al terminar la cola"],
                  ["onlyFailures", "Sólo si algo falla"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex items-center justify-between gap-3">
                  {label}
                  <Switch checked={events[k]} onCheckedChange={(v) => setEvents({ ...events, [k]: v })} />
                </label>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              <PlugZapIcon /> {busy ? "Probando…" : "Guardar y probar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function IntegrationsPage() {
  const { data } = useApi<Status>("/api/integrations");
  const [editing, setEditing] = React.useState<(typeof PROVIDERS)[number] | null>(null);
  const [testing, setTesting] = React.useState<string | null>(null);

  async function test(id: string, name: string) {
    setTesting(id);
    try {
      const r = await api<{ account: string }>("POST", `/api/integrations/${id}/test`);
      toast.success(`${name}: conexión correcta`, { description: r.account });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setTesting(null);
    }
  }
  async function disconnect(id: string, name: string) {
    if (!confirm(`¿Desconectar ${name}? Se borrarán sus credenciales de esta máquina.`)) return;
    await api("DELETE", `/api/integrations/${id}`);
    refresh("/api/integrations");
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={PlugIcon} title="Integraciones" description="Conecta Slack, GitHub, Bitbucket y Jira. Todo pasa por tu servidor local; nada sale de tu máquina salvo las llamadas a esos servicios." />
      <div className="grid gap-4 md:grid-cols-2">
        {PROVIDERS.map((p) => {
          const st = data?.[p.id];
          return (
            <Card key={p.id}>
              <CardHeader>
                <div className="flex items-start gap-3">
                  <span className="grid size-10 place-items-center rounded-lg border bg-secondary/50">
                    <ProviderIcon provider={p.id} className="size-5" />
                  </span>
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {p.name}
                      {st?.configured ? (
                        <Badge variant="green">
                          <CheckCircle2Icon /> conectado
                        </Badge>
                      ) : (
                        <Badge>
                          <CircleDashedIcon /> sin configurar
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1">{p.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                {st?.configured && <span className="mr-auto font-mono text-xs text-muted-foreground">{st.secretHint}</span>}
                <Button size="sm" variant={st?.configured ? "outline" : "default"} onClick={() => setEditing(p)}>
                  {st?.configured ? "Editar" : "Conectar"}
                </Button>
                {st?.configured && (
                  <>
                    <Button size="sm" variant="outline" disabled={testing === p.id} onClick={() => test(p.id, p.name)}>
                      <PlugZapIcon /> Probar
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Desconectar ${p.name}`} onClick={() => disconnect(p.id, p.name)} className="hover:text-destructive">
                      <Trash2Icon />
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {editing && <ConfigureDialog provider={editing} current={data?.[editing.id]} onClose={() => setEditing(null)} />}
    </div>
  );
}
