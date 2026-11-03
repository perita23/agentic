import { describe, expect, it } from "vitest";
import { RunManager } from "@/lib/server/runs";
import { JsonStore } from "@/lib/server/store";
import { FAKE_CLAUDE, tmpDir, waitFor } from "./helpers";

function mgr() {
  const dataDir = tmpDir();
  return new RunManager(new JsonStore(dataDir), { dataDir, claudeBin: FAKE_CLAUDE, maxConcurrent: 2, maxLogBytes: 1e6 });
}

async function readAll(stream: ReadableStream<Uint8Array>, timeoutMs = 10_000) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error("stream did not end");
    const { done, value } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
  }
  return text;
}

/** Minimal SSE parser: returns { event, id, data } for each block. */
function parse(text: string) {
  return text
    .split("\n\n")
    .filter((b) => b.trim() && !b.startsWith(":"))
    .map((b) => {
      const out: { event: string; id?: number; data?: unknown } = { event: "message" };
      for (const line of b.split("\n")) {
        const [k, ...rest] = line.split(": ");
        const v = rest.join(": ");
        if (k === "event") out.event = v;
        if (k === "id") out.id = Number(v);
        if (k === "data") out.data = JSON.parse(v);
      }
      return out;
    });
}

describe("RunManager.streamLog (SSE)", () => {
  it("streams every log line, carries byte offsets as ids and ends when the run is over", async () => {
    const m = mgr();
    const r = await m.start({ projectPath: tmpDir(), prompt: "hola" });
    const events = parse(await readAll(m.streamLog(r.id, 0, new AbortController().signal, { pollMs: 20 })));
    const msgs = events.filter((e) => e.event === "message");
    expect(msgs.map((e) => (e.data as { type: string }).type)).toEqual(expect.arrayContaining(["agentic", "system", "assistant", "result"]));
    expect(events.at(-1)).toMatchObject({ event: "end", data: { status: "completed" } });
    const ids = events.filter((e) => e.id !== undefined).map((e) => e.id!);
    expect(ids.length).toBeGreaterThan(0);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    // Same content as the polling API.
    expect(msgs.length).toBe(m.readLog(r.id, 0).events.length);
  });

  it("resumes from an offset without duplicating lines", async () => {
    const m = mgr();
    const r = await m.start({ projectPath: tmpDir(), prompt: "hola" });
    await waitFor(() => m.get(r.id).status !== "running");
    const full = m.readLog(r.id, 0);
    const half = m.readLog(r.id, 0, 200); // first chunk only
    const rest = parse(await readAll(m.streamLog(r.id, half.nextOffset, new AbortController().signal, { pollMs: 20 }))).filter((e) => e.event === "message");
    expect(half.events.length + rest.length).toBe(full.events.length);
  });

  it("stops when the client disconnects and 404s for unknown runs", async () => {
    const m = mgr();
    const r = await m.start({ projectPath: tmpDir(), prompt: "SLEEP" });
    const ac = new AbortController();
    const p = readAll(m.streamLog(r.id, 0, ac.signal, { pollMs: 20 }));
    setTimeout(() => ac.abort(), 200);
    const text = await p; // resolves because the stream closes
    expect(text).toContain(": connected");
    expect(() => m.streamLog("11111111-1111-4111-8111-111111111111", 0, ac.signal)).toThrow(/not found/i);
    m.shutdown();
  });
});
