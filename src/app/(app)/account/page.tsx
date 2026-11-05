"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ActivityIcon, BookOpenTextIcon, CameraIcon, CheckIcon, CircleCheckIcon, CircleDashedIcon, CoinsIcon, FolderGit2Icon, MessagesSquareIcon, PlugIcon, TerminalSquareIcon, UserRoundIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedNumber } from "@/components/app/animated-number";
import { Avatar, useProfile } from "@/components/app/avatar";
import { AvatarDialog } from "@/components/app/avatar-dialog";
import { PageHeader, Stat } from "@/components/app/common";
import { Reveal, Stagger, StaggerItem } from "@/components/app/reveal";
import { SessionsCard, TouchIdCard } from "@/components/app/security-settings";
import { SkeletonStats } from "@/components/app/skeletons";
import { UsageCard } from "@/components/app/usage-card";
import { useApi, type Overview } from "@/lib/api";
import { compactTokens } from "@/lib/live-stats";
import { useDeviceName } from "@/lib/use-device";
import { cn } from "@/lib/utils";

const PROVIDERS = [
  { id: "slack", name: "Slack" },
  { id: "github", name: "GitHub" },
  { id: "bitbucket", name: "Bitbucket" },
  { id: "jira", name: "Jira" },
] as const;

function since(iso?: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
}

/** The name field saves by itself when you leave it, with a small check as proof. */
function NameField({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> }) {
  const [text, setText] = React.useState(value);
  const [saved, setSaved] = React.useState(false);
  async function commit() {
    const v = text.trim();
    if (v === value) return;
    await onSave(v);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }
  return (
    <div className="relative max-w-sm">
      <Input
        aria-label="Tu nombre"
        value={text}
        maxLength={60}
        placeholder="¿Cómo te llamas?"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className="h-10 pr-9 text-lg font-semibold"
      />
      <AnimatePresence>
        {saved && (
          <motion.span initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="absolute top-1/2 right-3 -translate-y-1/2 text-success" aria-label="Guardado">
            <CheckIcon className="size-4" />
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function Connections() {
  const { data: integ } = useApi<Record<string, { configured: boolean }>>("/api/integrations");
  const { data: ob } = useApi<{ ready: boolean }>("/api/obsidian");
  const rows = [
    ...PROVIDERS.map((p) => ({ key: p.id, name: p.name, on: !!integ?.[p.id]?.configured, href: "/integrations", icon: PlugIcon })),
    { key: "obsidian", name: "Obsidian", on: !!ob?.ready, href: "/settings", icon: BookOpenTextIcon },
  ];
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <PlugIcon className="size-4" /> Conexiones
          </CardTitle>
          <CardDescription>Los servicios que has conectado a Agentic en este dispositivo.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {!integ ? (
          <div className="grid gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : (
          <Stagger gap={0.04} className="grid gap-1.5">
            {rows.map((r) => (
              <StaggerItem key={r.key}>
                <Link href={r.href} className="lift flex items-center gap-3 rounded-lg border px-3 py-2 text-sm hover:border-border-strong">
                  <r.icon className="size-4 text-muted-foreground" />
                  <span className="flex-1">{r.name}</span>
                  <span className={cn("flex items-center gap-1.5 text-xs", r.on ? "text-success" : "text-muted-foreground")}>
                    {r.on ? <CircleCheckIcon className="size-3.5" /> : <CircleDashedIcon className="size-3.5" />}
                    {r.on ? "Conectado" : "Sin conectar"}
                  </span>
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </CardContent>
    </Card>
  );
}

export default function AccountPage() {
  const { profile, save } = useProfile();
  const { data: overview } = useApi<Overview>("/api/overview");
  const device = useDeviceName();
  const [dialog, setDialog] = React.useState(false);
  const s = profile?.stats;
  const joined = since(profile?.createdAt) ?? since(s?.firstRunAt);

  return (
    <div className="flex flex-col gap-6">
      <Reveal y={6}>
        <PageHeader icon={UserRoundIcon} title="Mi cuenta" description="Quién eres en Agentic y qué has hecho con Claude. Todo se guarda solo en este dispositivo." />
      </Reveal>

      <Reveal delay={0.05}>
        <Card className="overflow-hidden py-0">
          <div className="relative h-20 bg-gradient-to-r from-secondary via-accent to-secondary">
            <div className="absolute inset-0 opacity-40 [background:radial-gradient(circle_at_20%_0%,rgb(255_255_255/0.08),transparent_55%)]" />
          </div>
          <CardContent className="-mt-10 flex flex-col gap-4 pb-5 sm:flex-row sm:items-end">
            <button type="button" onClick={() => setDialog(true)} aria-label="Cambiar imagen" className="group press relative shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary">
              {profile ? <Avatar profile={profile} size={96} className="border-4 border-card" /> : <Skeleton className="size-24 rounded-full border-4 border-card" />}
              <span className="absolute inset-1 flex items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-[1px] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <CameraIcon className="size-5" />
              </span>
            </button>
            <div className="grid min-w-0 flex-1 gap-1.5">
              {profile ? <NameField value={profile.name} onSave={(name) => save({ name })} /> : <Skeleton className="h-10 w-64" />}
              <p className="text-sm text-muted-foreground">
                {device} · v{process.env.NEXT_PUBLIC_APP_VERSION}
                {joined && <> · usándolo desde el {joined}</>}
              </p>
            </div>
          </CardContent>
        </Card>
      </Reveal>

      {!profile ? (
        <SkeletonStats n={4} />
      ) : (
        <Stagger className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Ejecuciones", value: <AnimatedNumber value={s!.runs} />, hint: `${s!.completed} completadas`, icon: TerminalSquareIcon, accent: "text-warning" },
            { label: "Tokens en ejecuciones", value: <AnimatedNumber value={s!.tokens} format={(n) => compactTokens(Math.round(n))} />, hint: "entrada + salida", icon: CoinsIcon, accent: "text-purple" },
            { label: "Sesiones de Claude", value: <AnimatedNumber value={overview?.counts.sessions ?? 0} />, hint: `${overview?.counts.sessionsToday ?? 0} hoy`, icon: MessagesSquareIcon, accent: "text-success" },
            { label: "Proyectos", value: <AnimatedNumber value={overview?.counts.projects ?? 0} />, hint: `${overview?.counts.tasks ?? 0} tareas`, icon: FolderGit2Icon, accent: "text-primary" },
          ].map((x) => (
            <StaggerItem key={x.label}>
              <Stat label={x.label} value={x.value} hint={x.hint} icon={x.icon} accent={x.accent} />
            </StaggerItem>
          ))}
        </Stagger>
      )}

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Reveal delay={0.1}>
          <UsageCard />
        </Reveal>
        <Reveal delay={0.15}>
          <Connections />
        </Reveal>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Reveal delay={0.2}>
          <TouchIdCard />
        </Reveal>
        <Reveal delay={0.25}>
          <SessionsCard />
        </Reveal>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ActivityIcon className="size-3.5" /> Tu nombre y tu imagen no salen de este dispositivo.
      </p>

      <AvatarDialog open={dialog} onOpenChange={setDialog} profile={profile} onSave={(avatar) => save({ avatar })} />
    </div>
  );
}
