"use client";

import * as React from "react";
import { MicIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { api, refresh, useApi } from "@/lib/api";
import { LANGUAGES, resolveLang } from "@/lib/voice/engine";
import { pickVoice, speaker } from "@/lib/voice/speak";
import { useSpeaker } from "./speak";
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
        <div className="grid gap-3 border-t pt-3">
          <div>
            <div className="font-medium">Leer en voz alta</div>
            <span className="block text-xs text-muted-foreground">Claude puede leerte sus respuestas (botón del altavoz bajo cada respuesta) o hablar contigo con el modo voz del chat. Usa sólo las voces de tu propio equipo: nada sale a internet.</span>
          </div>
          <ReadAloudSettings voice={voice} set={set} />
        </div>
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

function ReadAloudSettings({ voice, set }: { voice: VoicePrefs; set: (p: Partial<VoicePrefs>) => Promise<void> }) {
  const sp = useSpeaker();
  const [voices, setVoices] = React.useState<SpeechSynthesisVoice[]>([]);
  React.useEffect(() => {
    if (!speaker.available()) return;
    const load = () => setVoices(speaker.voices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);
  if (!sp.available) return <p className="text-xs text-muted-foreground">Este navegador no puede leer en voz alta.</p>;
  const lang = resolveLang(voice.lang);
  const auto = pickVoice(voices, lang);
  const test = () => speaker.speak("Hola, soy Agentic. Así sonará la lectura de mis respuestas.", { id: "test", lang, voiceURI: voice.voiceURI, rate: voice.rate });
  return (
    <>
      <label className="flex items-center justify-between gap-4">
        <span>Voz</span>
        <select aria-label="Voz de lectura" value={voice.voiceURI} onChange={(e) => void set({ voiceURI: e.target.value })} className="h-8 max-w-60 rounded-md border bg-transparent px-2 text-sm">
          <option value="">Automática{auto ? ` (${auto.name})` : ""}</option>
          {voices.map((x) => (
            <option key={x.voiceURI} value={x.voiceURI}>
              {x.name} · {x.lang}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-4">
        <span>Velocidad</span>
        <select aria-label="Velocidad de lectura" value={String(voice.rate)} onChange={(e) => void set({ rate: Number(e.target.value) })} className="h-8 rounded-md border bg-transparent px-2 text-sm">
          {[0.8, 0.9, 1, 1.1, 1.25, 1.5].map((r) => (
            <option key={r} value={r}>
              {r === 1 ? "Normal" : `${r}×`}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" variant="outline" onClick={test}>
          Probar la voz
        </Button>
        {!auto && voices.length > 0 && <span className="text-xs text-muted-foreground">No hay voz instalada para este idioma.</span>}
      </div>
      <p className="text-xs text-muted-foreground">En macOS puedes descargar voces más naturales en Ajustes del Sistema → Accesibilidad → Contenido leído → Voz del sistema → Gestionar voces (las «Mejoradas» y «Premium» suenan mucho mejor).</p>
    </>
  );
}
