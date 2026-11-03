"use client";

import * as React from "react";
import { CheckCircle2Icon, DownloadIcon, Loader2Icon, XCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, refresh, useApi } from "@/lib/api";
import { errorMessage } from "./common";

type Tool = "tmux" | "claude";
interface Options {
  managers: string[];
  tools: Record<Tool, { command: string | null }>;
}
interface Job {
  id: string;
  command: string;
  status: "running" | "succeeded" | "failed";
  exitCode: number | null;
  log: string;
}

const LABEL: Record<Tool, string> = { tmux: "tmux", claude: "Claude Code" };

/** "Instalar con brew" for a missing tool, with the command's live output. */
export function InstallTool({ tool }: { tool: Tool }) {
  const { data } = useApi<Options>("/api/system/install");
  const [job, setJob] = React.useState<Job | null>(null);
  const [open, setOpen] = React.useState(false);
  const logRef = React.useRef<HTMLPreElement>(null);
  const command = data?.tools[tool]?.command ?? null;
  const manager = command?.split(" ")[0];

  React.useEffect(() => {
    if (!job || job.status !== "running") return;
    const t = setInterval(async () => {
      try {
        const next = await fetch(`/api/system/install/${job.id}`, { credentials: "same-origin" }).then((r) => r.json());
        setJob(next);
        if (next.status === "succeeded") {
          toast.success(`${LABEL[tool]} instalado`);
          refresh("/api/system");
        } else if (next.status === "failed") toast.error(`No se pudo instalar ${LABEL[tool]}`);
      } catch {}
    }, 1000);
    return () => clearInterval(t);
  }, [job, tool]);

  React.useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [job?.log]);

  if (!data) return null;
  if (!command)
    return (
      <a className="text-xs text-link hover:underline" href="https://brew.sh" target="_blank" rel="noreferrer">
        Instala Homebrew
      </a>
    );

  async function start() {
    setOpen(true);
    try {
      setJob(await api<Job>("POST", "/api/system/install", { tool }));
    } catch (e) {
      toast.error(errorMessage(e));
      setOpen(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={start} disabled={job?.status === "running"}>
        <DownloadIcon /> Instalar con {manager}
      </Button>
      <Dialog open={open} onOpenChange={(o) => job?.status !== "running" && setOpen(o)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {job?.status === "succeeded" ? (
                <CheckCircle2Icon className="size-4 text-success" />
              ) : job?.status === "failed" ? (
                <XCircleIcon className="size-4 text-destructive" />
              ) : (
                <Loader2Icon className="size-4 animate-spin" />
              )}
              Instalar {LABEL[tool]}
            </DialogTitle>
            <DialogDescription>
              Se ejecuta en este dispositivo: <code className="rounded bg-secondary px-1 font-mono text-xs">{command}</code>
            </DialogDescription>
          </DialogHeader>
          <pre ref={logRef} aria-label="Salida de la instalación" className="max-h-80 min-h-40 overflow-auto rounded-md border bg-inset p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {job?.log ?? "Iniciando…"}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={job?.status === "running"}>
              {job?.status === "running" ? "Instalando…" : "Cerrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
