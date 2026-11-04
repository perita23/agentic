import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RunManager, slimLogEvent, type Run } from "@/lib/server/runs";
import { findUpload } from "@/lib/server/uploads";
import { JsonStore } from "@/lib/server/store";
import { FAKE_CLAUDE, tmpDir, waitFor } from "./helpers";

function mgr(maxLogBytes = 1024 * 1024) {
  const dataDir = tmpDir();
  const m = new RunManager(new JsonStore(dataDir), { dataDir, claudeBin: FAKE_CLAUDE, maxConcurrent: 2, maxLogBytes });
  return { m, dataDir };
}
const done = (m: RunManager, id: string) => waitFor(() => (m.get(id).status !== "running" ? m.get(id) : null)) as Promise<Run>;

describe("big log lines (screenshots)", () => {
  it("moves pictures out of the log, so the line stays small and the stream gets through", async () => {
    const { m, dataDir } = mgr();
    const r = await m.start({ projectPath: tmpDir(), prompt: "BIGIMG mira" });
    await done(m, r.id);
    expect(fs.statSync(m.logFile(r.id)).size).toBeLessThan(60_000);
    const all = m.readLog(r.id, 0).events as { type: string; message?: { content?: { content?: { source?: { type: string; id: string } }[] }[] }; tool_use_result?: unknown }[];
    const result = all.find((e) => e.type === "user")!;
    const src = result.message!.content![0].content![0].source!;
    expect(src.type).toBe("upload");
    expect(findUpload(dataDir, src.id)?.mime).toBe("image/png");
    expect(result.tool_use_result).toBeUndefined();
    expect(all.some((e) => e.type === "result")).toBe(true);
  });

  it("reads a single line bigger than the read window (never stalls)", async () => {
    const { m } = mgr();
    const r = await m.start({ projectPath: tmpDir(), prompt: "hola" });
    await done(m, r.id);
    const before = m.readLog(r.id, 0);
    fs.appendFileSync(m.logFile(r.id), JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "x".repeat(900_000) }] } }) + "\n" + JSON.stringify({ type: "agentic", subtype: "tail" }) + "\n");
    const next = m.readLog(r.id, before.nextOffset); // 256 KB window < the 900 KB line
    expect(next.events).toHaveLength(2);
    expect(next.nextOffset).toBe(fs.statSync(m.logFile(r.id)).size);
    expect(m.tailEvents(r.id, 1024).length).toBeGreaterThan(0); // window widens past the big last line
  });

  it("always records the final result, even after the log cap", async () => {
    const { m } = mgr(1500);
    const r = await m.start({ projectPath: tmpDir(), prompt: "BIGIMG" });
    const end = await done(m, r.id);
    const events = m.readLog(r.id, 0).events as { type: string; subtype?: string }[];
    expect(events.some((e) => e.type === "result")).toBe(true);
    expect(end.status).toBe("completed");
  });

  it("slimLogEvent leaves other events alone and replaces bad images with a note", () => {
    const dir = tmpDir();
    expect(slimLogEvent({ type: "assistant", x: 1 }, dir)).toEqual({ type: "assistant", x: 1 });
    const bad = slimLogEvent({ type: "user", message: { content: [{ type: "tool_result", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from("not an image at all").toString("base64") } }] }] } }, dir) as { message: { content: { content: { type: string }[] }[] } };
    expect(bad.message.content[0].content[0].type).toBe("text");
    expect(fs.existsSync(path.join(dir, "uploads"))).toBe(false);
  });
});
