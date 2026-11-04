/** Turns a tool call (Bash, Edit, Read, MCP…) into something a person can scan: what it is and what it does. */
export type ToolIcon = "docker" | "git" | "package" | "test" | "kube" | "web" | "db" | "files" | "cloud" | "ssh" | "terminal" | "edit" | "read" | "search" | "agent" | "todo" | "mcp";

export interface ToolInfo {
  icon: ToolIcon;
  /** Short category: "Docker", "Git", "Editar archivo"… */
  group: string;
  /** What it does, in plain Spanish: "Leyendo logs de api". */
  title: string;
  /** The raw command / path / pattern, for the monospace line. */
  detail: string;
}

const first = (s: string) => s.trim().split(/\s+/)[0] ?? "";

/** The command that matters: skips `cd x &&`, env assignments, sudo, and takes the first real segment. */
export function mainCommand(command: string): string {
  const segs = command.split(/&&|;|\n/).map((s) => s.trim()).filter(Boolean);
  const real = segs.find((s) => !/^(cd|export|set|source|\.)\b/.test(s)) ?? segs[0] ?? "";
  return real.replace(/^(\w+=\S+\s+)+/, "").replace(/^(sudo|time|nohup)\s+/, "").trim();
}

const args = (cmd: string) => cmd.split(/\s+/).slice(1).filter(Boolean);
const positional = (a: string[]) => a.filter((x) => !x.startsWith("-"));

const DOCKER: Record<string, string> = {
  logs: "Leyendo logs",
  ps: "Listando contenedores",
  exec: "Ejecutando dentro del contenedor",
  build: "Construyendo la imagen",
  run: "Arrancando un contenedor",
  up: "Levantando servicios",
  down: "Parando servicios",
  restart: "Reiniciando",
  stop: "Parando",
  start: "Arrancando",
  pull: "Descargando imágenes",
  images: "Listando imágenes",
  inspect: "Inspeccionando",
  rm: "Eliminando",
  stats: "Mirando el consumo",
  compose: "Docker Compose",
};

const GIT: Record<string, string> = {
  status: "Mirando el estado",
  diff: "Revisando los cambios",
  log: "Leyendo el historial",
  commit: "Haciendo commit",
  push: "Subiendo los cambios",
  pull: "Bajando los cambios",
  checkout: "Cambiando de rama",
  switch: "Cambiando de rama",
  branch: "Gestionando ramas",
  merge: "Fusionando",
  rebase: "Reorganizando commits",
  add: "Preparando archivos",
  stash: "Guardando cambios",
  clone: "Clonando",
  fetch: "Trayendo novedades",
};

