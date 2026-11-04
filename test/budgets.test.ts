import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createContext } from "@/lib/server/context";
import { FAKE_CLAUDE, tmpDir, waitFor } from "./helpers";

function setup() {
  const project = fs.realpathSync(tmpDir("proj-"));
  const c = createContext({ dataDir: tmpDir(), claudeHome: tmpDir(), claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 2, maxLogBytes: 1e6 });
  c.projects.create({ path: project, name: "demo" });
  const sent: string[] = [];
  // Capture alerts instead of posting to Slack.
  (c.budgets as unknown as { notify: (t: string) => void }).notify = (t: string) => void sent.push(t);
  return { c, project, sent };
}

async function spend(c: ReturnType<typeof setup>["c"], project: string) {
  const run = await c.runs.start({ projectPath: project, prompt: "gasta" });
  await waitFor(() => c.runs.get(run.id).status !== "running");
  return c.runs.get(run.id).costUsd ?? 0;
}

describe("budgets", () => {
  it("measures run spend against limits and alerts once per level and period", async () => {
    const { c, project, sent } = setup();
    const cost = await spend(c, project);
    expect(cost).toBeGreaterThan(0);
    c.budgets.setConfig({ runsUsd: { daily: cost / 0.9, monthly: null } });
    let st = await c.budgets.status();
    expect(st.lines).toHaveLength(1);
    expect(st.lines[0]).toMatchObject({ meter: "runsUsd", period: "daily", level: "warn" });
    expect(st.blocked).toBe(false);
    expect(await c.budgets.check()).toHaveLength(1);
    expect(await c.budgets.check()).toHaveLength(0); // once per period
    expect(sent[0]).toMatch(/Cerca del presupuesto/);

    await spend(c, project);
    st = await c.budgets.status();
    expect(st.level).toBe("over");
    expect(st.blocked).toBe(true);
    await c.budgets.check();
    expect(sent[1]).toMatch(/superado.*pausa/);
  });

  it("pauses unattended runs (queue and schedules) while over a USD limit", async () => {
    const { c, project } = setup();
    await spend(c, project);
    c.budgets.setConfig({ runsUsd: { daily: 0.0001, monthly: null } });
    await expect(c.budgets.assertAutomationAllowed()).rejects.toThrow(/Presupuesto superado/);

    const s = c.schedules.create({ name: "x", projectPath: project, prompt: "p", when: { kind: "interval", hours: 1 } }, new Date(Date.now() - 3600_000 - 1000));
    await c.schedules.tick(new Date());
    expect(c.schedules.get(s.id).lastError).toMatch(/Presupuesto/);
    expect(c.schedules.get(s.id).lastRunId).toBeNull();
    // A manual "run now" is still allowed: it is the user's explicit decision.
    expect((await c.schedules.fire(s.id)).lastRunId).toBeTruthy();

    c.budgets.setConfig({ runsUsd: { daily: 0.0001, monthly: null }, blockAutomation: false });
    await expect(c.budgets.assertAutomationAllowed()).resolves.toBeUndefined();
    await waitFor(() => c.runs.list().every((r) => r.status !== "running"));
  });

  it("validates the configuration", () => {
    const { c } = setup();
    expect(() => c.budgets.setConfig({ runsUsd: { daily: -1 } })).toThrow();
    expect(() => c.budgets.setConfig({ warnAt: 2 })).toThrow();
    expect(c.budgets.config()).toMatchObject({ warnAt: 0.8, blockAutomation: true, tokens: { daily: null, monthly: null } });
  });
});
