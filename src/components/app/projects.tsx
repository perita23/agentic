"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, refresh } from "@/lib/api";
import { errorMessage } from "./common";

export const PROJECT_COLORS: Record<string, string> = {
  blue: "from-[#2f81f7]",
  green: "from-[#3fb950]",
  purple: "from-[#a371f7]",
  orange: "from-[#f78166]",
  pink: "from-[#db61a2]",
  cyan: "from-[#39c5cf]",
  yellow: "from-[#d29922]",
  red: "from-[#f85149]",
};

export function AddProjectDialog({ initialPath, onClose }: { initialPath?: string; onClose: () => void }) {
  const [path, setPath] = React.useState(initialPath ?? "");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [tags, setTags] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("POST", "/api/projects", {
        path: path.trim(),
        name: name.trim() || undefined,
        description,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      refresh("/api/projects", "/api/overview");
      toast.success("Proyecto registrado");
      onClose();
    } catch (err) {
      toast.error("No se pudo registrar", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Registrar proyecto</DialogTitle>
            <DialogDescription>Los proyectos en los que ya usaste Claude Code se detectan solos; registra otros o añade metadatos.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label>Ruta absoluta</Label>
            <Input required autoFocus value={path} onChange={(e) => setPath(e.target.value)} placeholder="/home/tu-usuario/proyectos/mi-app" className="font-mono" disabled={!!initialPath} />
          </div>
          <div className="grid gap-1.5">
            <Label>Nombre (opcional)</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Descripción</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Etiquetas (comas)</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="web, cliente-x" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !path.trim()}>
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
