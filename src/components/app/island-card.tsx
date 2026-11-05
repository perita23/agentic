"use client";

import { PanelTopIcon } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { api, refresh, useApi } from "@/lib/api";
import { useDesktop } from "./desktop-card";

interface IslandPrefs {
  enabled: boolean;
  working: boolean;
  alerts: boolean;
}

/** Settings of the island at the top of the screen. Only rendered inside the macOS app. */
export function IslandCard() {
  const desktop = useDesktop();
  const { data, mutate } = useApi<{ island: IslandPrefs }>("/api/prefs");
  if (!desktop) return null;
  const island = data?.island ?? { enabled: true, working: true, alerts: true };
  async function set(patch: Partial<IslandPrefs>) {
    await mutate({ island: { ...island, ...patch } } as { island: IslandPrefs }, { revalidate: false });
    try {
      await api("PUT", "/api/prefs", { island: patch });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      refresh("/api/prefs");
    }
  }
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <PanelTopIcon className="size-4" /> Isla de Agentic
          </CardTitle>
          <CardDescription>Una píldora en la parte superior de la pantalla, junto a la cámara. Solo se ve cuando hay algo que contar.</CardDescription>
        </div>
        <Switch aria-label="Mostrar la isla" checked={island.enabled} onCheckedChange={(v) => set({ enabled: v })} />
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <label className="flex items-center justify-between gap-4">
          <span>
            Mientras Claude trabaja
            <span className="block text-xs text-muted-foreground">La bolita con el paso en el que va.</span>
          </span>
          <Switch aria-label="Mostrar la isla mientras Claude trabaja" checked={island.working} disabled={!island.enabled} onCheckedChange={(v) => set({ working: v })} />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>
            Al terminar o cuando te espera
            <span className="block text-xs text-muted-foreground">Se abre con el resultado y un botón para abrirlo.</span>
          </span>
          <Switch aria-label="Avisar en la isla al terminar" checked={island.alerts} disabled={!island.enabled} onCheckedChange={(v) => set({ alerts: v })} />
        </label>
      </CardContent>
    </Card>
  );
}
