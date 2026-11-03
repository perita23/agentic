import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chatDir } from "@/lib/server/chats";
import { createContext } from "@/lib/server/context";
import { FAKE_CLAUDE, tmpDir } from "./helpers";

const SID = "11111111-2222-4333-8444-555555555555"; // what the fake claude reports

async function settle(c: ReturnType<typeof createContext>) {
  for (let i = 0; i < 200 && c.runs.list().some((r) => r.status === "running"); i++) await new Promise((r) => setTimeout(r, 25));
}

function setup() {
  const claudeHome = tmpDir();
  const c = createContext({ dataDir: tmpDir(), claudeHome, claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 2, maxLogBytes: 1e6 });
  return { c, claudeHome };
}

describe("chat", () => {
  it("starts a conversation outside any project and resumes the same Claude session", async () => {
    const { c, claudeHome } = setup();
    const chat = await c.chats.create({ prompt: "  Hola,   ¿qué tal?  " });
    expect(chat.title).toBe("Hola, ¿qué tal?");
    await settle(c);
    const first = c.runs.list()[0];
    expect(first.projectPath).toBe(fs.realpathSync(chatDir(c.config.dataDir)));
    expect(first.resumeSessionId).toBeNull();

    // Claude Code writes its transcript; the chat reads it back.
    const dir = path.join(claudeHome, "projects", "-chat");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${SID}.jsonl`),
      [
        { type: "user", cwd: chatDir(c.config.dataDir), timestamp: "2026-11-03T10:00:00.000Z", message: { role: "user", content: "Hola, ¿qué tal?" } },
        { type: "assistant", timestamp: "2026-11-03T10:00:01.000Z", message: { role: "assistant", model: "claude", content: [{ type: "text", text: "¡Hola! Todo bien." }] } },
      ]
        .map((l) => JSON.stringify(l))
        .join("\n") + "\n",
    );
    const detail = await c.chats.get(chat.id);
    expect(detail.sessionId).toBe(SID);
    expect(detail.messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "Hola, ¿qué tal?"],
      ["assistant", "¡Hola! Todo bien."],
    ]);

    await c.chats.send(chat.id, { prompt: "Otra pregunta", model: "sonnet" });
    await settle(c);
    const second = c.runs.list().find((r) => r.prompt === "Otra pregunta")!;
    expect(second.resumeSessionId).toBe(SID);
    expect(second.model).toBe("sonnet");
    expect(c.chats.list()[0]).toMatchObject({ id: chat.id, model: "sonnet", running: false });
  });

  it("refuses a new message while Claude is still answering, and manages the history", async () => {
    const { c } = setup();
    const chat = await c.chats.create({ prompt: "SLEEP piensa mucho" });
    await expect(c.chats.send(chat.id, { prompt: "¿sigues?" })).rejects.toThrow(/respondiendo/);
    expect((await c.chats.get(chat.id)).pendingPrompt).toBe("SLEEP piensa mucho");
    for (const r of c.runs.list()) if (r.status === "running") await c.runs.stop(r.id);

    c.chats.update(chat.id, { title: "Renombrado", pinned: true });
    expect(c.chats.list()[0]).toMatchObject({ title: "Renombrado", pinned: true });
    await expect(c.chats.create({ prompt: "   " })).rejects.toThrow(/Escribe un mensaje/);
    c.chats.remove(chat.id);
    expect(c.chats.list()).toEqual([]);
    await expect(c.chats.get(chat.id)).rejects.toThrow(/no encontrada/);
  });

  it("does not list the chat folder as a project", async () => {
    const { c, claudeHome } = setup();
    const dir = path.join(claudeHome, "projects", "-chat");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${SID}.jsonl`), JSON.stringify({ type: "user", cwd: chatDir(c.config.dataDir), message: { role: "user", content: "hola" } }) + "\n");
    expect(c.projects.list().some((p) => p.path.startsWith(chatDir(c.config.dataDir)))).toBe(false);
  });
});
