import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chatDir, writtenPath } from "@/lib/server/chats";
import { createContext } from "@/lib/server/context";
import { FAKE_CLAUDE, tmpDir } from "./helpers";

const SID = "11111111-2222-4333-8444-555555555555";

async function chatWith(files: { write: string; content?: string; make?: boolean }[]) {
  const claudeHome = tmpDir();
  const c = createContext({ dataDir: tmpDir(), claudeHome, claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 2, maxLogBytes: 1e6 });
  const chat = await c.chats.create({ prompt: "haz un informe" });
  for (let i = 0; i < 200 && c.runs.list().some((r) => r.status === "running"); i++) await new Promise((r) => setTimeout(r, 25));
  const dir = chatDir(c.config.dataDir);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) if (f.make !== false) fs.writeFileSync(path.isAbsolute(f.write) ? f.write : path.join(dir, f.write), f.content ?? "hola");
  const projects = path.join(claudeHome, "projects", "-chat");
  fs.mkdirSync(projects, { recursive: true });
  const lines = [
    { type: "user", cwd: dir, timestamp: "2026-11-03T10:00:00.000Z", message: { role: "user", content: "haz un informe" } },
    {
      type: "assistant",
      timestamp: "2026-11-03T10:00:01.000Z",
      message: { role: "assistant", model: "claude", content: [{ type: "text", text: "Listo, aquí lo tienes." }, ...files.map((f, i) => ({ type: "tool_use", id: `t${i}`, name: "Write", input: { file_path: path.isAbsolute(f.write) ? f.write : path.join(dir, f.write), content: "x".repeat(900) } }))] },
    },
  ];
  fs.writeFileSync(path.join(projects, `${SID}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return { c, chat, dir };
}

describe("files Claude creates in a chat", () => {
  it("reads the path of a Write call, even when the call is cut short", () => {
    expect(writtenPath('{"file_path":"/tmp/a b/ñ.md","content":"abc', "/base")).toBe("/tmp/a b/ñ.md");
    expect(writtenPath('{"file_path":"informe.md","content":"x"}', "/base")).toBe("/base/informe.md");
    expect(writtenPath('{"command":"ls"}', "/base")).toBeNull();
  });

  it("offers the files in the message that created them", async () => {
    const { c, chat, dir } = await chatWith([{ write: "informe.md", content: "# Informe\n" }, { write: "datos.csv" }, { write: "borrado.txt", make: false }]);
    const detail = await c.chats.get(chat.id);
    const answer = detail.messages.find((m) => m.role === "assistant")!;
    expect((answer as { files: { name: string; size: number }[] }).files.map((f) => [f.name, f.size])).toEqual([["informe.md", 10], ["datos.csv", 4]]); // the deleted one is not offered
    expect(detail.messages.find((m) => m.role === "user")).not.toHaveProperty("files");
    expect(fs.existsSync(path.join(dir, "borrado.txt"))).toBe(false);
  });

  it("serves only files this conversation's Claude wrote, as plain files", async () => {
    const { c, chat, dir } = await chatWith([{ write: "informe.md" }]);
    const ok = await c.chats.fileFor(chat.id, path.join(dir, "informe.md"));
    expect(ok).toMatchObject({ name: "informe.md", size: 4 });
    // anything else: not found (a path to read elsewhere, a traversal, a file nobody wrote)
    fs.writeFileSync(path.join(dir, "otro.txt"), "no lo escribió Claude aquí");
    for (const bad of ["/etc/passwd", path.join(dir, "otro.txt"), path.join(dir, "..", "chats.json"), path.join(dir, "..", "token"), "informe.md"]) {
      await expect(c.chats.fileFor(chat.id, bad), bad).rejects.toThrow(/no es de esta conversación/);
    }
    // a link in its place is never followed
    fs.rmSync(path.join(dir, "informe.md"));
    fs.symlinkSync("/etc/hostname", path.join(dir, "informe.md"));
    await expect(c.chats.fileFor(chat.id, path.join(dir, "informe.md"))).rejects.toThrow(/no es de esta conversación/);
  });

  it("rejects an id that is not a chat", async () => {
    const { c } = await chatWith([{ write: "informe.md" }]);
    await expect(c.chats.fileFor("no-es-un-id", "/x")).rejects.toThrow();
  });
});
