"use client";

import * as React from "react";
import { BookOpenTextIcon, ChevronDownIcon, ExternalLinkIcon, FilePlus2Icon, FileTextIcon, PencilLineIcon, SparklesIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useApi } from "@/lib/api";
import { collectArtifacts, type SessionItem } from "@/lib/session-artifacts";
import { shortPath } from "@/lib/utils";
import { CopyButton } from "./common";

type Ev = Record<string, unknown> & { message?: { content?: unknown } };

function Section({ icon: Icon, title, tone, count, children }: { icon: React.ElementType; title: string; tone: string; count: number; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0">
      <h3 className={`mb-1 flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase ${tone}`}>
        <Icon className="size-3.5" /> {title} <span className="text-muted-foreground tabular-nums">{count}</span>
      </h3>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">{children}</ul>
    </section>
  );
}

function Row({ item, external }: { item: SessionItem; external?: string }) {
  return (
    <li className="group/row flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-secondary/60">
      <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1" title={item.key}>
        <span className="block truncate font-medium text-foreground">{item.label}</span>
        <span className="block truncate font-mono text-[10px] text-muted-foreground">{item.href ? item.detail : shortPath(item.detail)}</span>
      </span>
      {item.href ? (
        <a href={item.href} target={item.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="flex shrink-0 items-center gap-1 text-link hover:underline">
          {external ?? "Abrir"} <ExternalLinkIcon className="size-3" />
        </a>
      ) : (
        <CopyButton value={item.key} label="Copiar ruta" className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100" />
      )}
    </li>
  );
}

/**
 * What this session has produced, newest first: the artifacts it created or opened, the files it created, the notes it wrote in
 * Obsidian and (folded) the files it edited. It lives beside the conversation, not inside it.
 */
export function SessionArtifactsCard({ events }: { events: Ev[] }) {
  const { data } = useApi<{ ready: boolean; config: { vaultPath: string } }>("/api/obsidian");
  const root = data?.ready ? data.config.vaultPath : null;
  const a = React.useMemo(() => collectArtifacts(events, root), [events, root]);
  const total = a.artifacts.length + a.created.length + a.edited.length + a.notes.length;
  return (
    <Card data-testid="session-artifacts" className="min-w-0 overflow-hidden">
      <CardHeader>
        <CardTitle>Artefactos de la sesión</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-3">
        {total === 0 && <p className="text-xs text-muted-foreground">Todavía no ha creado ni abierto nada: aquí irán los artifacts, los archivos creados y las notas de Obsidian.</p>}
        {a.artifacts.length > 0 && (
          <Section icon={SparklesIcon} title="Artifacts" tone="text-purple" count={a.artifacts.length}>
            {a.artifacts.map((i) => (
              <Row key={i.key} item={i} external="Abrir artifact" />
            ))}
          </Section>
        )}
        {a.notes.length > 0 && (
          <Section icon={BookOpenTextIcon} title="Notas de Obsidian" tone="text-purple" count={a.notes.length}>
            {a.notes.map((i) => (
              <Row key={i.key} item={i} external="Abrir en Obsidian" />
            ))}
          </Section>
        )}
        {a.created.length > 0 && (
          <Section icon={FilePlus2Icon} title="Archivos creados" tone="text-success" count={a.created.length}>
            {a.created.slice(0, 12).map((i) => (
              <Row key={i.key} item={i} />
            ))}
            {a.created.length > 12 && <li className="px-1.5 text-[11px] text-muted-foreground">y {a.created.length - 12} más (pestaña «Cambios»)</li>}
          </Section>
        )}
        {a.edited.length > 0 && (
          <details className="group/ed min-w-0">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              <PencilLineIcon className="size-3.5" /> Archivos editados <span className="tabular-nums">{a.edited.length}</span>
              <ChevronDownIcon className="ml-auto size-3.5 transition-transform group-open/ed:rotate-180" />
            </summary>
            <ul className="mt-1 grid grid-cols-[minmax(0,1fr)] gap-0.5">
              {a.edited.slice(0, 30).map((i) => (
                <Row key={i.key} item={i} />
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
