import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Installer } from "@/lib/server/install";
import { tmpDir } from "./helpers";

/** A stand-in package manager: echoes its arguments, optionally fails or lingers. */
function fakeManager(name: string, { exitCode = 0, delayMs = 0 } = {}) {
  const file = path.join(tmpDir(), name);
  fs.writeFileSync(
    file,
    `#!/usr/bin/env node
if (process.argv[2] === "--version") { console.log("${name} 4.0.0"); process.exit(0); }
console.log("${name} " + process.argv.slice(2).join(" "));
setTimeout(() => process.exit(${exitCode}), ${delayMs});
`,
    { mode: 0o755 },
  );
  return file;
}

async function waitDone(inst: Installer, id: string) {
  for (let i = 0; i < 100; i++) {
    const j = inst.get(id);
    if (j.status !== "running") return j;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("install did not finish");
}

describe("installer", () => {
  it("prefers Homebrew and runs only the fixed recipe", async () => {
    const inst = new Installer({ brewPaths: [fakeManager("brew")], npmBin: fakeManager("npm") });
    const opts = await inst.options();
    expect(opts.managers.sort()).toEqual(["brew", "npm"]);
    expect(opts.tools).toEqual({ tmux: { command: "brew install tmux" }, claude: { command: "brew install --cask claude-code" } });
    const job = await inst.start("tmux");
    expect(job.command).toBe("brew install tmux");
    const done = await waitDone(inst, job.id);
    expect(done.status).toBe("succeeded");
    expect(done.log).toContain("brew install tmux");
  });

  it("falls back to npm for Claude Code and has no recipe for tmux without Homebrew", async () => {
    const inst = new Installer({ brewPaths: ["/nonexistent/brew"], npmBin: fakeManager("npm") });
    expect((await inst.options()).tools).toEqual({ tmux: { command: null }, claude: { command: "npm install -g @anthropic-ai/claude-code" } });
    await expect(inst.start("tmux")).rejects.toThrow(/brew\.sh/);
  });

  it("allows one install at a time, rejects unknown tools and reports failures", async () => {
    const inst = new Installer({ brewPaths: [fakeManager("brew", { exitCode: 1, delayMs: 300 })], npmBin: "/nonexistent/npm" });
    const job = await inst.start("tmux");
    await expect(inst.start("claude")).rejects.toThrow(/en curso/);
    // @ts-expect-error not a known tool
    await expect(inst.start("rm")).rejects.toThrow(/desconocida/);
    const done = await waitDone(inst, job.id);
    expect(done).toMatchObject({ status: "failed", exitCode: 1 });
    expect(() => inst.get("nope")).toThrow(/no encontrada/);
  });
});
