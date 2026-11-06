"use client";

import { MicIcon } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { api, refresh, useApi } from "@/lib/api";
import { LANGUAGES } from "@/lib/voice/engine";
import { DEFAULT_VOICE, useVoice, type VoicePrefs } from "./voice";
import { errorMessage } from "./common";

/** Dictation settings (Ajustes). */
export function VoiceCard() {
  const { data, mutate } = useApi<{ voice?: Partial<VoicePrefs> }>("/api/prefs");
  const v = useVoice();
  const voice = { ...DEFAULT_VOICE, ...(data?.voice ?? {}) };
  async function set(patch: Partial<VoicePrefs>) {
    await mutate({ ...data, voice: { ...voice, ...patch } }, { revalidate: false });
    try {
      await api("PUT", "/api/prefs", { voice: patch });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      refresh("/api/prefs");
    }
  }
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <MicIcon className="size-4" /> Dictado por voz
          </CardTitle>
          <CardDescription>Habla en vez de escribir: el texto aparece en el campo en el que estés (el chat, la respuesta a una ejecución…).</CardDescription>
        </div>
        <Switch aria-label="Activar el dictado por voz" checked={voice.enabled} onCheckedChange={(on) => set({ enabled: on })} />
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <label className="flex items-center justify-between gap-4">
          <span>
            Mantener Espacio para hablar
            <span className="block text-xs text-muted-foreground">Con el campo vacío (o fuera de uno), mantén Espacio: escucha mientras lo tengas pulsado. También puedes pulsar el micrófono.</span>
          </span>
          <Switch aria-label="Mantener Espacio para hablar" checked={voice.holdSpace} disabled={!voice.enabled} onCheckedChange={(on) => set({ holdSpace: on })} />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>
            Enviar al terminar
            <span className="block text-xs text-muted-foreground">Envía el mensaje en cuanto acabas de hablar, sin revisarlo antes.</span>
          </span>
          <Switch aria-label="Enviar al terminar de dictar" checked={voice.autoSend} disabled={!voice.enabled} onCheckedChange={(on) => set({ autoSend: on })} />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>Idioma</span>
          <select aria-label="Idioma del dictado" value={voice.lang} disabled={!voice.enabled} onChange={(e) => void set({ lang: e.target.value })} className="h-8 rounded-md border bg-transparent px-2 text-sm">
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          {v.available === null
            ? "Comprobando qué motor de voz hay…"
            : v.available
              ? v.engine === "native"
                ? "Usa el reconocimiento de voz de Apple (en el dispositivo cuando el idioma está instalado). macOS te pedirá permiso para el micrófono y el reconocimiento de voz la primera vez."
                : "Usa el reconocimiento de voz de tu navegador, que puede enviar el audio a su proveedor (Google en Chrome, Apple en Safari)."
              : (v.reason ?? "El dictado no está disponible aquí.")}
        </p>
      </CardContent>
    </Card>
  );
}
