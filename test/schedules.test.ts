import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createContext } from "@/lib/server/context";
import { describeWhen, nextRun } from "@/lib/server/schedules";
import { FAKE_CLAUDE, tmpDir, waitFor } from "./helpers";

function setup(maxConcurrentRuns = 2) {
  const project = fs.realpathSync(tmpDir("proj-"));
  const c = createContext({ dataDir: tmpDir(), claudeHome: tmpDir(), claudeBin: FAKE_CLAUDE, maxConcurrentRuns, maxLogBytes: 1e6 });
  c.projects.create({ path: project, name: "demo" });
  return { c, project };
}
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);

describe("schedules", () => {
  it("computes the next slot for daily and interval schedules", () => {
    const weekdays = { kind: "daily" as const, time: "09:00", days: [1, 2, 3, 4, 5] };
    // 2026-11-06 is a Friday.
    expect(nextRun(weekdays, at(2026, 11, 6, 8, 0))).toEqual(at(2026, 11, 6, 9, 0));
    expect(nextRun(weekdays, at(2026, 11, 6, 9, 0))).toEqual(at(2026, 11, 9, 9, 0)); // → Monday
    expect(nextRun({ kind: "interval", hours: 4 }, at(2026, 11, 6, 10, 30), at(2026, 11, 6, 0, 0))).toEqual(at(2026, 11, 6, 12, 0));
    expect(describeWhen(weekdays)).toBe("Lunes a viernes a las 09:00");
    expect(describeWhen({ kind: "daily", time: "18:30", days: [0, 6] })).toBe("Fines de semana a las 18:30");
  });

  it("fires due schedules once, then moves to the next slot", async () => {
    const { c, project } = setup();
    const t0 = at(2026, 11, 6, 8, 0);
    const s = c.schedules.create({ name: "Revisar PRs", projectPath: project, prompt: "revisa", when: { kind: "daily", time: "09:00", days: [5] } }, t0);
    expect(s.nextRunAt).toBe(at(2026, 11, 6, 9, 0).toISOString());
    expect(await c.schedules.tick(at(2026, 11, 6, 8, 59))).toEqual([]);
    expect(await c.schedules.tick(at(2026, 11, 6, 9, 0, ))).toEqual([s.id]);
    const after = c.schedules.get(s.id);
    expect(after.lastRunId).toBeTruthy();
    expect(after.nextRunAt).toBe(at(2026, 11, 13, 9, 0).toISOString());
    expect(c.runs.get(after.lastRunId!).prompt).toBe("revisa");
    await waitFor(() => c.runs.get(after.lastRunId!).status !== "running");
    expect(await c.schedules.tick(at(2026, 11, 6, 9, 1))).toEqual([]);
  });

  it("skips runs missed long ago and never allows bypassPermissions", async () => {
    const { c, project } = setup();
    const s = c.schedules.create({ name: "x", projectPath: project, prompt: "p", when: { kind: "interval", hours: 1 } }, at(2026, 11, 1));
    expect(await c.schedules.tick(at(2026, 11, 2))).toEqual([]);
    expect(c.schedules.get(s.id).lastError).toMatch(/cerrada/);
    expect(new Date(c.schedules.get(s.id).nextRunAt!).getTime()).toBeGreaterThan(at(2026, 11, 2).getTime());
    expect(() => c.schedules.create({ name: "y", projectPath: project, prompt: "p", when: { kind: "interval", hours: 1 }, permissionMode: "bypassPermissions" })).toThrow();
    expect(() => c.schedules.create({ name: "y", projectPath: "/etc", prompt: "p", when: { kind: "interval", hours: 1 } })).toThrow(/desconocido/);
  });

  it("disabling clears the next run; manual run keeps the slot", async () => {
    const { c, project } = setup();
    const s = c.schedules.create({ name: "x", projectPath: project, prompt: "p", when: { kind: "interval", hours: 2 } });
    expect(c.schedules.update(s.id, { enabled: false }).nextRunAt).toBeNull();
    const fired = await c.schedules.fire(s.id);
    expect(fired.lastRunId).toBeTruthy();
    expect(fired.nextRunAt).toBeNull();
    await waitFor(() => c.runs.get(fired.lastRunId!).status !== "running");
  });
});
