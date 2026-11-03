"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { startRegistration, WebAuthnAbortService } from "@simplewebauthn/browser";
import { FingerprintIcon, LogOutIcon, MonitorIcon, ScrollTextIcon, ShieldIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { api, refresh, useApi } from "@/lib/api";
import { useLocation } from "@/lib/use-location";
import { timeAgo } from "@/lib/utils";
import { errorMessage } from "./common";
import { useDesktop } from "./desktop-card";

interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  backedUp: boolean;
}
interface Session {
  id: string;
  method: "token" | "passkey" | "desktop";
  createdAt: string;
  lastSeenAt: string;
  userAgent: string;
  current: boolean;
}
interface AuditEntry {
  at: string;
  event: string;
  detail?: Record<string, unknown>;
}

function browserName(ua: string) {
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  if (/Electron|Agentic/.test(ua)) return "App de escritorio";
  return ua ? ua.slice(0, 40) : "Desconocido";
}

const EVENT_LABEL: Record<string, string> = {
  login: "Inicio de sesión",
  "login.failed": "Intento fallido",
  logout: "Cierre de sesión",
  "passkey.added": "Passkey añadida",
  "passkey.removed": "Passkey eliminada",
  "auth.requirePasskey": "Exigir Touch ID",
  "session.revoked": "Sesión revocada",
  "sessions.revokedOthers": "Otras sesiones cerradas",
  api: "Acción",
};

async function call(method: "DELETE" | "PATCH" | "POST", url: string, body?: unknown, ok?: string) {
  try {
    await api(method, url, body);
    if (ok) toast.success(ok);
    refresh("/api/auth", "/api/audit");
    return true;
  } catch (e) {
    toast.error(errorMessage(e));
    return false;
  }
}

