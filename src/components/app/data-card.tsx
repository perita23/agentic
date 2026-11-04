"use client";

import * as React from "react";
import { ArchiveRestoreIcon, DatabaseBackupIcon, DownloadIcon, HardDriveDownloadIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, refresh, useApi } from "@/lib/api";
import { formatBytes, timeAgo } from "@/lib/utils";
import { errorMessage } from "./common";

interface Backup {
  name: string;
  size: number;
  createdAt: string;
  automatic: boolean;
}
const KEY = "/api/backup/list";

function afterRestore(res: { restored: string[]; safetyCopy: string }) {
  toast.success("Copia restaurada", { description: `${res.restored.length} colecciones. Tus datos anteriores están en ${res.safetyCopy}.` });
  // Everything changed: reload every view.
  refresh("/api/");
}

function WipeDialog({ onClose }: { onClose: () => void }) {
  const [confirm, setConfirm] = React.useState("");
  const [includeBackups, setIncludeBackups] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  async function wipe() {
    setBusy(true);
    try {
      await api("POST", "/api/backup/wipe", { confirm, includeBackups });
      toast.success("Datos borrados", { description: "Agentic vuelve a estar como recién instalada." });
      refresh("/api/");
      onClose();
    } catch (e) {
      toast.error("No se pudo borrar", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Borrar todos los datos de Agentic</DialogTitle>
          <DialogDescription>
            Se eliminan tareas, plantillas, proyectos, programadas, presupuesto, historial de ejecuciones y chats, y las conexiones con sus credenciales. Tu acceso (contraseña, Touch ID) se mantiene. Tus repositorios y las sesiones de Claude Code no se tocan.
          </DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <Switch checked={includeBackups} onCheckedChange={setIncludeBackups} aria-label="Borrar también las copias de seguridad" /> Borrar también las copias de seguridad
        </label>
        <Input aria-label="Escribe BORRAR para confirmar" placeholder="Escribe BORRAR" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="destructive" disabled={confirm !== "BORRAR" || busy} onClick={wipe}>
            <Trash2Icon /> {busy ? "Borrando…" : "Borrar todo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Export, import, automatic copies and "delete my data". */
export function DataCard() {
  const { data } = useApi<{ backups: Backup[]; dir: string }>(KEY);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [wiping, setWiping] = React.useState(false);

  async function saveNow() {
    try {
      const r = await api<{ name: string }>("POST", "/api/backup/save");
      toast.success("Copia guardada", { description: r.name });
      refresh(KEY);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function importFile(file: File) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      toast.error("El archivo no es JSON válido");
      return;
    }
    if (!confirm("¿Reemplazar tus datos de Agentic con esta copia? Antes se guarda automáticamente una copia de los actuales.")) return;
    try {
      afterRestore(await api("POST", "/api/backup/restore", parsed));
      refresh(KEY);
    } catch (e) {
      toast.error("No se pudo restaurar", { description: errorMessage(e) });
    }
  }

  async function restoreSaved(b: Backup) {
    if (!confirm(`¿Restaurar la copia ${b.name}? Antes se guarda una copia de los datos actuales.`)) return;
    try {
      afterRestore(await api("POST", "/api/backup/restore", { file: b.name }));
    } catch (e) {
      toast.error("No se pudo restaurar", { description: errorMessage(e) });
    }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <DatabaseBackupIcon className="size-4" /> Copias de seguridad y tus datos
          </CardTitle>
          <CardDescription>Cada día se guarda una copia automática (se conservan 7). Las copias no incluyen credenciales: tras restaurar en otro equipo, vuelve a conectar las integraciones.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href="/api/backup" download>
              <DownloadIcon /> Exportar
            </a>
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <UploadIcon /> Importar copia…
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label="Archivo de copia"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void importFile(f);
            }}
          />
          <Button variant="outline" size="sm" onClick={saveNow}>
            <HardDriveDownloadIcon /> Guardar copia ahora
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto text-destructive hover:text-destructive" onClick={() => setWiping(true)}>
            <Trash2Icon /> Borrar todos mis datos
          </Button>
        </div>
        <div className="grid gap-1.5">
          {data && !data.backups.length && <p className="text-xs text-muted-foreground">Aún no hay copias guardadas.</p>}
          {data?.backups.map((b) => (
            <div key={b.name} className="flex min-w-0 items-center gap-3 rounded-md border px-3 py-1.5 text-sm">
              <code className="min-w-0 flex-1 truncate text-xs">{b.name}</code>
              <span className="hidden text-xs text-muted-foreground sm:inline">{b.automatic ? "automática" : "manual"}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{formatBytes(b.size)}</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">{timeAgo(b.createdAt)}</span>
              <Button asChild size="icon-sm" variant="ghost" aria-label={`Descargar ${b.name}`}>
                <a href={`/api/backup?file=${encodeURIComponent(b.name)}`} download>
                  <DownloadIcon />
                </a>
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label={`Restaurar ${b.name}`} onClick={() => restoreSaved(b)}>
                <ArchiveRestoreIcon />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
      {wiping && <WipeDialog onClose={() => setWiping(false)} />}
    </Card>
  );
}
