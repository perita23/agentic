import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RunManager, type Run } from "@/lib/server/runs";
import type { FileChange } from "@/lib/server/run-changes";
import { JsonStore } from "@/lib/server/store";
import { FAKE_CLAUDE, tmpDir, waitFor } from "./helpers";

const sh = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, encoding: "utf8" });

describe("changes made through the terminal show up in the log, where they happened", () => {
  it("emits file_changes after a Bash result (with the diff), and stays silent after an Edit result", async () => {
    const dataDir = tmpDir();
    const m = new RunManager(new JsonStore(dataDir), { dataDir, claudeBin: FAKE_CLAUDE, maxConcurrent: 2, maxLogBytes: 1024 * 1024 });
    const proj = tmpDir();
    sh(proj, "init", "-q", "-b", "main");
    fs.writeFileSync(path.join(proj, "tracked.txt"), "uno\n");
    sh(proj, "add", ".");
    sh(proj, "commit", "-q", "-m", "init");
    const r = await m.start({ projectPath: proj, prompt: "BASHCHANGE" });
    await waitFor(() => (m.get(r.id).status !== "running" ? m.get(r.id) : null));
    const events = m.readLog(r.id, 0).events as { type: string; subtype?: string; after?: string; files?: FileChange[] }[];
    const changes = events.filter((e) => e.subtype === "file_changes");
    expect(changes).toHaveLength(1); // the Edit tool result adds nothing: the chat shows Edit exactly from its input
    expect(changes[0].after).toBe("bc1");
    const files = changes[0].files!;
    const tracked = files.find((f) => f.path === "tracked.txt")!;
    expect(tracked).toMatchObject({ status: "edited", add: 1, del: 0 });
    expect(tracked.patch).toContain("+línea nueva por terminal");
    const created = files.find((f) => f.path === "hecho-por-terminal.txt")!;
    expect(created).toMatchObject({ status: "created", add: 1 });
    expect(created.patch).toContain("+contenido nuevo");
    // the change event sits right after the Bash result in the log, before the Edit call
    const order = events.map((e) => (e.subtype === "file_changes" ? "C" : e.type === "assistant" ? "a" : e.type === "user" ? "u" : "")).join("");
    expect(order.indexOf("C")).toBeGreaterThan(order.indexOf("u"));
  });

  it("does nothing outside git", async () => {
    const dataDir = tmpDir();
    const m = new RunManager(new JsonStore(dataDir), { dataDir, claudeBin: FAKE_CLAUDE, maxConcurrent: 2, maxLogBytes: 1024 * 1024 });
    const r: Run = await m.start({ projectPath: tmpDir(), prompt: "BASHCHANGE" });
    await waitFor(() => (m.get(r.id).status !== "running" ? m.get(r.id) : null));
    expect((m.readLog(r.id, 0).events as { subtype?: string }[]).some((e) => e.subtype === "file_changes")).toBe(false);
  });
});
