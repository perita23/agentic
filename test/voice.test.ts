import { describe, expect, it, vi } from "vitest";
import { LANGUAGES, resolveLang } from "@/lib/voice/engine";
import { voiceColor, VOICE_COLORS } from "@/lib/voice/palette";

describe("dictation language", () => {
  it("follows the system when asked for 'auto', as a full tag", () => {
    expect(resolveLang("auto", "es-ES")).toBe("es-ES");
    expect(resolveLang("auto", "en-US")).toBe("en-US");
    expect(resolveLang("auto", "es")).toBe("es-ES");
    expect(resolveLang("auto", "fr")).toBe("fr-FR");
    expect(resolveLang("auto", "")).toBe("es-ES");
  });
  it("keeps a language that was chosen, and never returns nonsense", () => {
    expect(resolveLang("en-GB", "es-ES")).toBe("en-GB");
    expect(resolveLang("auto", "xx")).toBe("es-ES");
    for (const l of LANGUAGES) expect(resolveLang(l.value, "es-ES")).toMatch(/^[a-z]{2,3}-[A-Za-z0-9]{2,8}$/);
  });
});

describe("dictation colours", () => {
  it("go through the orb's violet, coral and blue", () => {
    expect(VOICE_COLORS).toEqual(["#8b6cf5", "#ff8a5b", "#5aa9ff"]);
    expect(voiceColor(0)).toBe("rgb(139 108 245)");
    expect(voiceColor(0.5)).toBe("rgb(255 138 91)");
    expect(voiceColor(1)).toBe("rgb(90 169 255)");
    expect(voiceColor(-3)).toBe(voiceColor(0));
    expect(voiceColor(9)).toBe(voiceColor(1));
  });
});

describe("the Mac helper is kept warm", () => {
  it("starts from a waiting helper, relays its events, and gets the next one ready", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { tmpDir } = await import("./helpers");
    const { createRequire } = await import("node:module");
    const dir = tmpDir();
    const bin = path.join(dir, "fake-listen");
    fs.writeFileSync(
      bin,
      `#!/usr/bin/env node
const out = (o) => console.log(JSON.stringify(o));
out({ type: "warm" });
require("node:readline").createInterface({ input: process.stdin }).on("line", (l) => {
  if (l.startsWith("start ")) { out({ type: "ready" }); out({ type: "text", text: "hola " + l.slice(6), final: false }); }
  else if (l === "stop") { out({ type: "text", text: "hola es-ES", final: true }); out({ type: "end" }); process.exit(0); }
});
`,
    );
    fs.chmodSync(bin, 0o755);
    const { createVoice } = createRequire(import.meta.url)("../desktop/lib/voice.cjs") as { createVoice: (o: object) => { stop(): void } };
    const handlers = new Map<string, (...a: unknown[]) => unknown>();
    const events: { type: string; text?: string }[] = [];
    const sender = { isDestroyed: () => false, send: (_c: string, o: { type: string; text?: string }) => events.push(o) };
    const ev = { sender };
    const v = createVoice({
      app: {},
      helperPath: bin,
      fromApp: () => true,
      ipcMain: { handle: (c: string, f: (...a: unknown[]) => unknown) => handlers.set(c, f), on: (c: string, f: (...a: unknown[]) => unknown) => handlers.set(c, f) },
    });
    try {
      expect(await handlers.get("voice:available")!(ev)).toBe(true);
      await new Promise((r) => setTimeout(r, 400)); // the waiting helper is up
      expect(await handlers.get("voice:start")!(ev, "no es un idioma!")).toMatchObject({ ok: false });
      expect(await handlers.get("voice:start")!(ev, "es-ES")).toEqual({ ok: true });
      await vi.waitFor(() => expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["ready", "text"])));
      expect(events.some((e) => e.type === "warm")).toBe(false);
      handlers.get("voice:stop")!(ev);
      await vi.waitFor(() => expect(events.at(-1)?.type).toBe("end"));
      expect(events.filter((e) => e.type === "text").map((e) => e.text)).toEqual(["hola es-ES", "hola es-ES"]);
      // and again, with the next helper that got ready meanwhile
      events.length = 0;
      await new Promise((r) => setTimeout(r, 700));
      expect(await handlers.get("voice:start")!(ev, "en-US")).toEqual({ ok: true });
      await vi.waitFor(() => expect(events.some((e) => e.type === "text" && e.text === "hola en-US")).toBe(true));
    } finally {
      v.stop();
    }
  });
});
