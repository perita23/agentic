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

import { pickVoice, speechText, splitForSpeech } from "@/lib/voice/speak";

describe("reading aloud: what is worth hearing", () => {
  it("drops code, tables, addresses and markup", () => {
    const md = "## Resultado\n\nHe cambiado **dos** archivos: `src/app.ts` y [la guía](https://x.dev/g).\n\n```ts\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- primero\n- segundo\n\nMira https://example.com/algo ahora.";
    const t = speechText(md);
    expect(t).not.toMatch(/[`*#|]|const a|https?:/);
    expect(t).toContain("He cambiado dos archivos");
    expect(t).toContain("la guía");
    expect(t).toContain("primero\nsegundo");
    expect(t).toContain("un enlace");
    expect(speechText("rutas: /home/user/proyecto/src/lib/a.ts")).toContain("una ruta");
  });
  it("says so when there is only code, and copes with an unclosed block", () => {
    expect(speechText("```js\nfoo()\n```")).toBe("Te dejo el código en pantalla.");
    expect(speechText("Hola\n```js\nfoo(")).toBe("Hola");
    expect(speechText("")).toBe("");
  });
});

describe("reading aloud: pieces", () => {
  it("splits into sentences and never makes a piece too long", () => {
    expect(splitForSpeech("Hola. ¿Qué tal? Muy bien!")).toEqual(["Hola. ¿Qué tal? Muy bien!"]);
    const long = Array.from({ length: 60 }, (_, i) => `palabra${i}`).join(" ");
    const parts = splitForSpeech(`Primera frase. ${long}.`, 100);
    expect(parts.length).toBeGreaterThan(3);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(100);
    expect(parts.join(" ").replace(/\s+/g, " ")).toContain("palabra59");
    expect(splitForSpeech("uno\n\ndos")).toEqual(["uno", "dos"]);
  });
});

describe("reading aloud: choosing the voice", () => {
  const v = (voiceURI: string, lang: string, localService = true, name = voiceURI) => ({ voiceURI, name, lang, localService });
  it("takes the chosen one, else the best local one of the language, and never a remote one", () => {
    const voices = [v("remote-es", "es-ES", false), v("paulina", "es-MX"), v("monica", "es-ES"), v("Mónica (mejorada)", "es-ES", true, "Mónica (mejorada)"), v("samantha", "en-US")];
    expect(pickVoice(voices, "es-ES")?.voiceURI).toBe("Mónica (mejorada)");
    expect(pickVoice(voices, "es-MX")?.voiceURI).toBe("paulina");
    expect(pickVoice(voices, "en-GB")?.voiceURI).toBe("samantha");
    expect(pickVoice(voices, "es-ES", "paulina")?.voiceURI).toBe("paulina");
    expect(pickVoice(voices, "es-ES", "remote-es")?.voiceURI).not.toBe("remote-es");
    expect(pickVoice([v("remote-es", "es-ES", false)], "es-ES")).toBeNull();
    expect(pickVoice(voices, "ja-JP")).toBeNull();
  });
});

describe("the voices of macOS, through `say`", () => {
  it("lists voices with their quality, without novelty voices", async () => {
    const { createRequire } = await import("node:module");
    const { parseVoices } = createRequire(import.meta.url)("../desktop/lib/speak.cjs") as { parseVoices: (o: string) => { name: string; lang: string; quality: string }[] };
    const out = [
      "Albert              en_US    # I have a frog in my throat. No, I mean a real frog!",
      "Mónica              es_ES    # Hola, me llamo Mónica y soy una voz española.",
      "Mónica (Premium)    es_ES    # Hola, me llamo Mónica y soy una voz española.",
      "Paulina (Mejorada)  es_MX    # Hola, me llamo Paulina y soy una voz mexicana.",
      "Samantha (Enhanced)  en_US    # Hello! My name is Samantha.",
      "línea que no es una voz",
    ].join("\n");
    expect(parseVoices(out)).toEqual([
      { name: "Mónica", lang: "es-ES", quality: "standard" },
      { name: "Mónica (Premium)", lang: "es-ES", quality: "premium" },
      { name: "Paulina (Mejorada)", lang: "es-MX", quality: "enhanced" },
      { name: "Samantha (Enhanced)", lang: "en-US", quality: "enhanced" },
    ]);
  });

  it("speaks through stdin, one piece at a time, and can be stopped", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { tmpDir } = await import("./helpers");
    const { createRequire } = await import("node:module");
    const dir = tmpDir();
    const log = path.join(dir, "say.log");
    const bin = path.join(dir, "fake-say");
    fs.writeFileSync(
      bin,
      `#!/usr/bin/env node
const fs = require("node:fs");
const a = process.argv.slice(2);
if (a[0] === "-v" && a[1] === "?") { console.log("Mónica (Premium)    es_ES    # Hola"); process.exit(0); }
let t = ""; process.stdin.on("data", (d) => (t += d)); process.stdin.on("end", () => {
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ a, t }) + "\\n");
  setTimeout(() => process.exit(0), t.includes("LARGO") ? 5000 : 30);
});
`,
    );
    fs.chmodSync(bin, 0o755);
    const { createSpeak } = createRequire(import.meta.url)("../desktop/lib/speak.cjs") as { createSpeak: (o: object) => { stop(): void } };
    const h = new Map<string, (...a: unknown[]) => unknown>();
    const ev = {};
    const sp = createSpeak({ fromApp: () => true, sayPath: bin, ipcMain: { handle: (c: string, f: (...a: unknown[]) => unknown) => h.set(c, f), on: (c: string, f: (...a: unknown[]) => unknown) => h.set(c, f) } });
    try {
      expect(await h.get("speak:available")!(ev)).toBe(true);
      expect(await h.get("speak:voices")!(ev)).toEqual([{ name: "Mónica (Premium)", lang: "es-ES", quality: "premium" }]);
      expect(await h.get("speak:say")!(ev, "--version hola", "Mónica (Premium)", 1.2)).toBe(true);
      expect(await h.get("speak:say")!(ev, "otra", "una voz que no existe", 9)).toBe(true);
      const lines = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(lines[0]).toEqual({ a: ["-v", "Mónica (Premium)", "-r", "210"], t: "--version hola" }); // the text is data, never an option
      expect(lines[1]).toEqual({ a: ["-r", "175"], t: "otra" });
      expect(await h.get("speak:say")!(ev, "   ", null, 1)).toBe(false);
      const long = h.get("speak:say")!(ev, "LARGO", null, 1) as Promise<boolean>;
      await new Promise((r) => setTimeout(r, 200));
      h.get("speak:stop")!(ev);
      expect(await long).toBe(false);
    } finally {
      sp.stop();
    }
  });

  it("prefers a natural voice of the language over a compact one", () => {
    const v = (voiceURI: string, lang = "es-ES") => ({ voiceURI, name: voiceURI.replace("say:", ""), lang, localService: true });
    const voices = [v("say:Mónica"), v("say:Jorge (Premium)"), v("say:Paulina (Mejorada)", "es-MX"), v("say:Samantha (Premium)", "en-US")];
    expect(pickVoice(voices, "es-ES")?.voiceURI).toBe("say:Jorge (Premium)");
    expect(pickVoice(voices, "es-MX")?.voiceURI).toBe("say:Paulina (Mejorada)");
    expect(pickVoice(voices, "en-US")?.voiceURI).toBe("say:Samantha (Premium)");
  });
});
