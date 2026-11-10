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

describe("the answer so far", () => {
  it("is every finished text message of the turn plus the one being written, in order, each once", () => {
    const text = (id: string, t: string) => ({ type: "assistant", message: { id, content: [{ type: "text", text: t }] } });
    const delta = (d: string) => ({ type: "agentic", subtype: "partial", delta: d });
    expect(liveStats([delta("Voy a ")]).answer).toBe("Voy a ");
    expect(liveStats([delta("Voy a revisar."), text("m1", "Voy a revisar.")]).answer).toBe("Voy a revisar.");
    // the same message arriving twice (growing usage) is counted once
    expect(liveStats([text("m1", "Voy a revisar."), text("m1", "Voy a revisar.")]).answer).toBe("Voy a revisar.");
    const events = [text("m1", "Voy a revisar."), { type: "assistant", message: { id: "m2", content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] } }, delta("Ya lo he "), ];
    expect(liveStats(events).answer).toBe("Voy a revisar.\nYa lo he ");
    expect(liveStats([...events, text("m3", "Ya lo he visto.")]).answer).toBe("Voy a revisar.\nYa lo he visto.");
  });
});

describe("while a subagent works", () => {
  it("the status line, the tokens and the context are the main Claude's, not the subagent's", () => {
    const main = asst("m1", 7, [{ type: "tool_use", id: "ag1", name: "Agent", input: { description: "Investigar DST" } }]);
    const sub = { type: "assistant", parent_tool_use_id: "ag1", message: { id: "s1", usage: { input_tokens: 5, cache_read_input_tokens: 14_000, output_tokens: 500 }, content: [{ type: "tool_use", id: "w1", name: "WebFetch", input: { url: "https://x.dev" } }] } };
    const s = liveStats([main, sub]);
    expect(s.tool?.name).toBe("Agent");
    expect(s.outputTokens).toBe(7);
    expect(s.contextTokens).toBe(100);
  });
});
