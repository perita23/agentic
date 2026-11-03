"use client";

import * as React from "react";
import { CopyIcon, ExternalLinkIcon, KeyRoundIcon, Loader2Icon, LogInIcon, SettingsIcon, TerminalIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, refresh, useApi } from "@/lib/api";
import { errorMessage } from "./common";

type OAuthProvider = "github" | "jira" | "bitbucket";
export interface OAuthInfo {
  apps: Record<OAuthProvider, { configured: boolean; clientId: string | null }>;
  callbackUrl: string;
  slackManifestUrl: string;
}
interface DeviceFlow {
  id: string;
  userCode: string;
  verificationUri: string;
  status: "pending" | "connected" | "expired" | "denied" | "error";
  account?: string;
  error?: string;
}

const NAME: Record<OAuthProvider, string> = { github: "GitHub", jira: "Jira", bitbucket: "Bitbucket" };

function openExternal(url: string) {
  // In the macOS app this opens the default browser (the window never navigates away).
  window.open(url, "_blank", "noopener,noreferrer");
}

function Copy({ value }: { value: string }) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label="Copiar"
      onClick={() => navigator.clipboard.writeText(value).then(() => toast.success("Copiado"), () => toast.error("No se pudo copiar"))}
    >
      <CopyIcon />
    </Button>
  );
}

