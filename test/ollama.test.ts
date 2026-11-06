import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceptableCorrection, cleanModelText } from "@/lib/server/ollama";
import { createContext } from "@/lib/server/context";
import { FAKE_CLAUDE, tmpDir } from "./helpers";

let server: http.Server;
let base = "";
const seen: { path: string; body?: { model: string; messages: { role: string; content: string }[] } }[] = [];
let reply = (system: string, user: string) => user;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      seen.push({ path: req.url!, body });
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/tags") return void res.end(JSON.stringify({ models: [{ name: "qwen2.5:3b", size: 1900000000 }, { name: "llama3.2:3b", size: 2000000000 }] }));
      if (req.url === "/api/chat") {
        if (body.model === "roto") return void ((res.statusCode = 404), res.end(JSON.stringify({ error: 'model "roto" not found' })));
        const [sys, usr] = body.messages as { content: string }[];
        const text = usr!.content.replace(/^<texto>\n/, "").replace(/\n<\/texto>$/, "");
        return void res.end(JSON.stringify({ message: { role: "assistant", content: reply(sys!.content, text) } }));
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const ctx = () => createContext({ dataDir: tmpDir(), claudeHome: tmpDir(), claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 2, maxLogBytes: 1e6 });

describe("local model (Ollama)", () => {
  it("is off until chosen, and validates the address", () => {
    const c = ctx();
    expect(c.ollama.get()).toEqual({ enabled: false, baseUrl: "http://127.0.0.1:11434", model: "", autocorrect: "off" });
    expect(() => c.ollama.set({ baseUrl: "ftp://x" })).toThrow();
    expect(() => c.ollama.set({ baseUrl: "http://user:pw@localhost:11434" })).toThrow();
    expect(() => c.ollama.set({ baseUrl: "http://169.254.169.254" })).toThrow();
    expect(() => c.ollama.set({ autocorrect: "siempre" })).toThrow();
    expect(c.ollama.set({ model: "qwen2.5:3b" })).toMatchObject({ model: "qwen2.5:3b", baseUrl: "http://127.0.0.1:11434" });
  });

  it("lists the models, and says so when Ollama is not there", async () => {
    const c = ctx();
    c.ollama.set({ baseUrl: base });
    const ok = await c.ollama.status();
    expect(ok).toMatchObject({ reachable: true, models: [{ name: "qwen2.5:3b" }, { name: "llama3.2:3b" }] });
    c.ollama.set({ baseUrl: "http://127.0.0.1:1" });
    const down = await c.ollama.status();
    expect(down).toMatchObject({ reachable: false, models: [] });
    expect(down.error).toMatch(/No encuentro Ollama/);
  });

  it("corrects text through the chosen model, sending the text as data", async () => {
    const c = ctx();
    c.ollama.set({ enabled: true, baseUrl: base, model: "qwen2.5:3b" });
    seen.length = 0;
    reply = (_s, t) => t.replace("herrores", "errores").replace("q tal", "qué tal");
    const r = await c.ollama.correct({ text: "hola q tal, tengo herrores" });
    expect(r).toEqual({ text: "hola qué tal, tengo errores", changed: true });
    const sent = seen.find((x) => x.path === "/api/chat")!.body!;
    expect(sent.model).toBe("qwen2.5:3b");
    expect(sent.messages[0]!.content).toMatch(/corrector/);
    expect(sent.messages[1]!.content).toBe("<texto>\nhola q tal, tengo herrores\n</texto>");
    reply = (_s, t) => t;
    expect(await c.ollama.correct({ text: "todo bien" })).toEqual({ text: "todo bien", changed: false });
    expect(await c.ollama.correct({ text: "   " })).toEqual({ text: "   ", changed: false });
  });

  it("ignores a 'correction' that strays (it answered, translated or rewrote)", async () => {
    const c = ctx();
    c.ollama.set({ enabled: true, baseUrl: base, model: "qwen2.5:3b" });
    reply = () => "Claro, aquí tienes una explicación larguísima sobre cómo funcionan los closures en JavaScript y mucho más.";
    expect(await c.ollama.correct({ text: "hola q tal" })).toEqual({ text: "hola q tal", changed: false });
    reply = () => "";
    await expect(c.ollama.correct({ text: "hola" })).rejects.toThrow(/no devolvió nada/);
  });

  it("improves a prompt", async () => {
    const c = ctx();
    c.ollama.set({ enabled: true, baseUrl: base, model: "llama3.2:3b" });
    seen.length = 0;
    reply = (_s, t) => `\`\`\`\n## Objetivo\n${t}\n\`\`\``;
    const r = await c.ollama.improve({ text: "arregla el login" });
    expect(r.text).toBe("## Objetivo\narregla el login");
    expect(seen.find((x) => x.path === "/api/chat")!.body!.messages[0]!.content).toMatch(/prompts/);
    await expect(c.ollama.improve({ text: "  " })).rejects.toThrow(/Escribe primero/);
  });

  it("explains what is missing", async () => {
    const c = ctx();
    await expect(c.ollama.correct({ text: "hola" })).rejects.toThrow(/desactivada/);
    c.ollama.set({ enabled: true, baseUrl: base });
    await expect(c.ollama.correct({ text: "hola" })).rejects.toThrow(/Elige un modelo/);
    c.ollama.set({ model: "roto" });
    await expect(c.ollama.correct({ text: "hola" })).rejects.toThrow(/model "roto" not found/);
    c.ollama.set({ model: "x", baseUrl: "http://127.0.0.1:1" });
    await expect(c.ollama.improve({ text: "hola" })).rejects.toThrow(/No encuentro Ollama/);
  });
});

describe("what a model returns", () => {
  it("is cleaned of wrapping", () => {
    expect(cleanModelText('<texto>\nhola\n</texto>')).toBe("hola");
    expect(cleanModelText('"hola mundo"')).toBe("hola mundo");
    expect(cleanModelText('"dijo "hola" ayer"')).toBe('"dijo "hola" ayer"');
    expect(cleanModelText("<think>pienso…</think>\nresultado")).toBe("resultado");
    expect(cleanModelText("```md\n# a\n```")).toBe("# a");
  });
  it("must stay close to the original to count as a correction", () => {
    expect(acceptableCorrection("hola q tal", "hola qué tal")).toBe(true);
    expect(acceptableCorrection("hola q tal", "")).toBe(false);
    expect(acceptableCorrection("hola q tal", "Hello how are you doing today my friend, nice to meet you")).toBe(false);
    expect(acceptableCorrection("fix the bug in src/app.ts", "fix the bug in src/app.ts.")).toBe(true);
  });
});
