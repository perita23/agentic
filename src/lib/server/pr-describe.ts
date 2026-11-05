import { spawn } from "node:child_process";
import fs from "node:fs";
import { git, SAFE_DIFF } from "./git";
export { parseDescription } from "../pr-description";

const MAX_DIFF = 40_000;
const MAX_COMMITS = 40;

export interface PrFacts {
  commits: string;
  stat: string;
  diff: string;
  truncated: boolean;
}

/** What the branch changes: commits, files and (capped) diff against the remote copy of the base when there is one. */
export async function prFacts(projectPath: string, head: string, base: string): Promise<PrFacts> {
  const baseRef = (await git(projectPath, ["rev-parse", "--verify", "-q", `refs/remotes/origin/${base}`])) ? `origin/${base}` : base;
  const [commits, stat, diff] = await Promise.all([
    git(projectPath, ["log", `${baseRef}..${head}`, `-n${MAX_COMMITS}`, "--format=- %s%n%b"], { maxBuffer: 1024 * 1024 }),
    git(projectPath, ["diff", ...SAFE_DIFF, "--stat", `${baseRef}...${head}`], { maxBuffer: 1024 * 1024 }),
    git(projectPath, ["diff", ...SAFE_DIFF, "-U2", `${baseRef}...${head}`], { maxBuffer: 8 * 1024 * 1024 }),
  ]);
  const d = diff ?? "";
  return { commits: (commits ?? "").replace(/\n{2,}/g, "\n").trim(), stat: (stat ?? "").trim(), diff: d.slice(0, MAX_DIFF), truncated: d.length > MAX_DIFF };
}

/** The request to Claude. The answer has a fixed shape so it can be filled in while it streams. */
export function describePrPrompt(head: string, base: string, f: PrFacts): string {
  return [
    "<tarea>describir_pr</tarea>",
    "Redacta el título y la descripción de una pull request a partir de estos cambios. No uses herramientas ni leas archivos: todo lo necesario está aquí.",
    "Escribe en el mismo idioma que los mensajes de commit (español si dudas).",
    "Responde EXACTAMENTE con este formato, sin nada antes ni después:",
    "TITULO: <una línea de máximo 72 caracteres, claro y concreto>",
    "---",
    "<descripción en Markdown, breve: «## Resumen» (1-3 frases con el porqué), «## Cambios» (lista con lo importante, agrupado) y «## Cómo probarlo» sólo si procede>",
    "",
    `Rama: ${head} → ${base}`,
    "",
    "Commits:",
    f.commits || "(sin commits)",
    "",
    "Archivos:",
    f.stat || "(sin cambios)",
    "",
    `Diff${f.truncated ? " (recortado)" : ""}:`,
    f.diff,
  ].join("\n");
}

/**
 * Run `claude -p` once and yield its text as it is written (partial messages). A neutral folder, plan mode and a
 * small fast model: it only writes text from what it was given, and the user reads it before anything is sent.
 */
export async function* streamClaudeText(opts: { claudeBin: string; cwd: string; prompt: string; model?: string; signal?: AbortSignal; timeoutMs?: number }): AsyncGenerator<string> {
  fs.mkdirSync(opts.cwd, { recursive: true });
  const child = spawn(opts.claudeBin, ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--permission-mode", "plan", ...(opts.model ? ["--model", opts.model] : []), "--", opts.prompt], {
    cwd: opts.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });
  const kill = () => {
    if (!child.killed) child.kill("SIGTERM");
  };
  opts.signal?.addEventListener("abort", kill, { once: true });
  const timer = setTimeout(kill, opts.timeoutMs ?? 90_000);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d: string) => (stderr = (stderr + d).slice(-400)));
  const exit = new Promise<number | null>((r) => {
    child.on("close", (code) => r(code));
    child.on("error", () => r(-1));
  });

  let buf = "";
  let sawDelta = false;
  let final = "";
  child.stdout.setEncoding("utf8");
  try {
    for await (const chunk of child.stdout as AsyncIterable<string>) {
      buf += chunk;
      let i: number;
      const out: string[] = [];
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          const o = JSON.parse(line) as { type?: string; result?: unknown; event?: { type?: string; delta?: { type?: string; text?: string } } };
          if (o.type === "stream_event" && o.event?.type === "content_block_delta" && o.event.delta?.type === "text_delta" && o.event.delta.text) {
            sawDelta = true;
            out.push(o.event.delta.text);
          } else if (o.type === "result" && typeof o.result === "string") final = o.result;
        } catch {}
      }
      for (const t of out) yield t;
    }
    const code = await exit;
    // No partial messages (older CLI): the whole answer arrives at the end.
    if (!sawDelta && final) yield final;
    if (!sawDelta && !final && code !== 0) throw new Error(stderr.trim().split("\n").pop() || "Claude no pudo generar la descripción");
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", kill);
    kill();
  }
}
