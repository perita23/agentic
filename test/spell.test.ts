import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "@/lib/server/context";
import { decide, distance } from "@/lib/server/spell";
import { FAKE_CLAUDE, tmpDir } from "./helpers";

let server: http.Server;
let base = "";
let pick: (options: string[], word: string) => string = (o) => o[0]!;
const asked: { options: string[]; word: string; before: string }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url !== "/api/chat") return void res.end("{}");
      const body = JSON.parse(raw) as { messages: { content: string }[] };
      const last = body.messages[body.messages.length - 1]!.content;
      const word = /<palabra>(.*)<\/palabra>/.exec(last)![1]!;
      const before = /<antes>(.*)<\/antes>/.exec(last)![1]!;
      const options = [...last.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]!);
      asked.push({ options, word, before });
      res.end(JSON.stringify({ message: { role: "assistant", content: JSON.stringify({ elegida: pick(options, word) }) } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const ctx = () => createContext({ dataDir: tmpDir(), claudeHome: tmpDir(), claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 2, maxLogBytes: 1e6 });
const word = (c: ReturnType<typeof ctx>, w: string, before = "") => c.spell.word({ word: w, before });

describe("what to do with the dictionary's candidates", () => {
  it("measures a swap of neighbouring letters as one mistake", () => {
    expect(distance("recieve", "receive")).toBe(1);
    expect(distance("casa", "caza")).toBe(1);
    expect(distance("abc", "")).toBe(3);
  });
  it("fixes what is sure, offers a choice when it is not, and gives up when nothing is near", () => {
    expect(decide("tambien", ["cambien", "también"])).toEqual({ kind: "fix", to: "también" }); // only the accent
    expect(decide("exelente", ["excelente"])).toEqual({ kind: "fix", to: "excelente" });
    expect(decide("recieve", ["receive", "relieve"])).toEqual({ kind: "fix", to: "receive" });
    expect(decide("corrije", ["corrijo", "corrige", "corrija"])).toEqual({ kind: "choose", options: ["corrijo", "corrige", "corrija"] });
    expect(decide("kubectl", [])).toEqual({ kind: "unknown" });
    expect(decide("docker", ["cocer", "decaer", "doctor"])).toMatchObject({ kind: expect.stringMatching(/choose|unknown/) });
  });
});

describe("technical words in a sentence of another language", () => {
  it("a typo of «prompt» in Spanish is «prompt», not a Spanish word that happens to be near", async () => {
    const c = ctx();
    expect(await word(c, "promt", "mejora este")).toEqual({ word: "prompt", changed: true, source: "dictionary" });
    expect(await word(c, "Promt", "")).toMatchObject({ word: "Prompt", changed: true });
    expect(await word(c, "comit", "haz un")).toMatchObject({ word: "commit", changed: true });
    expect(await word(c, "deploi", "el")).toMatchObject({ word: "deploy", changed: true });
    expect(await word(c, "brach", "la")).toMatchObject({ word: "branch", changed: true });
  });
  it("the nearest candidate wins whatever its language; on a tie the language being written does", () => {
    expect(decide("promt", ["arome", "aromo", "promo", "prom", "prompt"], new Set(["arome", "aromo"]))).toEqual({ kind: "fix", to: "prompt" });
    const es = new Set(["casa"]);
    expect(decide("casx", ["casa", "cask"], es)).toEqual({ kind: "fix", to: "casa" });
  });
  it("the person's own words are left alone and become the target of their typos", async () => {
    const c = ctx();
    expect(await word(c, "Morphi", "habla con")).toMatchObject({ changed: false }); // a capital in a sentence: a name
    c.spell.set({ ignore: ["quuxiel"] });
    expect(await word(c, "quuxiel", "abre")).toMatchObject({ word: "quuxiel", changed: false });
    expect(await word(c, "quuxeil", "abre")).toMatchObject({ word: "quuxiel", changed: true });
    expect(() => c.spell.set({ ignore: ["dos palabras"] })).toThrow();
  });
});

describe("spelling with the dictionaries", () => {
  it("fixes clear mistakes in Spanish and in English, without any model", async () => {
    const c = ctx();
    expect(await word(c, "exelente", "esto es")).toEqual({ word: "excelente", changed: true, source: "dictionary" });
    expect(await word(c, "tambien", "yo")).toEqual({ word: "también", changed: true, source: "dictionary" });
    expect(await word(c, "Tambien", "")).toEqual({ word: "También", changed: true, source: "dictionary" });
    expect(await word(c, "recieve", "I will")).toEqual({ word: "receive", changed: true, source: "dictionary" });
    expect(await word(c, "definately", "that is")).toMatchObject({ word: "definitely", changed: true });
  });

  it("leaves right words, names, code and anglicisms alone", async () => {
    const c = ctx();
    for (const [w, before] of [["hola", ""], ["casa", "mi"], ["hello", ""], ["commit", "haz un"], ["deploy", "el"], ["Docker", "revisa el"], ["kubectl", "ejecuta"], ["contraseña", "mi"]]) {
      expect(await word(c, w!, before), w).toMatchObject({ word: w, changed: false });
    }
  });

  it("only asks the model to choose between candidates, and only ever takes one of them", async () => {
    const c = ctx();
    c.ollama.set({ enabled: true, baseUrl: base, model: "qwen2.5:3b" });
    asked.length = 0;
    pick = (o) => o.find((x) => x === "corrige") ?? o[0]!;
    expect(await word(c, "corrije", "por favor")).toEqual({ word: "corrige", changed: true, source: "model" });
    expect(asked[0]!.options).toEqual(expect.arrayContaining(["corrige", "corrijo"]));
    expect(asked[0]!.before).toBe("por favor");
    pick = () => "algo que no es una opción";
    expect(await word(c, "corrije", "por favor")).toMatchObject({ word: "corrije", changed: false });
    pick = (_o, w) => w; // «none fits»
    expect(await word(c, "corrije", "por favor")).toMatchObject({ changed: false });
    // the model off, or told not to be used: the doubtful word stays as typed
    c.spell.set({ useModel: false });
    asked.length = 0;
    expect(await word(c, "corrije", "por favor")).toMatchObject({ changed: false });
    expect(asked).toHaveLength(0);
  });

  it("works out the language from the words around, or follows the chosen one", async () => {
    const c = ctx();
    expect(c.spell.detect("necesito que me ayudes con esto")).toBe("es");
    expect(c.spell.detect("I need you to help me with this")).toBe("en");
    expect(c.spell.detect("")).toBe("es");
    // «casa» is a Spanish word; asked in English mode, the English dictionary is the one proposing candidates
    c.spell.set({ lang: "en" });
    expect((await word(c, "recieve", "yo")).word).toBe("receive");
    c.spell.set({ lang: "es" });
    expect((await word(c, "exelente", "I think it is")).word).toBe("excelente");
  });
});

describe("the settings", () => {
  it("start off, carry over the old 'word by word' of the local model, and validate", () => {
    const a = ctx();
    expect(a.spell.get()).toEqual({ mode: "off", lang: "auto", useModel: true, ignore: [] });
    const b = ctx();
    b.ollama.set({ autocorrect: "words" });
    expect(b.spell.get().mode).toBe("words"); // not set yet in this store: it follows what was there
    b.spell.set({ mode: "off" });
    expect(b.spell.get().mode).toBe("off");
    expect(() => b.spell.set({ lang: "fr" })).toThrow();
    expect(() => b.spell.set({ mode: "siempre" })).toThrow();
    expect(b.spell.set({ lang: "en", mode: "words" })).toEqual({ mode: "words", lang: "en", useModel: true, ignore: [] });
  });
});
