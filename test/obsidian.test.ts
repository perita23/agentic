import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectVaults, ObsidianService, projectFolder } from "@/lib/server/obsidian";
import { buildClaudeArgs, RunManager, type Run } from "@/lib/server/runs";
import { JsonStore } from "@/lib/server/store";
import { FAKE_CLAUDE, tmpDir, waitFor } from "./helpers";

function vault() {
  const v = tmpDir();
  fs.mkdirSync(path.join(v, ".obsidian"));
  return fs.realpathSync(v);
}
const svc = (home = tmpDir()) => new ObsidianService(new JsonStore(tmpDir()), home);

describe("Obsidian settings", () => {
  it("starts off, and only accepts a real vault", () => {
    const o = svc();
    expect(o.get()).toEqual({ enabled: false, vaultPath: "", folder: "Agentic", scope: "folder" });
    expect(() => o.set({ enabled: true })).toThrow(/bóveda/);
    expect(() => o.set({ vaultPath: "/no/existe/nada" })).toThrow(/no existe/);
    expect(() => o.set({ vaultPath: tmpDir() })).toThrow(/no es una bóveda/);
    expect(() => o.set({ vaultPath: "relativa" })).toThrow();
    const v = vault();
    expect(o.set({ vaultPath: v, enabled: true })).toMatchObject({ enabled: true, vaultPath: v, folder: "Agentic" });
    expect(o.status().ready).toBe(true);
  });

  it("keeps the notes folder a plain name inside the vault", () => {
    const o = svc();
    for (const bad of ["../fuera", "a/b", "", ".oculta", "x..y"]) expect(() => o.set({ folder: bad })).toThrow();
    expect(o.set({ folder: "Notas de Claude" }).folder).toBe("Notas de Claude");
  });

  it("names a project's folder safely", () => {
    expect(projectFolder("/Users/h/code/inox-backend")).toBe("inox-backend");
    expect(projectFolder("/a/b/../c d")).toBe("c d");
    expect(projectFolder("/")).toBe("General");
    expect(projectFolder("/x/.secreto")).toBe("secreto");
  });

  it("finds the vaults Obsidian knows about", () => {
    const home = tmpDir();
    const v = vault();
    const notV = tmpDir();
    const dir = path.join(home, ".config", "obsidian");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "obsidian.json"), JSON.stringify({ vaults: { a: { path: v, ts: 1 }, b: { path: notV }, c: { path: "relativa" }, d: {} } }));
    expect(detectVaults(home, "linux")).toEqual([{ name: path.basename(v), path: v }]);
    expect(detectVaults(tmpDir(), "linux")).toEqual([]);
  });
});

describe("Obsidian in a run", () => {
  it("is nothing while it is off or the vault is gone", () => {
    const o = svc();
    expect(o.forRun("/x/proj")).toBeNull();
    const v = vault();
    o.set({ vaultPath: v, enabled: true });
    fs.rmSync(path.join(v, ".obsidian"), { recursive: true });
    expect(o.forRun("/x/proj")).toBeNull();
  });

  it("hands Claude only the Agentic folder and lets it write only there", () => {
    const o = svc();
    const v = vault();
    o.set({ vaultPath: v, enabled: true });
    const r = o.forRun("/Users/h/code/inox")!;
    expect(r.addDir).toBe(path.join(v, "Agentic"));
    expect(r.projectDir).toBe(path.join(v, "Agentic", "inox"));
    expect(fs.statSync(r.projectDir).isDirectory()).toBe(true);
    expect(r.allow).toEqual([`Edit(/${v}/Agentic/**)`, `Write(/${v}/Agentic/**)`]);
    expect(r.allow[0].startsWith("Edit(//")).toBe(true); // an absolute path in a permission rule starts with //
    expect(r.hint).toContain("inox");
    expect(r.hint).toMatch(/Solo puedes escribir/);
  });

  it("can read the whole vault, but still writes only in the folder", () => {
    const o = svc();
    const v = vault();
    o.set({ vaultPath: v, enabled: true, scope: "vault" });
    const r = o.forRun("/x/proj")!;
    expect(r.addDir).toBe(v);
    expect(r.allow.every((a) => a.includes(`${v}/Agentic/**`))).toBe(true);
    expect(r.hint).toMatch(/leer el resto/);
  });

  it("goes into claude's arguments", () => {
    const a = buildClaudeArgs({ mode: "headless", projectPath: "/x", prompt: "hola", permissionMode: "default", addDirs: ["/v/Agentic"], allowedTools: ["Edit(//v/Agentic/**)", "Write(//v/Agentic/**)"], appendPrompt: "NOTAS" });
    expect(a).toContain("--add-dir");
    expect(a.filter((x) => x === "--allowedTools")).toHaveLength(2);
    const sys = a[a.indexOf("--append-system-prompt") + 1];
    expect(sys).toContain("NOTAS");
    expect(sys).toContain("```email"); // the copy-box hint is still there
    const plain = buildClaudeArgs({ mode: "headless", projectPath: "/x", prompt: "hola", permissionMode: "default" });
    expect(plain).not.toContain("--allowedTools");
  });

  it("a run writes its note in the project's folder and the log shows it", async () => {
    const dataDir = tmpDir();
    const store = new JsonStore(dataDir);
    const o = new ObsidianService(store, tmpDir());
    const v = vault();
    o.set({ vaultPath: v, enabled: true });
    const m = new RunManager(store, { dataDir, claudeBin: FAKE_CLAUDE, maxConcurrent: 2, maxLogBytes: 1024 * 1024, obsidian: (cwd) => o.forRun(cwd) });
    const proj = tmpDir();
    const r = await m.start({ projectPath: proj, prompt: "OBSIDIAN" });
    await waitFor(() => (m.get(r.id).status !== "running" ? (m.get(r.id) as Run) : null));
    const note = path.join(v, "Agentic", path.basename(fs.realpathSync(proj)), "Decisiones.md");
    expect(fs.readFileSync(note, "utf8")).toContain("Usar PolyForm");
    const evs = m.readLog(r.id, 0).events as { type: string; message?: { content?: { name?: string; input?: { file_path?: string } }[] } }[];
    expect(evs.some((e) => e.message?.content?.some((b) => b.name === "Write" && b.input?.file_path === note))).toBe(true);
  });
});
