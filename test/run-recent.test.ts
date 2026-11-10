import path from "node:path";
import { describe, expect, it } from "vitest";
import { RunManager, type Run } from "@/lib/server/runs";
import { JsonStore } from "@/lib/server/store";
import { collectArtifacts } from "@/lib/session-artifacts";
import { collapseThreads, runTitle } from "@/lib/threads";
import { FAKE_CLAUDE, tmpDir } from "./helpers";

const run = (id: string, startedAt: string, extra: Partial<Run> = {}): Run => ({ id, mode: "headless", projectPath: "/p", prompt: `prompt ${id}\nsegunda línea`, model: null, agent: null, permissionMode: "default", resumeSessionId: null, taskId: null, threadId: null, status: "completed", pid: null, tmuxSession: null, sessionId: null, exitCode: 0, costUsd: null, durationMs: null, numTurns: null, resultText: null, error: null, startedAt, endedAt: startedAt, logBytes: 0, ...extra });

describe("the list of runs by recent use", () => {
  it("shows the name the person gave, else the first line of the prompt", () => {
    expect(runTitle(run("a", "2026-01-01T00:00:00Z"))).toBe("prompt a");
    expect(runTitle(run("a", "2026-01-01T00:00:00Z", { title: "  Arreglo del login " }))).toBe("Arreglo del login");
    expect(runTitle(run("t", "2026-01-01T00:00:00Z", { prompt: "", mode: "tmux" }))).toBe("Sesión interactiva");
  });

  it("puts an old run you open again on top, and a conversation by its latest reply", () => {
    const old = run("old", "2026-01-01T10:00:00Z");
    const recent = run("recent", "2026-03-01T10:00:00Z");
    const list = (rs: Run[]) => collapseThreads(rs).map((r) => r.id);
    expect(list([recent, old])).toEqual(["recent", "old"]);
    expect(list([recent, { ...old, lastOpenedAt: "2026-03-02T09:00:00Z" }])).toEqual(["old", "recent"]);
    const reply = run("reply", "2026-04-01T10:00:00Z", { threadId: "old" });
    expect(list([reply, recent, old])).toEqual(["old", "recent"]);
    expect(collapseThreads([reply, recent, old])[0]).toMatchObject({ id: "old", messages: 2 });
  });

  it("renames a run (an empty name goes back to the prompt) and remembers when it was opened", () => {
    const dataDir = tmpDir("runs-recent-");
    const m = new RunManager(new JsonStore(dataDir), { dataDir, claudeBin: FAKE_CLAUDE, maxConcurrent: 1, maxLogBytes: 1024 });
    const store = (m as unknown as { store: JsonStore }).store;
    store.write("runs", [run("r1", "2026-01-01T10:00:00Z")]);
    expect(m.rename("r1", "  Revisar   el login  ").title).toBe("Revisar el login");
    expect(m.get("r1").title).toBe("Revisar el login");
    expect(m.rename("r1", "   ").title).toBeUndefined();
    expect(m.get("r1").lastOpenedAt).toBeUndefined();
    const t1 = m.touch("r1").lastOpenedAt!;
    expect(Date.parse(t1)).toBeGreaterThan(Date.parse("2026-01-02"));
    expect(m.touch("r1").lastOpenedAt).toBe(t1); // not written again within 30 s
    expect(() => m.rename("nope", "x")).toThrowError(/not found/i);
    expect(path.isAbsolute(dataDir)).toBe(true);
  });
});

const tool = (name: string, input: object, id?: string) => ({ type: "assistant", message: { content: [{ type: "tool_use", id: id ?? name + Math.random(), name, input }] } });

describe("what a session leaves behind", () => {
  it("collects created files, edits, Obsidian notes and artifacts, newest first", () => {
    const events = [
      tool("Write", { file_path: "/p/src/a.ts", content: "x" }),
      tool("Edit", { file_path: "/p/src/a.ts" }),
      tool("Edit", { file_path: "/p/src/b.ts" }),
      tool("Write", { file_path: "/vault/Agentic/p/nota.md", content: "x" }),
      tool("Write", { file_path: "/p/docs/c.md", content: "x" }),
      tool("Artifact", { file_path: "/p/informe.html" }, "ar1"),
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "ar1", content: "Published: https://claude.ai/artifact/abc123 (private)" }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "Mira https://claude.ai/code/artifact/xyz-9" }] } },
    ];
    const a = collectArtifacts(events, "/vault");
    expect(a.created.map((i) => i.label)).toEqual(["c.md", "a.ts"]);
    expect(a.edited.map((i) => i.label)).toEqual(["b.ts"]); // a.ts was created: it is not listed twice
    expect(a.notes).toEqual([{ key: "/vault/Agentic/p/nota.md", label: "nota", detail: "Agentic/p/nota.md", href: `obsidian://open?path=${encodeURIComponent("/vault/Agentic/p/nota.md")}` }]);
    expect(a.artifacts.map((i) => i.href)).toEqual(["https://claude.ai/code/artifact/xyz-9", "https://claude.ai/artifact/abc123"]);
    expect(a.artifacts[1]!.label).toBe("informe");
    // without a connected vault a markdown file in it is just a file
    expect(collectArtifacts([tool("Write", { file_path: "/vault/x.md", content: "" })], null).created).toHaveLength(1);
    expect(collectArtifacts([], null)).toEqual({ artifacts: [], created: [], edited: [], notes: [] });
  });
});
