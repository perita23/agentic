"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  BotIcon,
  ChartColumnIcon,
  FileStackIcon,
  FolderGit2Icon,
  GitPullRequestIcon,
  KanbanSquareIcon,
  MessageCircleIcon,
  PlugIcon,
  LayoutDashboardIcon,
  MessagesSquareIcon,
  PlusIcon,
  RocketIcon,
  SearchIcon,
  SettingsIcon,
  TicketIcon,
  TerminalSquareIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { useApi, type Overview, type ProjectListItem, type SessionSummary } from "@/lib/api";
import { cn, shortPath } from "@/lib/utils";
import { Kbd, StatusDot } from "./common";
import { LauncherProvider, useLauncher } from "./launcher";
import { RunNotifier } from "./run-notifier";
import { WhatsNew } from "./whats-new";
import { BrandMark } from "@/components/app/brand-mark";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/sessions", label: "Sesiones", icon: MessagesSquareIcon, badge: "sessions" as const },
  { href: "/runs", label: "Ejecuciones", icon: TerminalSquareIcon, badge: "runs" as const },
  { href: "/tasks", label: "Tareas", icon: KanbanSquareIcon },
  { href: "/pulls", label: "Pull requests", icon: GitPullRequestIcon },
  { href: "/jira", label: "Jira", icon: TicketIcon },
  { href: "/templates", label: "Plantillas", icon: FileStackIcon },
  { href: "/agents", label: "Agentes", icon: BotIcon },
  { href: "/projects", label: "Proyectos", icon: FolderGit2Icon },
  { href: "/analytics", label: "Analítica", icon: ChartColumnIcon },
  { href: "/messages", label: "Mensajes", icon: MessageCircleIcon },
  { href: "/integrations", label: "Integraciones", icon: PlugIcon },
  { href: "/settings", label: "Ajustes", icon: SettingsIcon },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 px-2 py-1">
      <BrandMark className="drop-shadow-[0_2px_8px_rgba(167,139,250,0.25)]" />
      <span className="font-semibold tracking-tight">Agentic</span>
      <span className="rounded border px-1 font-mono text-[10px] text-muted-foreground">local</span>
    </Link>
  );
}

function Sidebar({ overview }: { overview?: Overview }) {
  const pathname = usePathname();
  const counts = { sessions: overview?.counts.activeSessions ?? 0, runs: overview?.counts.runningRuns ?? 0 };
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
      <div className="app-drag traffic-light-gap flex h-14 items-center border-b px-3">
        <Logo />
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-2" aria-label="Principal">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const count = item.badge ? counts[item.badge] : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                active ? "text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {active && (
                <motion.span layoutId="nav-active" className="absolute inset-0 rounded-md bg-accent" transition={{ type: "spring", stiffness: 500, damping: 40 }}>
                  <span className="absolute top-1.5 bottom-1.5 -left-2 w-0.5 rounded-full bg-foreground" />
                </motion.span>
              )}
              <item.icon className="relative size-4" />
              <span className="relative">{item.label}</span>
              {count > 0 && (
                <span className="relative ml-auto flex items-center gap-1.5 rounded-full bg-warning/15 px-1.5 text-[11px] font-medium text-warning tabular-nums">
                  <StatusDot status="running" className="size-1.5" />
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-3 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-success" /> Todo se ejecuta en tu dispositivo
          <span className="ml-auto font-mono">v{process.env.NEXT_PUBLIC_APP_VERSION}</span>
        </div>
      </div>
    </aside>
  );
}

function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b bg-sidebar px-2 py-1.5 md:hidden" aria-label="Principal">
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn("flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs", isActive(pathname, item.href) ? "bg-accent text-foreground" : "text-muted-foreground")}
        >
          <item.icon className="size-3.5" /> {item.label}
        </Link>
      ))}
    </nav>
  );
}

function CommandPalette({ open, setOpen }: { open: boolean; setOpen: (o: boolean) => void }) {
  const router = useRouter();
  const launcher = useLauncher();
  const { data: sessions } = useApi<{ sessions: SessionSummary[] }>(open ? "/api/sessions?limit=50" : null);
  const { data: projects } = useApi<{ projects: ProjectListItem[] }>(open ? "/api/projects" : null);
  const go = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Busca páginas, sesiones, proyectos…" />
      <CommandList>
        <CommandEmpty>Sin resultados.</CommandEmpty>
        <CommandGroup heading="Acciones">
          <CommandItem onSelect={() => go(() => launcher.open())}>
            <RocketIcon /> Nueva sesión de Claude Code <CommandShortcut>N</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go(() => router.push("/tasks?new=1"))}>
            <PlusIcon /> Nueva tarea
          </CommandItem>
          <CommandItem onSelect={() => go(() => router.push("/agents?new=1"))}>
            <BotIcon /> Nuevo agente
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Ir a">
          {NAV.map((n) => (
            <CommandItem key={n.href} onSelect={() => go(() => router.push(n.href))}>
              <n.icon /> {n.label}
            </CommandItem>
          ))}
        </CommandGroup>
        {!!projects?.projects.length && (
          <CommandGroup heading="Proyectos">
            {projects.projects.slice(0, 20).map((p) => (
              <CommandItem key={p.path} value={`proyecto ${p.name} ${p.path}`} onSelect={() => go(() => router.push(`/projects/view?path=${encodeURIComponent(p.path)}`))}>
                <FolderGit2Icon /> {p.name}
                <span className="ml-auto truncate font-mono text-xs text-muted-foreground">{shortPath(p.path)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!!sessions?.sessions.length && (
          <CommandGroup heading="Sesiones recientes">
            {sessions.sessions.slice(0, 30).map((s) => (
              <CommandItem key={s.id} value={`sesion ${s.title} ${s.cwd} ${s.id}`} onSelect={() => go(() => router.push(`/sessions/${s.id}`))}>
                <StatusDot status={s.status} /> <span className="truncate">{s.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}

function Topbar({ onSearch }: { onSearch: () => void }) {
  const launcher = useLauncher();
  return (
    <header className="app-drag sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:px-6">
      <div className="md:hidden">
        <Logo />
      </div>
      <button
        onClick={onSearch}
        className="flex h-8 w-full max-w-md cursor-pointer items-center gap-2 rounded-md border bg-inset px-3 text-sm text-muted-foreground transition-colors hover:border-border-strong"
      >
        <SearchIcon className="size-4" />
        <span className="flex-1 text-left">Buscar o ejecutar un comando…</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      <div className="ml-auto flex items-center gap-2">
        <Button onClick={() => launcher.open()} size="sm">
          <RocketIcon /> <span className="hidden sm:inline">Nueva sesión</span>
        </Button>
      </div>
    </header>
  );
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const launcher = useLauncher();
  const { data: overview } = useApi<Overview>("/api/overview", { refreshInterval: 5000 });

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      const target = e.target as HTMLElement;
      const typing = target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "n" && !document.querySelector("[role=dialog]")) {
        e.preventDefault();
        launcher.open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [launcher]);

  return (
    <div className="flex min-h-screen">
      <Sidebar overview={overview} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onSearch={() => setPaletteOpen(true)} />
        <MobileNav />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
      <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} />
      <RunNotifier />
      <WhatsNew />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <LauncherProvider>
      <ShellInner>{children}</ShellInner>
    </LauncherProvider>
  );
}
