import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createContext } from "@/lib/server/context";
import { FAKE_CLAUDE, tmpDir, waitFor } from "./helpers";

describe("headless conversations", () => {
  it("a reply continues the same thread: same project, resuming the latest session", async () => {
    const project = fs.realpathSync(tmpDir("proj-"));
    const c = createContext({ dataDir: tmpDir(), claudeHome: tmpDir(), claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 3, maxLogBytes: 1e6 });
    c.projects.create({ path: project, name: "demo" });

    const first = await c.runs.start({ projectPath: project, prompt: "primero" });
    expect(first.threadId).toBeNull();
    // Not while Claude is still working.
    await expect(c.runs.start({ projectPath: project, prompt: "ya", continueRunId: first.id })).rejects.toThrow(/sigue trabajando/);
    await waitFor(() => c.runs.get(first.id).status !== "running");

    const second = await c.runs.start({ projectPath: project, prompt: "segundo", continueRunId: first.id, permissionMode: "acceptEdits" });
    expect(second.threadId).toBe(first.id);
    expect(second.projectPath).toBe(project);
    expect(second.resumeSessionId).toBe(c.runs.get(first.id).sessionId);
    await waitFor(() => c.runs.get(second.id).status !== "running");

    // Replying from any run of the thread continues from the latest one.
    const third = await c.runs.start({ projectPath: project, prompt: "tercero", continueRunId: first.id });
    expect(third.threadId).toBe(first.id);
    expect(third.resumeSessionId).toBe(c.runs.get(second.id).sessionId);
    await waitFor(() => c.runs.get(third.id).status !== "running");

    expect(c.runs.thread(second.id).map((r) => r.prompt)).toEqual(["primero", "segundo", "tercero"]);
    // Other runs are not part of it.
    const other = await c.runs.start({ projectPath: project, prompt: "otra" });
    expect(c.runs.thread(other.id)).toHaveLength(1);
    await waitFor(() => c.runs.get(other.id).status !== "running");
    c.runs.shutdown();
  });
});
