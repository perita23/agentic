import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SessionIndex } from "@/lib/server/sessions";
import { jsonl, tmpDir } from "./helpers";

const today = new Date().toISOString();
const yesterday = new Date(Date.now() - 86_400_000).toISOString();
const longAgo = new Date(Date.now() - 400 * 86_400_000).toISOString();

const assistant = (ts: string, model: string, input: number, output: number, tool?: string) => ({
  type: "assistant",
  timestamp: ts,
  message: { model, usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 10 }, content: tool ? [{ type: "tool_use", name: tool, input: {} }] : [{ type: "text", text: "ok" }] },
});

function home() {
  const h = tmpDir("claude-an-");
  const mk = (proj: string, id: string, lines: unknown[]) => {
    const dir = path.join(h, "projects", proj.replace(/\//g, "-"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.jsonl`), jsonl(lines));
    return path.join(dir, `${id}.jsonl`);
  };
  mk("/p/a", "aaaaaaaa-0000-4000-8000-000000000001", [
    { type: "user", cwd: "/p/a", timestamp: yesterday, message: { content: "hola" } },
    assistant(yesterday, "model-x", 100, 50, "Read"),
    assistant(today, "model-x", 10, 5, "Edit"),
  ]);
  mk("/p/b", "bbbbbbbb-0000-4000-8000-000000000002", [{ type: "user", cwd: "/p/b", timestamp: today, message: { content: "hey" } }, assistant(today, "model-y", 1, 1)]);
  const old = mk("/p/c", "cccccccc-0000-4000-8000-000000000003", [{ type: "user", cwd: "/p/c", timestamp: longAgo, message: { content: "old" } }, assistant(longAgo, "model-z", 999, 999)]);
  const t = new Date(longAgo);
  fs.utimesSync(old, t, t);
  return h;
}

describe("SessionIndex.analytics", () => {
  it("aggregates tokens per day, project, model and tool inside the window", async () => {
    const idx = new SessionIndex(home());
    const a = await idx.analytics(7);
    expect(a.days).toHaveLength(7);
    expect(a.days.at(-1)!.date).toBe(today.slice(0, 10));
    expect(a.days.at(-1)).toMatchObject({ input: 11, output: 6, sessions: 2 });
    expect(a.days.at(-2)).toMatchObject({ input: 100, output: 50, messages: 2, sessions: 1 });
    expect(a.totals).toMatchObject({ input: 111, output: 56, cacheRead: 30, sessions: 2 });
    expect(a.byProject.map((p) => p.path)).toEqual(["/p/a", "/p/b"]);
    expect(a.byModel.map((m) => m.model)).toEqual(["model-x", "model-y"]);
    expect(a.tools).toEqual([
      { name: "Read", count: 1 },
      { name: "Edit", count: 1 },
    ].sort((x, y) => y.count - x.count));
  });

  it("filters by project and refreshes when a transcript grows", async () => {
    const h = home();
    const idx = new SessionIndex(h);
    expect((await idx.analytics(7, "/p/b")).totals.output).toBe(1);
    const f = path.join(h, "projects", "-p-b", "bbbbbbbb-0000-4000-8000-000000000002.jsonl");
    fs.appendFileSync(f, JSON.stringify(assistant(today, "model-y", 0, 40)) + "\n");
    expect((await idx.analytics(7, "/p/b")).totals.output).toBe(41);
  });
});
