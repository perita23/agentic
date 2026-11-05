import { describe, expect, it } from "vitest";
import { buildClaudeArgs, RunManager, type Run } from "@/lib/server/runs";
import { liveStats } from "@/lib/live-stats";
import { JsonStore } from "@/lib/server/store";
import { FAKE_CLAUDE, tmpDir, waitFor } from "./helpers";

describe("streamed text", () => {
  it("headless runs ask Claude for partial messages", () => {
    expect(buildClaudeArgs({ mode: "headless", projectPath: "/x", prompt: "hola", permissionMode: "default" })).toContain("--include-partial-messages");
    expect(buildClaudeArgs({ mode: "tmux", projectPath: "/x", prompt: "hola", permissionMode: "default" })).not.toContain("--include-partial-messages");
  });

  it("keeps the text in small batches in the log, and the live status exposes it until the message is complete", async () => {
    const dataDir = tmpDir();
    const m = new RunManager(new JsonStore(dataDir), { dataDir, claudeBin: FAKE_CLAUDE, maxConcurrent: 2, maxLogBytes: 1024 * 1024 });
    const r = await m.start({ projectPath: tmpDir(), prompt: "STREAMTEXT" });
    await waitFor(() => (m.liveStats(r.id).partial.includes("esto se va") ? true : null));
    expect(m.liveStats(r.id).partial.startsWith("Hola, ")).toBe(true);
    await waitFor(() => (m.get(r.id).status !== "running" ? (m.get(r.id) as Run) : null));
    const events = m.readLog(r.id, 0).events as { type: string; subtype?: string; delta?: string }[];
    expect(events.some((e) => e.type === "stream_event")).toBe(false);
    expect(events.filter((e) => e.subtype === "partial").map((e) => e.delta).join("")).toBe("Hola, esto se va escribiendo");
    expect(liveStats(events).partial).toBe(""); // the complete message replaced the pieces
  });
});

import { resultTokens } from "@/lib/server/runs";

describe("resultTokens", () => {
  it("adds input and output tokens of the result's usage", () => {
    expect(resultTokens({ input_tokens: 120, output_tokens: 380, cache_read_input_tokens: 90000 })).toBe(500);
    expect(resultTokens({ output_tokens: 7 })).toBe(7);
  });
  it("is null when there is nothing usable", () => {
    expect(resultTokens(undefined)).toBeNull();
    expect(resultTokens({})).toBeNull();
    expect(resultTokens("x")).toBeNull();
    expect(resultTokens({ input_tokens: "3" })).toBeNull();
  });
});
