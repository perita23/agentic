"use client";

import * as React from "react";
import { useSyncExternalStore } from "react";
import { CheckCircle2Icon, DownloadIcon, LaptopIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface DesktopBridge {
  isDesktop: true;
  version: () => Promise<string | null>;
  checkForUpdates: () => Promise<string>;
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

  React.useEffect(() => {
    desktop?.version().then(setVersion, () => {});
  }, [desktop]);

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
      </CardContent>
    </Card>
  );
}
