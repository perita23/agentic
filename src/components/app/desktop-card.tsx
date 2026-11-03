"use client";

import * as React from "react";
import { useSyncExternalStore } from "react";
import { CheckCircle2Icon, DownloadIcon, FingerprintIcon, FolderLockIcon, KeyRoundIcon, LaptopIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface LockInfo {
  touchIdAvailable: boolean;
  touchIdEnabled: boolean;
  hasPassword: boolean;
}
interface DesktopBridge {
  isDesktop: true;
  version: () => Promise<string | null>;
  checkForUpdates: () => Promise<string>;
  openPrivacySettings?: () => Promise<boolean>;
  lock?: {
    info: () => Promise<LockInfo | null>;
    setTouchId: (on: boolean) => Promise<(LockInfo & { ok: boolean; error?: string }) | null>;
    changePassword: (current: string, next: string) => Promise<{ ok: boolean; error?: string } | null>;
  };
}

const noop = () => () => {};
const bridge = () => (window as unknown as { agenticDesktop?: DesktopBridge }).agenticDesktop ?? null;

/** The macOS app's bridge (its preload exposes `window.agenticDesktop`), or null in a browser. */
export function useDesktop(): DesktopBridge | null {
  return useSyncExternalStore(noop, bridge, () => null);
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="flex items-center gap-1.5 text-right">{children}</span>
    </div>
  );
}

/** Only rendered inside the macOS app. */
export function DesktopCard() {
  const desktop = useDesktop();
  const [version, setVersion] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [checkedAt, setCheckedAt] = React.useState<Date | null>(null);
  const [lock, setLock] = React.useState<LockInfo | null>(null);
  const [lockBusy, setLockBusy] = React.useState(false);
  const [changing, setChanging] = React.useState(false);

  React.useEffect(() => {
    desktop?.version().then(setVersion, () => {});
    desktop?.lock?.info().then(setLock, () => {});
  }, [desktop]);

  async function toggleTouchId(on: boolean) {
    if (!desktop?.lock) return;
    setLockBusy(true);
    try {
      const r = await desktop.lock.setTouchId(on);
      if (!r) return;
      setLock(r);
      if (r.ok) toast.success(on ? "Touch ID activado: la próxima vez desbloquearás con tu huella" : "Touch ID desactivado: se pedirá la contraseña");
      else toast.error(r.error ?? "No se ha verificado Touch ID");
    } finally {
      setLockBusy(false);
    }
  }

  if (!desktop) return null;

  async function check() {
    setBusy(true);
    try {
      const r = await desktop!.checkForUpdates();
      setCheckedAt(new Date());
      // Dialogs for "available" / "error" are shown natively by the app.
      if (r === "up-to-date") toast.success("Agentic está actualizado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <LaptopIcon className="size-4" /> App de escritorio
          </CardTitle>
          <CardDescription>Agentic para macOS se actualiza sola, sin reinstalar.</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={check} disabled={busy}>
          <DownloadIcon /> {busy ? "Comprobando…" : "Buscar actualizaciones"}
        </Button>
      </CardHeader>
      <CardContent>
        <Row k="Versión instalada">
          <span className="font-mono text-xs">{version ? `v${version}` : "…"}</span>
        </Row>
        <Row k="Comprobación automática">al abrir y al volver a la app</Row>
        <Row k="Última comprobación manual">{checkedAt ? checkedAt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "—"}</Row>
        <Row k="Verificación">
          <CheckCircle2Icon className="size-4 text-success" /> SHA-512 y firma del bundle
        </Row>
        {lock && (
          <>
            <Row k="Desbloquear con Touch ID">
              {!lock.touchIdAvailable && <span className="text-xs text-muted-foreground">no disponible en este Mac</span>}
              <FingerprintIcon className="size-4 text-muted-foreground" />
              <Switch aria-label="Desbloquear con Touch ID" checked={lock.touchIdEnabled} disabled={lockBusy || (!lock.touchIdAvailable && !lock.touchIdEnabled)} onCheckedChange={toggleTouchId} />
            </Row>
            {desktop.openPrivacySettings && (
              <Row k="Permisos de carpetas">
                <Button size="sm" variant="outline" onClick={() => desktop.openPrivacySettings?.()} title="Ajustes del Sistema → Privacidad y seguridad → Acceso total al disco → activa Agentic">
                  <FolderLockIcon /> Dar acceso total al disco
                </Button>
              </Row>
            )}
            <Row k="Contraseña de la app">
              <Button size="sm" variant="outline" onClick={() => setChanging(true)}>
                <KeyRoundIcon /> Cambiar contraseña
              </Button>
            </Row>
          </>
        )}
      </CardContent>
      {changing && desktop.lock && <ChangePasswordDialog change={desktop.lock.changePassword} onClose={() => setChanging(false)} />}
    </Card>
  );
}

function ChangePasswordDialog({ change, onClose }: { change: (current: string, next: string) => Promise<{ ok: boolean; error?: string } | null>; onClose: () => void }) {
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [again, setAgain] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== again) return toast.error("Las contraseñas nuevas no coinciden");
    setBusy(true);
    try {
      const r = await change(current, next);
      if (r?.ok) {
        toast.success("Contraseña cambiada");
        onClose();
      } else toast.error(r?.error ?? "No se pudo cambiar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="grid gap-4" autoComplete="off">
          <DialogHeader>
            <DialogTitle>Cambiar contraseña</DialogTitle>
            <DialogDescription>Es la contraseña que desbloquea la app de Mac. Se guarda cifrada (scrypt) sólo en este Mac.</DialogDescription>
          </DialogHeader>
          {(
            [
              ["pw-current", "Contraseña actual", current, setCurrent],
              ["pw-next", "Nueva contraseña (mín. 8)", next, setNext],
              ["pw-again", "Repite la nueva", again, setAgain],
            ] as const
          ).map(([id, label, value, set]) => (
            <div key={id} className="grid gap-1.5">
              <Label htmlFor={id}>{label}</Label>
              <Input id={id} type="password" value={value} required minLength={id === "pw-current" ? 1 : 8} onChange={(e) => set(e.target.value)} />
            </div>
          ))}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
