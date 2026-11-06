"use client";

import { SpellCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api, refresh, useApi } from "@/lib/api";
import { errorMessage } from "./common";

interface View {
  settings: { mode: "off" | "words"; lang: "auto" | "es" | "en"; useModel: boolean };
  dictionaries: { es: boolean; en: boolean };
}
interface OllamaView {
  settings: { enabled: boolean; model: string };
}

/** Ajustes: the spell checker (dictionaries in Spanish and English; the local model only decides the doubtful ones). */
export function SpellCard() {
  const { data, mutate } = useApi<View>("/api/spell", { revalidateOnFocus: false });
  const { data: ollama } = useApi<OllamaView>("/api/ollama?probe=0", { revalidateOnFocus: false });
  async function save(patch: Partial<View["settings"]>) {
    try {
      await api("PUT", "/api/spell", patch);
      await mutate();
      refresh("/api/spell");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  if (!data) return <Skeleton className="h-48" />;
  const s = data.settings;
  const model = !!ollama?.settings.enabled && !!ollama.settings.model;
  const missing = !data.dictionaries.es || !data.dictionaries.en;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <SpellCheckIcon className="size-4" /> Corrector ortográfico
            {s.mode === "words" && <Badge>activo</Badge>}
          </CardTitle>
          <CardDescription>Corrige cada palabra en cuanto la terminas, en cualquier campo donde escribas texto (mensajes, tareas, notas…), y la palabra se transforma ahí mismo. Funciona con diccionarios en tu equipo: no necesita internet ni ningún modelo.</CardDescription>
        </div>
        <Switch aria-label="Activar el corrector ortográfico" checked={s.mode === "words"} onCheckedChange={(on) => void save({ mode: on ? "words" : "off" })} />
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <label className="flex items-center justify-between gap-4">
          <span>
            Idioma
            <span className="block text-xs text-muted-foreground">«Automático» mira las palabras de alrededor para saber si escribes en español o en inglés. Las palabras correctas en cualquiera de los dos idiomas (commit, deploy…) no se tocan.</span>
          </span>
          <select aria-label="Idioma del corrector" value={s.lang} disabled={s.mode !== "words"} onChange={(e) => void save({ lang: e.target.value as View["settings"]["lang"] })} className="h-8 rounded-md border bg-transparent px-2 text-sm">
            <option value="auto">Automático</option>
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>
            Usar la IA local para los casos dudosos
            <span className="block text-xs text-muted-foreground">{model ? "Cuando el diccionario propone varias opciones («corrije» → corrige, corrijo, corrija), el modelo elige la que encaja en la frase. Nunca escribe palabras por su cuenta." : "Conecta un modelo de Ollama (más abajo) para que elija entre las opciones cuando hay varias. Sin él, esas palabras se dejan como las escribiste."}</span>
          </span>
          <Switch aria-label="Usar la IA local para los casos dudosos" checked={s.useModel} disabled={s.mode !== "words" || !model} onCheckedChange={(on) => void save({ useModel: on })} />
        </label>
        {missing && <p className="text-xs text-destructive">Faltan diccionarios en esta instalación ({[!data.dictionaries.es && "español", !data.dictionaries.en && "inglés"].filter(Boolean).join(", ")}).</p>}
        <p className="text-xs text-muted-foreground">Diccionarios Hunspell (los de LibreOffice y Firefox): español (GPL/LGPL/MPL) e inglés (MIT/BSD). Las faltas más típicas del español («tambien», «exelente»…) también se arreglan al instante, sin consultar nada.</p>
      </CardContent>
    </Card>
  );
}
