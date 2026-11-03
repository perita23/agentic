import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function tmpDir(prefix = "agentic-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export const FAKE_CLAUDE = path.resolve(__dirname, "fixtures/fake-claude.mjs");

export function jsonl(lines: unknown[]) {
  return lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n";
}

/** Build a fake ~/.claude with one project and two sessions (one live). */
export function makeClaudeHome(projectCwd: string) {
  const home = tmpDir("claude-home-");
  const dir = path.join(home, "projects", projectCwd.replace(/\//g, "-"));
  fs.mkdirSync(dir, { recursive: true });
  const live = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const old = "00000000-1111-4222-8333-444444444444";
  fs.writeFileSync(
    path.join(dir, `${live}.jsonl`),
    jsonl([
      { type: "queue-operation", operation: "enqueue" },
      { type: "user", cwd: projectCwd, gitBranch: "main", version: "2.1.0", timestamp: "2026-01-01T10:00:00.000Z", message: { role: "user", content: "<command-name>/clear</command-name>" } },
      { type: "user", cwd: projectCwd, timestamp: "2026-01-01T10:00:01.000Z", message: { role: "user", content: "Arregla el login\nsegunda línea" } },
      "{not json",
      {
        type: "assistant",
        timestamp: "2026-01-01T10:00:02.000Z",
        message: {
          model: "claude-test-1",
          content: [{ type: "text", text: "Voy a mirar" }, { type: "tool_use", name: "Read", input: { file_path: "/x" } }],
          usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 },
        },
      },
      { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "file" }] } },
      { type: "assistant", isSidechain: true, message: { content: [{ type: "text", text: "sidechain" }], usage: { output_tokens: 999 } } },
      { type: "assistant", message: { content: [{ type: "text", text: "Hecho" }], usage: { input_tokens: 1, output_tokens: 2 } } },
    ]),
  );
  fs.writeFileSync(
    path.join(dir, `${old}.jsonl`),
    jsonl([{ type: "summary", summary: "Sesión antigua" }, { type: "user", cwd: projectCwd, message: { content: [{ type: "text", text: "hola" }] } }]),
  );
  const past = new Date("2025-01-01");
  fs.utimesSync(path.join(dir, `${old}.jsonl`), past, past);
  fs.mkdirSync(path.join(home, "sessions"));
  fs.writeFileSync(
    path.join(home, "sessions", `${process.pid}.json`),
    JSON.stringify({ pid: process.pid, sessionId: live, cwd: projectCwd, status: "busy", startedAt: Date.now(), updatedAt: Date.now() }),
  );
  fs.writeFileSync(path.join(home, "sessions", "999999.json"), JSON.stringify({ pid: 999999, sessionId: old, status: "idle" }));
  fs.writeFileSync(path.join(home, "sessions", "garbage.json"), "{");
  return { home, live, old };
}

export async function waitFor<T>(fn: () => T | Promise<T>, ms = 10_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
}
