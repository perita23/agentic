import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyUrl, contextOf, extractLibraryLinks } from "@/lib/library";
import { createContext } from "@/lib/server/context";
import { parseSlash } from "@/lib/slash";
import { FAKE_CLAUDE, tmpDir } from "./helpers";

function ctx() {
  const claudeHome = tmpDir();
  const project = fs.realpathSync(tmpDir("proj-"));
  const c = createContext({ dataDir: tmpDir(), claudeHome, claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 2, maxLogBytes: 1e6 });
  c.projects.create({ path: project, name: "demo" });
  return { c, claudeHome, project };
}

describe("slash commands", () => {
  it("handles Agentic's own commands and leaves the rest untouched", () => {
    expect(parseSlash("/plan refactoriza el login")).toMatchObject({ mode: "plan", prompt: "refactoriza el login", applied: ["modo Plan"] });
    expect(parseSlash("/edits")).toMatchObject({ mode: "acceptEdits", prompt: "" });
    expect(parseSlash("/plan /model opus hazlo")).toMatchObject({ mode: "plan", model: "opus", prompt: "hazlo" });
    expect(parseSlash("/model gpt4 hola").error).toMatch(/Modelo no válido/);
    // Custom commands, skills and plain text go to Claude Code as typed.
    expect(parseSlash("/review src/app.ts")).toMatchObject({ prompt: "/review src/app.ts", applied: [] });
    expect(parseSlash("  hola /plan ")).toMatchObject({ prompt: "hola /plan", applied: [] });
  });

  it("lists Claude Code custom commands and skills, project ones overriding user ones", () => {
    const { c, claudeHome, project } = ctx();
    fs.mkdirSync(path.join(claudeHome, "commands", "frontend"), { recursive: true });
    fs.writeFileSync(path.join(claudeHome, "commands", "review.md"), "---\ndescription: Revisa el diff\nargument-hint: [fichero]\n---\nRevisa $ARGUMENTS");
    fs.writeFileSync(path.join(claudeHome, "commands", "frontend", "lint.md"), "# Lint\nPasa el linter del frontend");
    fs.mkdirSync(path.join(claudeHome, "skills", "pdf"), { recursive: true });
    fs.writeFileSync(path.join(claudeHome, "skills", "pdf", "SKILL.md"), "---\nname: pdf\ndescription: 'Trabaja con PDFs'\n---\n");
    fs.mkdirSync(path.join(project, ".claude", "commands"), { recursive: true });
    fs.writeFileSync(path.join(project, ".claude", "commands", "review.md"), "---\ndescription: Revisión de este proyecto\n---\n");
    const list = c.commands.list(project);
    expect(list.map((x) => `${x.kind}:${x.name}`)).toEqual(["user:frontend:lint", "skill:pdf", "project:review"]);
    expect(list.find((x) => x.name === "review")?.description).toBe("Revisión de este proyecto");
    expect(list.find((x) => x.name === "frontend:lint")?.description).toBe("Pasa el linter del frontend");
    expect(c.commands.list("/etc").map((x) => x.name)).toContain("review"); // unknown project: user-level only
    expect(c.commands.list(null).find((x) => x.name === "review")?.kind).toBe("user");
  });
});

describe("library", () => {
  it("classifies and extracts artifacts, PRs, issues and documents", () => {
    expect(classifyUrl("https://claude.ai/artifact/PHSm9eeQijUzXhzrN3yyV8")).toBe("artifact");
    expect(classifyUrl("https://claude.ai/code/artifact/abc-123")).toBe("artifact");
    expect(classifyUrl("https://github.com/perita23/agentic/pull/36")).toBe("pr");
    expect(classifyUrl("https://acme.atlassian.net/browse/INOX-2021")).toBe("issue");
    expect(classifyUrl("https://example.com/x")).toBeNull();
    const text = "Mira **https://claude.ai/artifact/abc123**, el PR (https://github.com/a/b/pull/7). Doc: https://docs.google.com/document/d/XYZ/edit#heading=1 y https://example.com/otra.";
    expect(extractLibraryLinks(text).map((l) => [l.kind, l.url])).toEqual([
      ["artifact", "https://claude.ai/artifact/abc123"],
      ["pr", "https://github.com/a/b/pull/7"],
      ["doc", "https://docs.google.com/document/d/XYZ/edit"],
    ]);
    expect(contextOf("Resumen de precios listo:\n- Opciones: https://claude.ai/artifact/abc123", "https://claude.ai/artifact/abc123")).toBe("Opciones");
  });

  it("indexes links from session transcripts, aggregated by URL and cached", async () => {
    const { c, claudeHome } = ctx();
    const dir = path.join(claudeHome, "projects", "-tmp-demo");
    fs.mkdirSync(dir, { recursive: true });
    const line = (o: object) => JSON.stringify(o) + "\n";
    const art = "https://claude.ai/artifact/PHSm9eeQijUzXhzrN3yyV8";
    fs.writeFileSync(
      path.join(dir, "aaaa1111-0000-0000-0000-000000000000.jsonl"),
      line({ type: "user", cwd: "/tmp/demo", timestamp: "2026-11-01T10:00:00Z", message: { role: "user", content: "hazme un resumen" } }) +
        line({ type: "assistant", cwd: "/tmp/demo", timestamp: "2026-11-01T10:05:00Z", message: { role: "assistant", content: [{ type: "text", text: `Comparativa de precios lista:\n${art}` }] } }) +
        line({ type: "assistant", cwd: "/tmp/demo", timestamp: "2026-11-01T10:06:00Z", message: { role: "assistant", content: [{ type: "text", text: `PR abierto https://github.com/perita23/agentic/pull/36 y de nuevo ${art}` }] } }),
    );
    fs.writeFileSync(
      path.join(dir, "bbbb2222-0000-0000-0000-000000000000.jsonl"),
      line({ type: "user", cwd: "/tmp/demo", timestamp: "2026-11-03T09:00:00Z", message: { role: "user", content: [{ type: "tool_result", content: `ver ${art}` }] } }),
    );
    const first = await c.library.list();
    expect(first.total).toBe(2);
    expect(first.scanned).toBe(2);
    const a = first.items.find((i) => i.url === art)!;
    expect(a).toMatchObject({ kind: "artifact", mentions: 3, sessions: 2, sessionId: "bbbb2222-0000-0000-0000-000000000000", cwd: "/tmp/demo" });
    expect(a.title).toBe("Comparativa de precios lista");
    expect(first.items.find((i) => i.kind === "pr")?.url).toBe("https://github.com/perita23/agentic/pull/36");
    expect(first.items.map((i) => i.kind)).toEqual(["artifact", "pr"]); // newest first
    // A second call reuses the cache.
    expect((await c.library.list(0)).items).toHaveLength(2);
  });
});
