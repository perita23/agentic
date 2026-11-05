import { describe, expect, it } from "vitest";
import { compactTokens, formatElapsed, liveStats } from "@/lib/live-stats";

const asst = (id: string, out: number, content: object[], extra: object = {}) => ({ type: "assistant", message: { id, usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: out, ...extra }, content } });

describe("liveStats", () => {
  it("counts each message's output tokens once, even when it arrives in several events", () => {
    const s = liveStats([asst("m1", 20, [{ type: "text", text: "a" }]), asst("m1", 35, [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }]), asst("m2", 5, [{ type: "text", text: "b" }])]);
    expect(s.outputTokens).toBe(40);
    expect(s.contextTokens).toBe(100);
  });
  it("knows the tool in flight until its result arrives", () => {
    const call = asst("m1", 1, [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "docker logs api" } }]);
    expect(liveStats([call]).tool).toMatchObject({ name: "Bash" });
    expect(liveStats([call, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1" }] } }]).tool).toBeNull();
  });
  it("keeps the tail of the reasoning until text or a tool replaces it", () => {
    expect(liveStats([asst("m1", 1, [{ type: "thinking", thinking: "x".repeat(900) }])]).thinking).toHaveLength(400);
    expect(liveStats([asst("m1", 1, [{ type: "thinking", thinking: "pienso" }]), asst("m2", 1, [{ type: "text", text: "hola" }])]).thinking).toBe("");
  });
  it("ignores garbage", () => {
    expect(liveStats([null, 3, { type: "assistant" }, { type: "assistant", message: {} }])).toMatchObject({ outputTokens: 0, tool: null });
  });
});

describe("formatting", () => {
  it("compacts tokens and elapsed time", () => {
    expect(["999", "1,2k", "48k", "1,0k"]).toEqual([compactTokens(999), compactTokens(1234), compactTokens(48200), compactTokens(1000)]);
    expect([formatElapsed(4200), formatElapsed(65_000)]).toEqual(["4 s", "1 min 05 s"]);
  });
});
