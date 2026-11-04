"use client";

import * as React from "react";
import { CheckIcon, ClipboardListIcon, MessageSquareIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, refresh, type Run } from "@/lib/api";
import { errorMessage } from "./common";
import { Markdown } from "./markdown";

/** Claude's plan (ExitPlanMode) as a readable document, with the three ways to answer it. */
export function PlanCard({ plan, run, actionable }: { plan: string; run: Run; actionable: boolean }) {
  const [busy, setBusy] = React.useState(false);

  async function answer(prompt: string, permissionMode: "acceptEdits" | "plan", done: string) {
    setBusy(true);
    try {
      await api<Run>("POST", "/api/runs", { mode: "headless", projectPath: run.projectPath, prompt, continueRunId: run.id, permissionMode, model: run.model || undefined });
      refresh("/api/runs", "/api/overview");
      toast.success(done);
    } catch (e) {
      toast.error("No se pudo enviar", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-purple/40 bg-card">
      <div className="flex items-center gap-2 border-b bg-purple/10 px-3.5 py-2 text-sm font-medium">
        <ClipboardListIcon className="size-4 text-purple" /> Plan de Claude
      </div>
      <Markdown className="max-h-[28rem] overflow-y-auto px-4 py-3">{plan}</Markdown>
      {actionable && (
        <div className="flex flex-wrap items-center gap-2 border-t bg-inset px-3.5 py-2.5">
          <Button size="sm" disabled={busy} onClick={() => void answer("Apruebo el plan. Ejecútalo.", "acceptEdits", "Plan aceptado: Claude lo está ejecutando")}>
            <CheckIcon /> Aceptar y ejecutar
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void answer("No apruebo este plan. No hagas ningún cambio todavía; espera mis indicaciones.", "plan", "Plan rechazado")}>
            <XIcon /> Rechazar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              const box = document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Responder a Claude']");
              box?.focus();
              box?.scrollIntoView({ block: "center", behavior: "smooth" });
            }}
          >
            <MessageSquareIcon /> Hablar con Claude
          </Button>
          <span className="text-xs text-muted-foreground">«Aceptar» ejecuta con permiso para editar archivos.</span>
        </div>
      )}
    </div>
  );
}
