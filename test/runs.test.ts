import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildClaudeArgs, RunManager, shellQuote, type Run } from "@/lib/server/runs";
import { JsonStore } from "@/lib/server/store";
import { FAKE_CLAUDE, tmpDir, waitFor } from "./helpers";

function mgr(over: Partial<ConstructorParameters<typeof RunManager>[1]> = {}) {
  const dataDir = tmpDir();
  const store = new JsonStore(dataDir);
  const finished: Run[] = [];
  const m = new RunManager(store, { dataDir, claudeBin: FAKE_CLAUDE, maxConcurrent: 2, maxLogBytes: 1024 * 1024, onFinished: (r) => finished.push(r), ...over });
  return { m, store, dataDir, finished };
}
const done = (m: RunManager, id: string): Promise<Run> => waitFor(() => (m.get(id).status !== "running" ? m.get(id) : null)) as Promise<Run>;

describe("buildClaudeArgs", () => {
  it("puts the prompt after -- and only adds set flags", () => {
    const a = buildClaudeArgs({ mode: "headless", projectPath: "/x", prompt: "--dangerously-skip-permissions", permissionMode: "plan", model: "opus" });
    expect(a.slice(0, 4)).toEqual(["-p", "--output-format", "stream-json", "--verbose"]);
    expect(a).toContain("--model");
    expect(a.slice(-2)).toEqual(["--", "--dangerously-skip-permissions"]);
    expect(a.filter((x) => x === "--dangerously-skip-permissions")).toHaveLength(1);
    const t = buildClaudeArgs({ mode: "tmux", projectPath: "/x", prompt: "", permissionMode: "default" });
    expect(t).toEqual([]);
  });
  it("shellQuote is display-safe", () => {
    expect(shellQuote(["claude", "it's $(rm -rf /)"])).toBe(`claude 'it'\\''s $(rm -rf /)'`);
  });
});

describe("RunManager", () => {
  it("runs claude headless, parses session id, cost and result", async () => {
    const { m, finished } = mgr();
    const proj = tmpDir();
    const r = await m.start({ projectPath: proj, prompt: "hola", model: "sonnet" });
    expect(r.status).toBe("running");
    const end = await done(m, r.id);
    expect(end).toMatchObject({ status: "completed", exitCode: 0, sessionId: "11111111-2222-4333-8444-555555555555", costUsd: 0.0123, resultText: "done: hola" });
    expect(finished).toHaveLength(1);
    const log = m.readLog(r.id, 0);
    expect(log.events.some((e) => e.type === "stderr")).toBe(true);
    const assistant = log.events.find((e) => e.type === "assistant");
    const echoed = JSON.parse(assistant.message.content[0].text);
    expect(fs.realpathSync(echoed.cwd)).toBe(fs.realpathSync(proj));
    expect(echoed.args).toContain("sonnet");
    // incremental reads
    const again = m.readLog(r.id, log.nextOffset);
    expect(again.events).toEqual([]);
  });

  it("never interprets shell metacharacters in the prompt", async () => {
    const { m } = mgr();
    const proj = tmpDir();
    const marker = path.join(proj, "pwned");
    const r = await m.start({ projectPath: proj, prompt: `$(touch ${marker}); touch ${marker} \`touch ${marker}\`` });
    await done(m, r.id);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("marks failures and keeps the error", async () => {
    const { m } = mgr();
    const r = await m.start({ projectPath: tmpDir(), prompt: "FAIL please" });
    const end = await done(m, r.id);
    expect(end.status).toBe("failed");
    expect(end.exitCode).toBe(2);
    expect(end.error).toBe("boom");
  });

  it("stops a long run and enforces the concurrency limit", async () => {
    const { m } = mgr();
    const a = await m.start({ projectPath: tmpDir(), prompt: "SLEEP" });
    await m.start({ projectPath: tmpDir(), prompt: "SLEEP" });
    await expect(m.start({ projectPath: tmpDir(), prompt: "x" })).rejects.toMatchObject({ status: 429 });
    await m.stop(a.id);
    const end = await done(m, a.id);
    expect(end.status).toBe("stopped");
    m.shutdown();
  });

  it("caps the log size", async () => {
    const { m } = mgr({ maxLogBytes: 20_000 });
    const r = await m.start({ projectPath: tmpDir(), prompt: "NOISE" });
    await done(m, r.id);
    expect(fs.statSync(m.logFile(r.id)).size).toBeLessThan(21_000);
    expect(m.readLog(r.id).events.some((e) => e.subtype === "log_truncated")).toBe(true);
  });

  it("validates input", async () => {
    const { m } = mgr();
    await expect(m.start({ projectPath: "/definitely/not/here", prompt: "x" })).rejects.toMatchObject({ status: 400 });
    await expect(m.start({ projectPath: "relative", prompt: "x" })).rejects.toMatchObject({ status: 400 });
    await expect(m.start({ projectPath: tmpDir(), prompt: "" })).rejects.toMatchObject({ status: 400 });
    await expect(m.start({ projectPath: tmpDir(), prompt: "x", model: "--evil flag" })).rejects.toMatchObject({ status: 400 });
    await expect(m.start({ projectPath: tmpDir(), prompt: "x", permissionMode: "yolo" })).rejects.toMatchObject({ status: 400 });
    await expect(m.start({ projectPath: tmpDir(), prompt: "x", resumeSessionId: "../../x" })).rejects.toMatchObject({ status: 400 });
    expect(() => m.readLog("../../etc/passwd")).toThrow();
  });

  it("reports a missing claude binary as a failed run", async () => {
    const { m } = mgr({ claudeBin: "/nonexistent/claude-bin" });
    const r = await m.start({ projectPath: tmpDir(), prompt: "x" });
    const end = await done(m, r.id);
    expect(end.status).toBe("failed");
    expect(end.error).toMatch(/No se pudo ejecutar/);
  });

  it("marks running headless runs as interrupted after a restart", () => {
    const { store, dataDir } = mgr();
    store.write("runs", [{ id: "11111111-1111-4111-8111-111111111111", mode: "headless", status: "running", startedAt: "2026-01-01" }]);
    const m2 = new RunManager(new JsonStore(dataDir), { dataDir, claudeBin: FAKE_CLAUDE, maxConcurrent: 1, maxLogBytes: 1e6 });
    expect(m2.list()[0].status).toBe("interrupted");
  });
});
