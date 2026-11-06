"use client";

import * as React from "react";
import { RefreshCwIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api, refresh, useApi } from "@/lib/api";
import { errorMessage } from "./common";

interface View {
  settings: { enabled: boolean; baseUrl: string; model: string; autocorrect: "off" | "words" | "suggest" | "auto"; correctExtra: string; improveExtra: string };
  reachable: boolean;
  models: { name: string; size: number }[];
  error: string | null;
}

const gb = (n: number) => (n ? ` · ${(n / 1e9).toFixed(1)} GB` : "");

/** Ajustes: the local model (Ollama) that corrects what you type and improves your prompts. */
export function OllamaCard() {
  const { data, mutate, isValidating } = useApi<View>("/api/ollama", { revalidateOnFocus: false });
  const [url, setUrl] = React.useState<string | null>(null);

  async function save(patch: Partial<View["settings"]>) {
    try {
      await api("PUT", "/api/ollama", patch);
      await mutate();
      refresh("/api/ollama?probe=0");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  if (!data) return <Skeleton className="h-56" />;
  const s = data.settings;
  const known = data.models.some((m) => m.name === s.model);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <SparklesIcon className="size-4" /> IA local (Ollama)
            {s.enabled && <Badge>{data.reachable ? "conectado" : "sin conexión"}</Badge>}
          </CardTitle>
          <CardDescription>Un modelo que corre en tu ordenador te corrige lo que escribes mientras lo escribes y puede mejorar y organizar tu prompt antes de enviarlo a Claude. Nada sale de tu equipo.</CardDescription>
        </div>
        <Switch aria-label="Activar la IA local" checked={s.enabled} onCheckedChange={(on) => void save({ enabled: on })} />
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <label className="grid gap-1.5">
          <span>Dirección de Ollama</span>
          <Input aria-label="Dirección de Ollama" value={url ?? s.baseUrl} disabled={!s.enabled} onChange={(e) => setUrl(e.target.value)} onBlur={() => url !== null && url !== s.baseUrl && void save({ baseUrl: url }).then(() => setUrl(null))} className="font-mono text-xs" />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>
            Modelo
            <span className="block text-xs text-muted-foreground">{data.reachable ? `${data.models.length} instalados` : (data.error ?? "No se pudo conectar")}</span>
          </span>
          <span className="flex items-center gap-2">
            <select aria-label="Modelo de Ollama" value={s.model} disabled={!s.enabled || !data.reachable} onChange={(e) => void save({ model: e.target.value })} className="h-8 max-w-56 rounded-md border bg-transparent px-2 text-sm">
              <option value="">Elige un modelo…</option>
              {s.model && !known && <option value={s.model}>{s.model} (no instalado)</option>}
              {data.models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                  {gb(m.size)}
                </option>
              ))}
            </select>
            <Button type="button" size="icon-sm" variant="ghost" aria-label="Buscar modelos" onClick={() => void mutate()} disabled={isValidating}>
              <RefreshCwIcon className={isValidating ? "animate-spin" : ""} />
            </Button>
          </span>
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>
            Corregir mientras escribo
            <span className="block text-xs text-muted-foreground">«Palabra a palabra» revisa cada palabra en cuanto la terminas y la arregla al instante (Ctrl/⌘+Z lo deshace). «Al pausar» revisa la frase entera cuando dejas de escribir.</span>
          </span>
          <select aria-label="Corrección al escribir" value={s.autocorrect} disabled={!s.enabled} onChange={(e) => void save({ autocorrect: e.target.value as View["settings"]["autocorrect"] })} className="h-8 rounded-md border bg-transparent px-2 text-sm">
            <option value="off">Desactivada</option>
            <option value="words">Palabra a palabra</option>
            <option value="suggest">Al pausar: sugerir</option>
            <option value="auto">Al pausar: aplicar sola</option>
          </select>
        </label>
        <details className="rounded-lg border px-3 py-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">Instrucciones para el modelo</summary>
          <div className="mt-2 grid gap-3">
            <p className="text-xs text-muted-foreground">El modelo ya viene instruido para corregir y reescribir <b>sin responder nunca</b> a lo que escribes, aunque parezca una orden. Aquí puedes añadir tus propias reglas.</p>
            <label className="grid gap-1.5 text-xs">
              <span className="font-medium text-foreground">Al corregir</span>
              <textarea aria-label="Instrucciones al corregir" rows={3} maxLength={1500} defaultValue={s.correctExtra} disabled={!s.enabled} onBlur={(e) => e.target.value !== s.correctExtra && void save({ correctExtra: e.target.value })} placeholder="Ej.: No toques los nombres de mis proyectos (Agentic, Obsidian). Escribo en español de España." className="min-h-16 w-full resize-y rounded-md border bg-transparent p-2 text-sm" />
            </label>
            <label className="grid gap-1.5 text-xs">
              <span className="font-medium text-foreground">Al mejorar el prompt</span>
              <textarea aria-label="Instrucciones al mejorar el prompt" rows={3} maxLength={1500} defaultValue={s.improveExtra} disabled={!s.enabled} onBlur={(e) => e.target.value !== s.improveExtra && void save({ improveExtra: e.target.value })} placeholder="Ej.: Escribe siempre en español, con los pasos numerados y pidiendo que Claude primero lea el código antes de cambiar nada." className="min-h-16 w-full resize-y rounded-md border bg-transparent p-2 text-sm" />
            </label>
          </div>
        </details>
        <p className="text-xs text-muted-foreground">
          Para escribir bien en español conviene un modelo de unos <b>7-8 mil millones</b> de parámetros (por ejemplo <code>qwen2.5:7b</code> o <code>llama3.1:8b</code>: <code>ollama pull qwen2.5:7b</code>); los de 3B (<code>qwen2.5:3b</code>, <code>llama3.2:3b</code>) son más rápidos pero se equivocan más. Las faltas más frecuentes (como «corrije» o «tambien») se arreglan siempre, sin depender del modelo. Además, el botón «Mejorar» del cuadro de mensaje reescribe tu prompt y lo organiza. Si Ollama no está instalado, es gratis en ollama.com.
        </p>
      </CardContent>
    </Card>
  );
}
