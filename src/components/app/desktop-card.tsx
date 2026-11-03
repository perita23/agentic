"use client";

import * as React from "react";
import { useSyncExternalStore } from "react";
import { DownloadIcon, LaptopIcon } from "lucide-react";
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

/** Only rendered inside the macOS app (its preload exposes `window.agenticDesktop`). */
export function DesktopCard() {
  const desktop = useSyncExternalStore(noop, bridge, () => null);
  const [version, setVersion] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    desktop?.version().then(setVersion, () => {});
  }, [desktop]);

  if (!desktop) return null;

  async function check() {
    setBusy(true);
    try {
      const r = await desktop!.checkForUpdates();
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
          <CardDescription>Se comprueba si hay una versión nueva cada vez que entras en la app.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3 text-sm">
        <span className="font-mono text-muted-foreground">{version ? `v${version}` : "…"}</span>
        <Button variant="outline" onClick={check} disabled={busy}>
          <DownloadIcon /> {busy ? "Comprobando…" : "Buscar actualizaciones"}
        </Button>
      </CardContent>
    </Card>
  );
}
