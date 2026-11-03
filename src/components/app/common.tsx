"use client";

import * as React from "react";
import { motion } from "motion/react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, icon: Icon, actions }: { title: string; description?: React.ReactNode; icon?: React.ElementType; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          {Icon && <Icon className="size-5 text-muted-foreground" />}
          {title}
        </h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: React.ElementType; title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center"
    >
      <div className="rounded-full border bg-secondary/50 p-3">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <div>
        <p className="font-medium">{title}</p>
        {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </motion.div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  busy: "bg-warning",
  running: "bg-warning",
  idle: "bg-success",
  completed: "bg-success",
  failed: "bg-destructive",
  stopped: "bg-muted-foreground",
  interrupted: "bg-muted-foreground",
  closed: "bg-[#484f58]",
};

export function StatusDot({ status, className }: { status: string; className?: string }) {
  const color = STATUS_COLORS[status] ?? "bg-primary";
  const pulse = status === "busy" || status === "running";
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)}>
      {pulse && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", color)} />}
      <span className={cn("relative inline-flex size-2 rounded-full", color)} />
    </span>
  );
}

export function CopyButton({ value, label = "Copiar", className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={className}
          aria-label={label}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            } catch {
              toast.error("No se pudo copiar al portapapeles");
            }
          }}
        >
          {done ? <CheckIcon className="text-success" /> : <CopyIcon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("rounded border border-b-2 bg-secondary px-1.5 font-mono text-[10px] text-muted-foreground", className)}>{children}</kbd>;
}

export function Stat({ label, value, hint, icon: Icon, accent }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon: React.ElementType; accent?: string }) {
  return (
    <div className="group relative overflow-hidden rounded-lg border bg-card p-4 transition-colors hover:border-[#8b949e]/40">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {label}
        <Icon className={cn("size-4", accent)} />
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
