import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describePrPrompt, parseDescription, prFacts, streamClaudeText } from "@/lib/server/pr-describe";
import { FAKE_CLAUDE, tmpDir } from "./helpers";

const sh = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, encoding: "utf8" });

describe("parseDescription", () => {
  it("splits title and body, even while streaming", () => {
    expect(parseDescription("TITULO: Añade login")).toEqual({ title: null, body: "" }); // line not finished yet
    expect(parseDescription("TITULO: Añade login\n---\n## Resumen\nHola")).toEqual({ title: "Añade login", body: "## Resumen\nHola" });
    expect(parseDescription("TÍTULO: X\n---\n")).toEqual({ title: "X", body: "" });
  });
  it("without the expected shape everything is the body", () => {
    expect(parseDescription("solo un texto")).toEqual({ title: null, body: "solo un texto" });
  });
});

describe("prFacts and the prompt", () => {
  it("collects commits, stat and a capped diff against the base", async () => {
    const dir = tmpDir("prd-");
    sh(dir, "init", "-q", "-b", "main");
    fs.writeFileSync(path.join(dir, "a.txt"), "uno\n");
    sh(dir, "add", ".");
    sh(dir, "commit", "-q", "-m", "inicio");
    sh(dir, "checkout", "-q", "-b", "feat/x");
    fs.writeFileSync(path.join(dir, "a.txt"), "uno\ndos\n");
    sh(dir, "commit", "-qam", "Añade dos");
    const f = await prFacts(dir, "feat/x", "main");
    expect(f.commits).toContain("Añade dos");
    expect(f.stat).toContain("a.txt");
    expect(f.diff).toContain("+dos");
    const p = describePrPrompt("feat/x", "main", f);
    expect(p).toContain("<tarea>describir_pr</tarea>");
    expect(p).toContain("feat/x → main");
    expect(p).toContain("+dos");
  });
});

describe("streamClaudeText", () => {
  it("yields the text in pieces as it is written", async () => {
    const pieces: string[] = [];
    for await (const t of streamClaudeText({ claudeBin: FAKE_CLAUDE, cwd: tmpDir("prc-"), prompt: "<tarea>describir_pr</tarea>", model: "haiku" })) pieces.push(t);
    expect(pieces.length).toBeGreaterThan(2);
    const all = pieces.join("");
    expect(parseDescription(all)).toMatchObject({ title: "Añade login con Touch ID", body: expect.stringContaining("Permite entrar con la huella.") });
  });
  it("stops the process when the caller aborts", async () => {
    const ac = new AbortController();
    const got: string[] = [];
    for await (const t of streamClaudeText({ claudeBin: FAKE_CLAUDE, cwd: tmpDir("prc-"), prompt: "<tarea>describir_pr</tarea>", signal: ac.signal })) {
      got.push(t);
      ac.abort();
    }
    expect(got.length).toBeLessThan(4);
  });
});
