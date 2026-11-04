/** Slash commands of the session chat: a few handled by Agentic, the rest sent to Claude Code as they are. */
export type PermMode = "default" | "plan" | "acceptEdits" | "auto";
export type SlashKind = "builtin" | "user" | "project" | "skill";
export interface SlashCommand {
  name: string;
  description: string;
  kind: SlashKind;
  hint?: string;
}

export const MODELS = ["sonnet", "opus", "haiku", "fable"] as const;

export const BUILTIN: SlashCommand[] = [
  { name: "plan", description: "Modo plan: Claude sólo planifica y no modifica nada", kind: "builtin", hint: "mensaje (opcional)" },
  { name: "edits", description: "Aceptar ediciones sin preguntar (los comandos sí preguntan)", kind: "builtin", hint: "mensaje (opcional)" },
  { name: "ask", description: "Preguntar antes de cada acción sensible (modo por defecto)", kind: "builtin", hint: "mensaje (opcional)" },
  { name: "auto", description: "Auto: Claude decide qué acciones son seguras", kind: "builtin", hint: "mensaje (opcional)" },
  { name: "model", description: "Cambiar de modelo: sonnet, opus, haiku o fable", kind: "builtin", hint: "sonnet | opus | haiku | fable" },
];

const MODE_OF: Record<string, PermMode> = { plan: "plan", edits: "acceptEdits", ask: "default", auto: "auto" };
export const MODE_LABEL: Record<PermMode, string> = { default: "Preguntar", plan: "Plan", acceptEdits: "Aceptar ediciones", auto: "Auto" };

export interface SlashResult {
  mode?: PermMode;
  model?: string;
  /** What is sent to Claude (empty when the message only switched mode/model). */
  prompt: string;
  /** Human-readable list of what was applied, e.g. ["modo Plan", "modelo opus"]. */
  applied: string[];
  error?: string;
}

/**
 * Handles the leading Agentic commands (`/plan`, `/edits`, `/ask`, `/auto`, `/model x`), possibly
 * several in a row. Anything else (custom commands, skills, plain text) is left untouched.
 */
export function parseSlash(input: string): SlashResult {
  let rest = input.trim();
  const out: SlashResult = { prompt: rest, applied: [] };
  for (;;) {
    const m = /^\/([A-Za-z]+)(?=\s|$)\s*/.exec(rest);
    if (!m) break;
    const name = m[1].toLowerCase();
    if (name in MODE_OF) {
      out.mode = MODE_OF[name];
      out.applied.push(`modo ${MODE_LABEL[out.mode]}`);
      rest = rest.slice(m[0].length);
    } else if (name === "model") {
      const arg = /^(\S+)\s*/.exec(rest.slice(m[0].length));
      const model = arg?.[1].toLowerCase();
      if (!model || !(MODELS as readonly string[]).includes(model)) {
        return { ...out, prompt: "", error: `Modelo no válido. Usa: ${MODELS.join(", ")}` };
      }
      out.model = model;
      out.applied.push(`modelo ${model}`);
      rest = rest.slice(m[0].length + arg![0].length);
    } else break;
  }
  out.prompt = out.applied.length ? rest.trim() : input.trim();
  return out;
}