/** Step-by-step registration of the provider's OAuth app, then its Client ID / Secret. */
function AppDialog({ provider, info, onClose, onSaved }: { provider: OAuthProvider; info: OAuthInfo; onClose: () => void; onSaved: () => void }) {
  const [clientId, setClientId] = React.useState(info.apps[provider].clientId ?? "");
  const [clientSecret, setClientSecret] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const cb = info.callbackUrl;
  const steps: Record<OAuthProvider, { url: string; items: React.ReactNode[] }> = {
    github: {
      url: "https://github.com/settings/applications/new",
      items: [
        <>Nombre «Agentic», Homepage <code>http://localhost</code> y Callback URL <code>http://localhost</code> (no se usa).</>,
        <>Pulsa «Register application» y marca <b>Enable Device Flow</b>.</>,
        <>Copia el <b>Client ID</b> aquí. No hace falta secreto.</>,
      ],
    },
    jira: {
      url: "https://developer.atlassian.com/console/myapp/",
      items: [
        <>Create → <b>OAuth 2.0 integration</b>, nombre «Agentic».</>,
        <>Permissions → Jira API → añade <code>read:jira-work</code>, <code>write:jira-work</code> y <code>read:jira-user</code>.</>,
        <>
          Authorization → Callback URL: <code>{cb}</code> <Copy value={cb} />
        </>,
        <>Settings → copia <b>Client ID</b> y <b>Secret</b> aquí.</>,
      ],
    },
    bitbucket: {
      url: "https://bitbucket.org/account/workspaces/",
      items: [
        <>Tu workspace → Settings → <b>OAuth consumers</b> → Add consumer, nombre «Agentic».</>,
        <>
          Callback URL: <code>{cb}</code> <Copy value={cb} />
        </>,
        <>Permisos: Account (Read), Repositories (Write) y Pull requests (Write). Guarda.</>,
        <>Copia <b>Key</b> (Client ID) y <b>Secret</b> aquí.</>,
      ],
    },
  };
  const s = steps[provider];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("PUT", `/api/integrations/oauth/apps/${provider}`, { clientId: clientId.trim(), ...(provider !== "github" ? { clientSecret: clientSecret.trim() } : {}) });
      refresh("/api/integrations/oauth");
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="grid gap-4" autoComplete="off">
          <DialogHeader>
            <DialogTitle>Activar «Conectar con {NAME[provider]}»</DialogTitle>
            <DialogDescription>Sólo una vez: registra Agentic como app OAuth en {NAME[provider]}. Después, conectar es un clic.</DialogDescription>
          </DialogHeader>
          <ol className="grid list-decimal gap-2 rounded-md border bg-inset p-3 pl-7 text-xs leading-relaxed text-muted-foreground [&_b]:text-foreground [&_code]:font-mono [&_code]:text-foreground">
            <li>
              Abre{" "}
              <button type="button" className="inline-flex items-center gap-1 text-link hover:underline" onClick={() => openExternal(s.url)}>
                {new URL(s.url).host} <ExternalLinkIcon className="size-3" />
              </button>
            </li>
            {s.items.map((it, i) => (
              <li key={i} className="[&_button]:inline-flex [&_button]:align-middle">
                {it}
              </li>
            ))}
          </ol>
          <div className="grid gap-1.5">
            <Label htmlFor="oauth-client-id">Client ID</Label>
            <Input id="oauth-client-id" className="font-mono" value={clientId} required onChange={(e) => setClientId(e.target.value)} />
          </div>
          {provider !== "github" && (
            <div className="grid gap-1.5">
              <Label htmlFor="oauth-client-secret">Client Secret</Label>
              <Input
                id="oauth-client-secret"
                type="password"
                className="font-mono"
                value={clientSecret}
                required={!info.apps[provider].configured}
                placeholder={info.apps[provider].configured ? "(déjalo vacío para mantenerlo)" : ""}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">Se guardan sólo en tu máquina (~/.agentic, 0600) y nunca se envían al navegador.</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              Guardar y conectar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** GitHub device flow: show the code, open github.com, wait for approval. */
function DeviceDialog({ flow: initial, onClose }: { flow: DeviceFlow; onClose: () => void }) {
  const [flow, setFlow] = React.useState(initial);
  React.useEffect(() => {
    if (flow.status !== "pending") return;
    const t = setInterval(async () => {
      try {
        const next = await fetch(`/api/integrations/oauth/github/device/${flow.id}`, { credentials: "same-origin" }).then((r) => r.json());
        setFlow(next);
        if (next.status === "connected") {
          toast.success("GitHub conectado", { description: next.account });
          refresh("/api/integrations");
          onClose();
        }
      } catch {}
    }, 2000);
    return () => clearInterval(t);
  }, [flow.id, flow.status, onClose]);

  const message =
    flow.status === "pending"
      ? "Esperando a que autorices en github.com…"
      : flow.status === "expired"
        ? "El código caducó. Vuelve a intentarlo."
        : flow.status === "denied"
          ? "Has cancelado la autorización."
          : flow.error || "No se pudo conectar.";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar con GitHub</DialogTitle>
          <DialogDescription>Abre GitHub, pega este código y autoriza a Agentic.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center gap-2 rounded-lg border bg-inset py-5">
          <span className="font-mono text-3xl font-semibold tracking-[0.2em]" aria-label="Código de verificación">
            {flow.userCode}
          </span>
          <Copy value={flow.userCode} />
        </div>
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          {flow.status === "pending" && <Loader2Icon className="size-4 animate-spin" />} {message}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
          <Button
            onClick={() => {
              navigator.clipboard?.writeText(flow.userCode).catch(() => {});
              openExternal(flow.verificationUri);
            }}
          >
            <ExternalLinkIcon /> Copiar código y abrir GitHub
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The "Conectar" actions of one provider card (OAuth first, pasting a token as the fallback). */
export function ConnectActions({ provider, onManual, onWaiting }: { provider: "slack" | OAuthProvider; onManual: () => void; onWaiting: (on: boolean) => void }) {
  const { data: info } = useApi<OAuthInfo>("/api/integrations/oauth");
  const [appFor, setAppFor] = React.useState<OAuthProvider | null>(null);
  const [device, setDevice] = React.useState<DeviceFlow | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function connect(p: OAuthProvider) {
    setBusy(true);
    try {
      if (p === "github") {
        setDevice(await api<DeviceFlow>("POST", "/api/integrations/oauth/github/device"));
      } else {
        const { url } = await api<{ url: string }>("POST", `/api/integrations/oauth/${p}/start`);
        openExternal(url);
        onWaiting(true);
        toast.info(`Inicia sesión en ${NAME[p]} en la pestaña que se ha abierto`, { description: "Al autorizar, Agentic quedará conectado." });
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function ghCli() {
    setBusy(true);
    try {
      const r = await api<{ secretHint?: string }>("POST", "/api/integrations/oauth/github/cli");
      toast.success("GitHub conectado con tu sesión de gh", { description: r.secretHint ?? undefined });
      refresh("/api/integrations");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (provider === "slack") {
    return (
      <>
        <Button size="sm" onClick={() => info && openExternal(info.slackManifestUrl)} disabled={!info}>
          <LogInIcon /> Crear app de Slack
        </Button>
        <Button size="sm" variant="outline" onClick={onManual}>
          <KeyRoundIcon /> Pegar token
        </Button>
      </>
    );
  }

  const configured = info?.apps[provider]?.configured;
  return (
    <>
      <Button size="sm" disabled={!info || busy} onClick={() => (configured ? connect(provider) : setAppFor(provider))}>
        <LogInIcon /> Conectar con {NAME[provider]}
      </Button>
      {provider === "github" && (
        <Button size="sm" variant="outline" disabled={busy} onClick={ghCli}>
          <TerminalIcon /> Usar mi sesión de gh
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={onManual}>
        <KeyRoundIcon /> Token
      </Button>
      {configured && (
        <Button size="icon-sm" variant="ghost" aria-label={`App OAuth de ${NAME[provider]}`} onClick={() => setAppFor(provider)}>
          <SettingsIcon />
        </Button>
      )}
      {appFor && info && (
        <AppDialog
          provider={appFor}
          info={info}
          onClose={() => setAppFor(null)}
          onSaved={() => {
            setAppFor(null);
            void connect(appFor);
          }}
        />
      )}
      {device && <DeviceDialog flow={device} onClose={() => setDevice(null)} />}
    </>
  );
}