/** Touch ID: passkeys for the browser, native prompt in the macOS app, and "Exigir Touch ID". */
export function TouchIdCard() {
  const { data: pk } = useApi<{ passkeys: Passkey[]; requirePasskey: boolean }>("/api/auth/passkeys");
  const { data: ss } = useApi<{ sessions: Session[] }>("/api/auth/sessions");
  const [busy, setBusy] = React.useState(false);
  const { hostname } = useLocation();
  const desktop = useDesktop();
  const isLocalhost = hostname === "localhost";
  const currentMethod = ss?.sessions.find((x) => x.current)?.method;
  // In the macOS app Touch ID is native (checked every time it opens), so it
  // counts as verified even without browser passkeys.
  const canRequire = !!pk?.passkeys.length || currentMethod === "desktop";

  async function addPasskey() {
    setBusy(true);
    // Never leave the button stuck if the system sheet never shows up.
    const timer = setTimeout(() => WebAuthnAbortService.cancelCeremony(), 90_000);
    try {
      const options = await api<Parameters<typeof startRegistration>[0]["optionsJSON"]>("POST", "/api/auth/passkey/register/options");
      const response = await startRegistration({ optionsJSON: options });
      const name = /Mac/.test(navigator.userAgent) ? "Touch ID (Mac)" : "Passkey de este dispositivo";
      await api("POST", "/api/auth/passkey/register/verify", {
        response,
        name,
      });
      toast.success("Touch ID registrado", {
        description: "Ya puedes iniciar sesión con tu huella.",
      });
      refresh("/api/auth", "/api/audit");
    } catch (e) {
      const msg = errorMessage(e);
      toast.error("No se pudo registrar", {
        description: /NotAllowed|cancel|abort/i.test(msg) ? "Cancelado o sin respuesta de Touch ID." : msg,
      });
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <FingerprintIcon className="size-4" /> Touch ID y passkeys
          </CardTitle>
          <CardDescription>Inicia sesión con tu huella en lugar del enlace con token.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {desktop && (
          <div className="flex items-start gap-2 rounded-md border bg-inset px-3 py-2 text-xs text-muted-foreground">
            <FingerprintIcon className="mt-0.5 size-4 shrink-0 text-success" />
            <span>
              <span className="font-medium text-foreground">En la app de Mac</span> se desbloquea con tu contraseña o, si lo activas en «App de escritorio», con Touch ID
              {currentMethod === "desktop" ? "; esta sesión ya está verificada" : ""}. Las passkeys de abajo sólo sirven para entrar desde el navegador; regístralas desde el navegador.
            </span>
          </div>
        )}
        {!desktop && hostname !== null && !isLocalhost && (
          <p className="rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-warning">
            Las passkeys sólo funcionan en <code>http://localhost</code>. Abre Agentic con esa dirección para registrar Touch ID.
          </p>
        )}
        {pk?.passkeys.map((p) => (
          <div key={p.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
            <FingerprintIcon className="size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{p.name}</div>
              <div className="text-xs text-muted-foreground">
                creada {timeAgo(p.createdAt)} · {p.lastUsedAt ? `usada ${timeAgo(p.lastUsedAt)}` : "sin usar"}
                {p.backedUp && " · sincronizada (iCloud)"}
              </div>
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Eliminar ${p.name}`}
              className="hover:text-destructive"
              onClick={() => confirm(`¿Eliminar «${p.name}»?`) && call("DELETE", `/api/auth/passkeys/${encodeURIComponent(p.id)}`, undefined, "Passkey eliminada")}
            >
              <Trash2Icon />
            </Button>
          </div>
        ))}
        {!desktop && (
          <Button variant="outline" className="w-fit" onClick={addPasskey} disabled={busy || !isLocalhost}>
            <FingerprintIcon /> {busy ? "Esperando a Touch ID…" : "Añadir Touch ID"}
          </Button>
        )}
        <label className="flex items-start justify-between gap-3 border-t pt-3">
          <span>
            <span className="font-medium">Exigir Touch ID</span>
            <span className="block text-xs text-muted-foreground">
              El enlace con token y el token Bearer dejan de servir y se cierran las sesiones abiertas con token.
              {!pk?.passkeys.length && currentMethod === "desktop" && " Sin passkeys, sólo podrás entrar desde la app de Mac."} Recuperación: <code>npm run reset-auth</code>.
            </span>
          </span>
          <Switch
            aria-label="Exigir Touch ID"
            checked={!!pk?.requirePasskey}
            disabled={!pk || !canRequire}
            onCheckedChange={(v) => call("PATCH", "/api/auth/settings", { requirePasskey: v }, v ? "Touch ID ahora es obligatorio" : "Touch ID ya no es obligatorio")}
          />
        </label>
      </CardContent>
    </Card>
  );
}

export function SessionsCard() {
  const router = useRouter();
  const { data: ss } = useApi<{ sessions: Session[] }>("/api/auth/sessions");

  async function logout() {
    await api("POST", "/api/auth/logout");
    router.replace("/login");
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <MonitorIcon className="size-4" /> Sesiones
          </CardTitle>
          <CardDescription>Navegadores con acceso a Agentic. Caducan a los 30 días o tras 7 sin uso.</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={logout}>
          <LogOutIcon /> Cerrar sesión
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {ss?.sessions.map((s) => (
          <div key={s.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-medium">
                {browserName(s.userAgent)}
                {s.current && <Badge variant="green">esta</Badge>}
                <Badge>{s.method === "token" ? "token" : s.method === "desktop" ? "Touch ID (app)" : "Touch ID"}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                iniciada {timeAgo(s.createdAt)} · activa {timeAgo(s.lastSeenAt)}
              </div>
            </div>
            {!s.current && (
              <Button size="sm" variant="ghost" className="hover:text-destructive" onClick={() => call("DELETE", `/api/auth/sessions/${s.id}`, undefined, "Sesión revocada")}>
                Revocar
              </Button>
            )}
          </div>
        ))}
        {(ss?.sessions.length ?? 0) > 1 && (
          <Button size="sm" variant="outline" className="w-fit" onClick={() => call("DELETE", "/api/auth/sessions", undefined, "Se cerraron las demás sesiones")}>
            Cerrar las demás sesiones
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function AuditCard() {
  const { data: audit } = useApi<{ entries: AuditEntry[] }>("/api/audit?limit=100");
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <ScrollTextIcon className="size-4" /> Registro de auditoría
          </CardTitle>
          <CardDescription>Inicios de sesión y todas las acciones que cambian algo (sin contenido ni secretos). Fichero: ~/.agentic/audit.log</CardDescription>
        </div>
        <ShieldIcon className="size-4 text-success" />
      </CardHeader>
      <CardContent>
        <div className="max-h-72 overflow-auto rounded-md border">
          <table className="w-full text-xs">
            <tbody>
              {audit?.entries.map((e, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{new Date(e.at).toLocaleString("es-ES")}</td>
                  <td className={`px-3 py-1.5 whitespace-nowrap ${e.event === "login.failed" ? "text-destructive" : ""}`}>{EVENT_LABEL[e.event] ?? e.event}</td>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">
                    {e.detail
                      ? Object.entries(e.detail)
                          .map(([k, v]) => `${k}=${String(v)}`)
                          .join(" ")
                      : ""}
                  </td>
                </tr>
              ))}
              {audit && !audit.entries.length && (
                <tr>
                  <td className="px-3 py-3 text-muted-foreground">Sin eventos todavía.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
