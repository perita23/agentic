"use client";

import * as React from "react";
import { TicketIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, useApi, type Task } from "@/lib/api";
import { detectJiraKey } from "@/lib/jira-key";
import { errorMessage } from "./common";

/**
 * "Comentar en Jira": save any text of a session as a comment on its Jira issue.
 * The key comes from the linked task (imported from Jira) or is found in the texts; always editable.
 */
export function JiraCommentButton({ text, hints = [], taskId, label = "Comentar en Jira" }: { text: string; hints?: (string | null | undefined)[]; taskId?: string | null; label?: string }) {
  const { data: integrations } = useApi<Record<string, { configured: boolean }>>("/api/integrations");
  const { data: task } = useApi<Task>(taskId ? `/api/tasks/${taskId}` : null);
  const [open, setOpen] = React.useState(false);
  const connected = !!integrations?.jira?.configured;
  const suggested = (task?.external?.provider === "jira" ? task.external.key : null) ?? detectJiraKey(...hints, text);
  return (
    <>
      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" disabled={!connected} title={connected ? "Guardar este texto como comentario en Jira" : "Conecta Jira en Integraciones"} onClick={() => setOpen(true)}>
        <TicketIcon /> {label}
      </Button>
      {open && <CommentDialog initialText={text} initialKey={suggested ?? ""} onClose={() => setOpen(false)} />}
    </>
  );
}

function CommentDialog({ initialText, initialKey, onClose }: { initialText: string; initialKey: string; onClose: () => void }) {
  const [key, setKey] = React.useState(initialKey);
  const [body, setBody] = React.useState(initialText.trim());
  const [busy, setBusy] = React.useState(false);
  const valid = /^[A-Z][A-Z0-9]{1,9}-\d{1,6}$/.test(key.trim().toUpperCase()) && body.trim().length > 0;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const k = key.trim().toUpperCase();
      await api("POST", `/api/jira/issues/${encodeURIComponent(k)}/comment`, { body });
      toast.success(`Comentario añadido a ${k}`);
      onClose();
    } catch (err) {
      toast.error("No se pudo comentar en Jira", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={send} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Comentar en Jira</DialogTitle>
            <DialogDescription>Edita el texto: se guarda tal cual como comentario de la incidencia.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label htmlFor="jc-key" className="text-sm font-medium">
              Incidencia
            </label>
            <Input id="jc-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="INOX-2021" className="w-48 font-mono uppercase" required />
            {!initialKey && <span className="text-xs text-muted-foreground">No he encontrado la clave en la sesión: escríbela.</span>}
          </div>
          <Textarea aria-label="Comentario" rows={10} value={body} onChange={(e) => setBody(e.target.value)} className="text-sm" maxLength={30000} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !valid}>
              {busy ? "Enviando…" : "Añadir comentario"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
