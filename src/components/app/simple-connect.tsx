"use client";

import * as React from "react";
import { CheckCircle2Icon, ExternalLinkIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, refresh } from "@/lib/api";
import { errorMessage } from "./common";
import { ProviderIcon } from "./provider-icon";

export type SimpleProvider = "github" | "slack" | "jira" | "bitbucket";

const NAME: Record<SimpleProvider, string> = { github: "GitHub", slack: "Slack", jira: "Jira", bitbucket: "Bitbucket" };

function open(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

/** "empresa", "empresa.atlassian.net" or a full URL → https://empresa.atlassian.net */
export function jiraSite(input: string) {
  let v = input.trim().replace(/\/+$/, "");
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    if (!u.hostname.includes(".")) u.hostname = `${u.hostname}.atlassian.net`;
    return u.origin;
  } catch {
    return v;
  }
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-foreground text-xs font-semibold text-background">{n}</span>
      <div className="grid min-w-0 flex-1 gap-2 pt-0.5 text-sm">{children}</div>
    </li>
  );
}

/**
 * The whole connection in one small dialog: open the provider's page (already
 * pre-filled where the provider allows it), paste what it gives you, done.
 */
export function SimpleConnect({ provider, slackManifestUrl, onClose }: { provider: SimpleProvider; slackManifestUrl?: string; onClose: () => void }) {
  const [token, setToken] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [site, setSite] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body =
      provider === "github"
        ? { token: token.trim() }
        : provider === "slack"
          ? { botToken: token.trim() }
          : provider === "jira"
            ? { siteUrl: jiraSite(site), email: email.trim(), token: token.trim() }
            : { username: email.trim(), token: token.trim() };
    try {
      await api("PUT", `/api/integrations/${provider}`, body);
      const t = await api<{ account: string }>("POST", `/api/integrations/${provider}/test`);
      toast.success(`${NAME[provider]} conectado`, { description: t.account });
      refresh("/api/integrations");
      onClose();
    } catch (err) {
      // Never keep half-working credentials around.
      await api("DELETE", `/api/integrations/${provider}`).catch(() => {});
      refresh("/api/integrations");
      const msg = errorMessage(err);
      setError(
        /credenciales|token no válido|invalid_auth|401/i.test(msg)
          ? "Ese token no funciona. Vuelve a copiarlo entero (sin espacios) y pégalo otra vez."
          : /sin permisos|403|scope/i.test(msg)
            ? "El token no tiene los permisos necesarios. Créalo otra vez desde el botón del paso 1."
            : /conectar|no encontrado|404/i.test(msg) && provider === "jira"
              ? "No encuentro ese Jira. Revisa la dirección (por ejemplo: tuempresa.atlassian.net)."
              : msg,
      );
    } finally {
      setBusy(false);
    }
  }

  const tokenField = (label: string, placeholder: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor="sc-token">{label}</Label>
      <Input id="sc-token" type="password" autoFocus className="font-mono" placeholder={placeholder} value={token} onChange={(e) => setToken(e.target.value)} required />
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={connect} className="grid gap-5" autoComplete="off">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ProviderIcon provider={provider} className="size-5" /> Conectar {NAME[provider]}
            </DialogTitle>
            <DialogDescription>Dos pasos. Lo que pegues se guarda sólo en este ordenador.</DialogDescription>
          </DialogHeader>

          <ol className="grid gap-5">
            {provider === "github" && (
              <>
                <Step n={1}>
                  <span>Crea un token en GitHub. La página se abre con todo marcado: baja y pulsa <b>Generate token</b>.</span>
                  <Button type="button" variant="outline" className="w-fit" onClick={() => open("https://github.com/settings/tokens/new?scopes=repo,read:org,read:user&description=Agentic")}>
                    <ExternalLinkIcon /> Abrir GitHub
                  </Button>
                </Step>
                <Step n={2}>{tokenField("Pega el token", "ghp_…")}</Step>
              </>
            )}

            {provider === "slack" && (
              <>
                <Step n={1}>
                  <span>
                    Crea la app de Agentic en Slack: elige tu workspace y pulsa <b>Next</b> → <b>Create</b>. Después pulsa <b>Install to Workspace</b> → <b>Allow</b>.
                  </span>
                  <Button type="button" variant="outline" className="w-fit" disabled={!slackManifestUrl} onClick={() => slackManifestUrl && open(slackManifestUrl)}>
                    <ExternalLinkIcon /> Abrir Slack
                  </Button>
                </Step>
                <Step n={2}>
                  <span>
                    En la página que aparece (<b>OAuth &amp; Permissions</b>) copia el <b>User OAuth Token</b>, el que empieza por <code className="font-mono">xoxp-</code>.
                  </span>
                  {tokenField("Pega el token", "xoxp-…")}
                </Step>
              </>
            )}

            {provider === "jira" && (
              <>
                <Step n={1}>
                  <span>
                    Crea un token en Atlassian: pulsa <b>Create API token</b>, ponle de nombre «Agentic» y pulsa <b>Copy</b>.
                  </span>
                  <Button type="button" variant="outline" className="w-fit" onClick={() => open("https://id.atlassian.com/manage-profile/security/api-tokens")}>
                    <ExternalLinkIcon /> Abrir Atlassian
                  </Button>
                </Step>
                <Step n={2}>
                  <div className="grid gap-1.5">
                    <Label htmlFor="sc-site">Tu Jira</Label>
                    <Input id="sc-site" placeholder="tuempresa.atlassian.net" value={site} onChange={(e) => setSite(e.target.value)} required />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="sc-email">Tu email de Atlassian</Label>
                    <Input id="sc-email" type="email" placeholder="tu@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                  {tokenField("Pega el token", "ATATT…")}
                </Step>
              </>
            )}

            {provider === "bitbucket" && (
              <>
                <Step n={1}>
                  <span>
                    Crea un token en Atlassian: pulsa <b>Create API token with scopes</b>, elige <b>Bitbucket</b> y marca leer y escribir en <b>repositorios</b> y <b>pull requests</b>. Copia el token.
                  </span>
                  <Button type="button" variant="outline" className="w-fit" onClick={() => open("https://id.atlassian.com/manage-profile/security/api-tokens")}>
                    <ExternalLinkIcon /> Abrir Atlassian
                  </Button>
                </Step>
                <Step n={2}>
                  <div className="grid gap-1.5">
                    <Label htmlFor="sc-email">Tu email de Atlassian</Label>
                    <Input id="sc-email" type="email" placeholder="tu@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                  {tokenField("Pega el token", "ATATT…")}
                </Step>
              </>
            )}
          </ol>

          {error && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !token.trim()}>
              {busy ? <Loader2Icon className="animate-spin" /> : <CheckCircle2Icon />} {busy ? "Comprobando…" : "Conectar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
