import { describe, expect, it } from "vitest";
import { createContext, type Context } from "@/lib/server/context";
import { FAKE_CLAUDE, tmpDir, waitFor } from "./helpers";

function ctx(dataDir = tmpDir()): Context {
  return createContext({ dataDir, claudeHome: tmpDir(), claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 2, maxLogBytes: 1e6 });
}
const settled = (c: Context) => waitFor(() => !c.queue.state().running, 20_000);

describe("TaskQueue", () => {
  it("runs To do tasks one at a time by priority and moves them to review", async () => {
    const c = ctx();
    const proj = tmpDir();
    const low = c.tasks.create({ title: "low", priority: "low", projectPath: proj, prompt: "low task" });
    const urgent = c.tasks.create({ title: "urgent", priority: "urgent", projectPath: proj, prompt: "urgent task" });
    c.tasks.create({ title: "no project", priority: "urgent" });
    c.tasks.create({ title: "backlog", status: "backlog", projectPath: proj });
    await c.queue.start({});
    expect(c.queue.state().running).toBe(true);
    await settled(c);
    const s = c.queue.state();
    expect(s.processed.map((p) => p.taskId)).toEqual([urgent.id, low.id]);
    expect(s.processed.every((p) => p.status === "completed")).toBe(true);
    expect(s.stopReason).toBe("No quedan tareas pendientes");
    expect(c.tasks.get(urgent.id).status).toBe("review");
    // never more than one run at a time
    const runs = c.runs.list().sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
    expect(runs[1].startedAt >= runs[0].endedAt!).toBe(true);
    c.runs.shutdown();
  });

  it("respects the batch limit and permission settings", async () => {
    const c = ctx();
    const proj = tmpDir();
    for (let i = 0; i < 3; i++) c.tasks.create({ title: `t${i}`, projectPath: proj, prompt: "go" });
    await c.queue.start({ limit: 2, permissionMode: "plan" });
    await settled(c);
    expect(c.queue.state().processed).toHaveLength(2);
    expect(c.queue.state().stopReason).toMatch(/Límite de 2/);
    expect(c.runs.list().every((r) => r.permissionMode === "plan")).toBe(true);
  });

  it("stops on the first failure by default", async () => {
    const c = ctx();
    const proj = tmpDir();
    c.tasks.create({ title: "bad", priority: "urgent", projectPath: proj, prompt: "FAIL now" });
    c.tasks.create({ title: "good", projectPath: proj, prompt: "fine" });
    await c.queue.start({});
    await settled(c);
    expect(c.queue.state().processed).toHaveLength(1);
    expect(c.queue.state().stopReason).toMatch(/falló/);
  });

  it("can continue after failures when asked, and be stopped manually", async () => {
    const c = ctx();
    const proj = tmpDir();
    c.tasks.create({ title: "bad", priority: "urgent", projectPath: proj, prompt: "FAIL now" });
    c.tasks.create({ title: "slow", projectPath: proj, prompt: "SLEEP" });
    await c.queue.start({ stopOnFailure: false });
    await waitFor(() => c.queue.state().processed.length === 2);
    c.queue.stop();
    expect(c.queue.state()).toMatchObject({ running: false, stopReason: "Detenida por el usuario" });
    c.runs.shutdown();
  });

  it("validates input, refuses double start and never resumes after a restart", async () => {
    const dataDir = tmpDir();
    const c = ctx(dataDir);
    await expect(c.queue.start({})).rejects.toMatchObject({ status: 400 });
    await expect(c.queue.start({ limit: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(c.queue.start({ permissionMode: "yolo" })).rejects.toMatchObject({ status: 400 });
    await expect(c.queue.start({ permissionMode: "bypassPermissions" })).rejects.toMatchObject({ status: 400 });
    c.tasks.create({ title: "slow", projectPath: tmpDir(), prompt: "SLEEP" });
    await c.queue.start({});
    await expect(c.queue.start({})).rejects.toMatchObject({ status: 409 });
    const restarted = ctx(dataDir);
    expect(restarted.queue.state()).toMatchObject({ running: false });
    expect(restarted.queue.state().stopReason).toMatch(/reinició/);
    c.runs.shutdown();
  });
});
