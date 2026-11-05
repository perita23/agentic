"use client";

import * as React from "react";
import { BookOpenTextIcon, ExternalLinkIcon, FileTextIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api, refresh, useApi } from "@/lib/api";
import { errorMessage } from "./common";

interface ObsidianStatus {
  config: { enabled: boolean; vaultPath: string; folder: string; scope: "folder" | "vault" };
  vaults: { name: string; path: string }[];
  ready: boolean;
  folderPath: string | null;
}

/** Where the vault is and what Claude may do in it (Ajustes). */
export function ObsidianCard() {
  const { data } = useApi<ObsidianStatus>("/api/obsidian");
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <BookOpenTextIcon className="size-4" /> Obsidian
          </CardTitle>
          <CardDescription>Una sesión con Claude va guardando en tu bóveda las notas relevantes: decisiones, hallazgos, comandos, pendientes.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>{data ? <ObsidianForm key={JSON.stringify(data.config)} status={data} /> : <p className="text-sm text-muted-foreground">Cargando…</p>}</CardContent>
    </Card>
  );
}

function ObsidianForm({ status }: { status: ObsidianStatus }) {
  const c = status.config;
  const [enabled, setEnabled] = React.useState(c.enabled);
  const [vaultPath, setVaultPath] = React.useState(c.vaultPath);
  const [folder, setFolder] = React.useState(c.folder);
  const [scope, setScope] = React.useState(c.scope);
  const [busy, setBusy] = React.useState(false);
  const dirty = enabled !== c.enabled || vaultPath !== c.vaultPath || folder !== c.folder || scope !== c.scope;

  async function save() {
    setBusy(true);
    try {
      await api("PUT", "/api/obsidian", { enabled, vaultPath, folder, scope });
      toast.success(enabled ? "Obsidian conectado" : "Guardado");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      refresh("/api/obsidian");
    }
  }

  return (
    <div className="grid gap-4 text-sm">
      <label className="flex items-center justify-between gap-4">
        <span>
          Que Claude escriba en Obsidian
          <span className="block text-xs text-muted-foreground">Se aplica a las ejecuciones y al chat (no al modo terminal).</span>
        </span>
        <Switch aria-label="Que Claude escriba en Obsidian" checked={enabled} onCheckedChange={setEnabled} />
      </label>

      <div className="grid gap-1.5">
        <Label htmlFor="obsidian-vault">Ruta de la bóveda</Label>
        <Input id="obsidian-vault" value={vaultPath} onChange={(e) => setVaultPath(e.target.value)} placeholder="/Users/tú/Documentos/MiBoveda" className="font-mono text-xs" />
        {status.vaults.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            Detectadas en este Mac:
            {status.vaults.map((v) => (
              <button
                key={v.path}
                type="button"
                title={v.path}
                onClick={() => setVaultPath(v.path)}
                className="rounded-full border px-2 py-0.5 text-foreground hover:bg-accent aria-pressed:border-primary"
                aria-pressed={vaultPath === v.path}
              >
                {v.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="obsidian-folder">Carpeta de las notas</Label>
          <Input id="obsidian-folder" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Agentic" />
          <span className="text-xs text-muted-foreground">Dentro, una subcarpeta por proyecto. Es el único sitio donde Claude escribe.</span>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="obsidian-scope">Qué puede leer</Label>
          <select id="obsidian-scope" value={scope} onChange={(e) => setScope(e.target.value as "folder" | "vault")} className="h-9 rounded-md border bg-transparent px-2 text-sm">
            <option value="folder">Solo esa carpeta (recomendado)</option>
            <option value="vault">Toda la bóveda, para enlazar notas</option>
          </select>
          <span className="text-xs text-muted-foreground">Leer toda la bóveda le da acceso a tus notas personales.</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {status.ready && status.folderPath ? <>Listo: las notas irán a <code className="font-mono">{status.folderPath}</code></> : "Sin conectar."}
        </span>
        <Button size="sm" onClick={save} disabled={busy || !dirty}>
          Guardar
        </Button>
      </div>
    </div>
  );
}

type Ev = Record<string, unknown> & { message?: { content?: unknown } };

/** The notes Claude wrote in the vault during this conversation, with a link that opens each one in Obsidian. */
export function ObsidianNotes({ events }: { events: Ev[] }) {
  const { data } = useApi<ObsidianStatus>("/api/obsidian");
  const root = data?.ready ? data.config.vaultPath : null;
  const notes = React.useMemo(() => {
    if (!root) return [];
    const seen = new Map<string, number>();
    for (const e of events) {
      if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
      for (const b of e.message.content as { type?: string; name?: string; input?: { file_path?: unknown } }[]) {
        const f = b?.input?.file_path;
        if (b?.type === "tool_use" && ["Write", "Edit", "MultiEdit"].includes(String(b.name)) && typeof f === "string" && f.startsWith(`${root}/`) && f.endsWith(".md")) seen.set(f, (seen.get(f) ?? 0) + 1);
      }
    }
    return [...seen.keys()].map((file) => ({ file, rel: file.slice(root.length + 1), name: file.split("/").pop()!.replace(/\.md$/, ""), url: `obsidian://open?path=${encodeURIComponent(file)}` }));
  }, [events, root]);
  if (!notes.length) return null;
  return (
    <div className="appear ml-6 rounded-lg border border-purple/40 bg-purple/[0.07] text-xs" aria-label="Notas de Obsidian">
      <div className="flex items-center gap-2 border-b border-purple/30 px-3 py-1.5 font-medium text-purple">
        <BookOpenTextIcon className="size-3.5" /> Notas de Obsidian ({notes.length})
      </div>
      <ul className="grid divide-y divide-purple/20">
        {notes.map((n) => (
          <li key={n.file}>
            <a href={n.url} className="flex items-center gap-2 px-3 py-1.5 hover:bg-purple/10" title={n.file}>
              <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-foreground">{n.name}</span> <span className="text-muted-foreground">{n.rel}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-purple">
                Abrir en Obsidian <ExternalLinkIcon className="size-3" />
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
