import { describe, expect, it } from "vitest";
import { ReplyQueue } from "@/lib/server/reply-queue";
import { RunManager, type Run } from "@/lib/server/runs";
import { JsonStore } from "@/lib/server/store";
import { FAKE_CLAUDE, tmpDir, waitFor } from "./helpers";

function setup() {
  const dataDir = tmpDir();
  const store = new JsonStore(dataDir);
  const holder: { q?: ReplyQueue } = {};
  const m = new RunManager(store, { dataDir, claudeBin: FAKE_CLAUDE, maxConcurrent: 3, maxLogBytes: 1024 * 1024, onFinished: (r) => void holder.q?.onRunFinished(r).catch(() => {}) });
  holder.q = new ReplyQueue(store, m);
  return { m, q: holder.q, proj: tmpDir() };
}
const idle = (m: RunManager, id: string) => waitFor(() => (m.get(id).status !== "running" ? m.get(id) : null)) as Promise<Run>;
const threadLen = (m: RunManager, id: string) => m.thread(id).length;

describe("messages queued while Claude works", () => {
  it("waits, then sends in order when the turn finishes", async () => {
    const { m, q, proj } = setup();
    const first = await m.start({ projectPath: proj, prompt: "SLOW primero" });
    await waitFor(() => (m.get(first.id).sessionId ? true : null)); // replies need the session
    const a = await q.add(first.id, { prompt: "segundo mensaje" });
    const b = await q.add(first.id, { prompt: "tercer mensaje" });
    expect(a.started).toBeUndefined();
    expect(b.queue.map((x) => x.prompt)).toEqual(["segundo mensaje", "tercer mensaje"]);
    expect(threadLen(m, first.id)).toBe(1); // nothing was sent yet
    await waitFor(() => (threadLen(m, first.id) === 3 && m.thread(first.id).every((r) => r.status !== "running") ? true : null), 15000);
    expect(m.thread(first.id).map((r) => r.prompt)).toEqual(["SLOW primero", "segundo mensaje", "tercer mensaje"]);
    expect(q.list(first.id)).toEqual([]);
  });

  it("sends at once when Claude is idle", async () => {
    const { m, q, proj } = setup();
    const first = await m.start({ projectPath: proj, prompt: "hola" });
    await idle(m, first.id);
    const r = await q.add(first.id, { prompt: "ahora" });
    expect(r.started?.prompt).toBe("ahora");
    expect(r.queue).toEqual([]);
  });

  it("pauses after a stop: nothing is sent by itself, and 'send now' or removing is up to you", async () => {
    const { m, q, proj } = setup();
    const first = await m.start({ projectPath: proj, prompt: "SLOW SLEEP" });
    await waitFor(() => (m.get(first.id).sessionId ? true : null));
    const { queue } = await q.add(first.id, { prompt: "pendiente" });
    await q.add(first.id, { prompt: "otro" });
    await m.stop(first.id);
    await idle(m, first.id);
    await new Promise((r) => setTimeout(r, 400));
    expect(threadLen(m, first.id)).toBe(1);
    expect(q.list(first.id)).toHaveLength(2);
    expect(q.remove(first.id, queue[0].id).map((x) => x.prompt)).toEqual(["otro"]);
    const sent = await q.sendNext(first.id);
    expect(sent.started?.prompt).toBe("otro");
    expect(sent.queue).toEqual([]);
  });

  it("validates: no bypassPermissions, no empty messages, a limit per conversation", async () => {
    const { m, q, proj } = setup();
    const first = await m.start({ projectPath: proj, prompt: "SLOW SLEEP" });
    await waitFor(() => (m.get(first.id).sessionId ? true : null));
    await expect(q.add(first.id, { prompt: "x", permissionMode: "bypassPermissions" })).rejects.toThrow();
    await expect(q.add(first.id, { prompt: "   " })).rejects.toThrow(/vacío/);
    for (let i = 0; i < 10; i++) await q.add(first.id, { prompt: `m${i}` });
    await expect(q.add(first.id, { prompt: "once" })).rejects.toThrow(/Máximo/);
    await m.stop(first.id);
  });
});