/** Classify a shell command. */
export function describeBash(command: string): ToolInfo {
  const main = mainCommand(command);
  const bin = first(main).replace(/^.*\//, "");
  const a = args(main);
  const pos = positional(a);
  const detail = command.trim();
  const mk = (icon: ToolIcon, group: string, title: string): ToolInfo => ({ icon, group, title, detail });

  if (bin === "docker" || bin === "podman" || bin === "docker-compose") {
    const compose = bin === "docker-compose" || pos[0] === "compose";
    const sub = compose ? (bin === "docker-compose" ? pos[0] : pos[1]) : pos[0];
    const verb = DOCKER[sub ?? ""] ?? "Ejecutando";
    const target = sub === "logs" || sub === "exec" || sub === "restart" || sub === "stop" || sub === "start" ? pos[pos.length - 1] !== sub ? pos[pos.length - 1] : undefined : undefined;
    return mk("docker", compose ? "Docker Compose" : "Docker", target ? `${verb} · ${target}` : verb);
  }
  if (bin === "git") return mk("git", "Git", GIT[pos[0] ?? ""] ?? `git ${pos[0] ?? ""}`.trim());
  if (bin === "gh") return mk("git", "GitHub", `gh ${pos.slice(0, 2).join(" ")}`.trim());
  if (bin === "kubectl" || bin === "helm" || bin === "minikube") return mk("kube", "Kubernetes", `${bin} ${pos.slice(0, 2).join(" ")}`.trim());
  if (["pytest", "vitest", "jest", "mocha", "playwright"].includes(bin) || /\b(test|vitest|jest|pytest)\b/.test(main.split(/\s+/).slice(0, 3).join(" ")))
    return mk("test", "Tests", "Ejecutando los tests");
  if (["npm", "pnpm", "yarn", "bun", "npx", "pip", "pip3", "uv", "cargo", "go", "brew", "apt", "apt-get", "poetry", "gradle", "mvn", "make"].includes(bin)) {
    const what = pos[0] === "run" ? `${bin} run ${pos[1] ?? ""}` : `${bin} ${pos[0] ?? ""}`;
    return mk("package", "Paquetes y build", what.trim());
  }
  if (["curl", "wget", "http", "ping", "nslookup", "dig"].includes(bin)) return mk("web", "Red", `${bin} ${pos[0] ?? ""}`.trim());
  if (["psql", "mysql", "sqlite3", "redis-cli", "mongosh", "mongo"].includes(bin)) return mk("db", "Base de datos", `Consultando con ${bin}`);
  if (["aws", "gcloud", "az", "terraform", "pulumi", "vercel", "fly", "wrangler"].includes(bin)) return mk("cloud", "Cloud", `${bin} ${pos.slice(0, 2).join(" ")}`.trim());
  if (["ssh", "scp", "rsync", "sftp"].includes(bin)) return mk("ssh", "Conexión remota", `${bin} ${pos[0] ?? ""}`.trim());
  if (["ls", "cat", "find", "mkdir", "rm", "cp", "mv", "touch", "tree", "head", "tail", "wc", "du", "chmod", "tar", "unzip"].includes(bin)) return mk("files", "Archivos", `${bin} ${pos[0] ?? ""}`.trim());
  return mk("terminal", "Terminal", main.length > 70 ? main.slice(0, 70) + "…" : main || "Comando");
}

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

export function describeTool(name: string, input: unknown): ToolInfo {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : "");
  switch (name) {
    case "Bash":
    case "BashOutput":
      return describeBash(str("command") || str("bash_id"));
    case "Edit":
    case "MultiEdit":
      return { icon: "edit", group: "Editar archivo", title: basename(str("file_path")), detail: str("file_path") };
    case "Write":
      return { icon: "edit", group: "Crear archivo", title: basename(str("file_path")), detail: str("file_path") };
    case "NotebookEdit":
      return { icon: "edit", group: "Editar notebook", title: basename(str("notebook_path")), detail: str("notebook_path") };
    case "Read":
      return { icon: "read", group: "Leer archivo", title: basename(str("file_path")), detail: str("file_path") };
    case "Glob":
      return { icon: "search", group: "Buscar archivos", title: str("pattern"), detail: str("pattern") };
    case "Grep":
      return { icon: "search", group: "Buscar en el código", title: str("pattern"), detail: `${str("pattern")}${str("path") ? ` en ${str("path")}` : ""}` };
    case "WebFetch":
      return { icon: "web", group: "Abrir página", title: str("url"), detail: str("url") };
    case "WebSearch":
      return { icon: "web", group: "Buscar en la web", title: str("query"), detail: str("query") };
    case "Task":
    case "Agent":
      return { icon: "agent", group: "Subagente", title: str("description") || str("subagent_type") || "Subagente", detail: str("prompt").slice(0, 300) };
    case "TodoWrite":
      return { icon: "todo", group: "Lista de tareas", title: "Actualizando la lista", detail: "" };
    default:
      if (name.startsWith("mcp__")) {
        const [, server = "mcp", ...tool] = name.split("__");
        return { icon: "mcp", group: server, title: tool.join(" ").replace(/_/g, " ") || name, detail: JSON.stringify(input ?? {}).slice(0, 300) };
      }
      return { icon: "terminal", group: name, title: name, detail: "" };
  }
}

/** Remove terminal colour codes from command output. */
export function stripAnsi(s: string): string {
   
  return s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r(?!\n)/g, "\n");
}
