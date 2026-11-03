import { describe, expect, it } from "vitest";
import { SessionIndex } from "@/lib/server/sessions";
import { makeClaudeHome } from "./helpers";

describe("SessionIndex", () => {
  const cwd = "/home/me/proj";
  const { home, live, old } = makeClaudeHome(cwd);
  const idx = new SessionIndex(home);

  it("lists sessions newest first with metadata from the transcript", () => {
    const list = idx.list();
    expect(list.map((s) => s.id)).toEqual([live, old]);
    const s = list[0];
    expect(s.cwd).toBe(cwd);
    expect(s.gitBranch).toBe("main");
    expect(s.model).toBe("claude-test-1");
    expect(s.firstPrompt).toBe("Arregla el login\nsegunda línea");
    expect(s.title).toBe("Arregla el login");
    expect(s.active).toBe(true);
    expect(s.status).toBe("busy");
    expect(list[1].title).toBe("Sesión antigua");
    expect(list[1].active).toBe(false); // pid 999999 is dead
  });

  it("only reports live processes and skips garbage files", () => {
    const a = idx.active();
    expect(a).toHaveLength(1);
    expect(a[0].sessionId).toBe(live);
  });

  it("builds a transcript with usage, tools and without sidechains/tool results", async () => {
    const t = await idx.transcript(live);
    expect(t).not.toBeNull();
    expect(t!.messages.map((m) => m.role)).toEqual(["user", "assistant", "assistant"]);
    expect(t!.usage).toEqual({ input: 11, output: 7, cacheRead: 100, cacheWrite: 0 });
    expect(t!.tools).toEqual({ Read: 1 });
    expect(t!.messages.some((m) => m.text.includes("sidechain"))).toBe(false);
  });

  it("rejects ids that are not UUIDs (path traversal)", async () => {
    expect(idx.findFile("../../etc/passwd")).toBeNull();
    expect(await idx.transcript("..%2f..%2fx")).toBeNull();
  });

  it("copes with a missing claude home", () => {
    const empty = new SessionIndex("/nonexistent/claude");
    expect(empty.list()).toEqual([]);
    expect(empty.active()).toEqual([]);
  });
});
