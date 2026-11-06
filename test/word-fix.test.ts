import { describe, expect, it } from "vitest";
import { checkable, shorthandFix, wordsOf } from "@/lib/word-fix";

const checked = (t: string) => wordsOf(t).filter((w) => checkable(t, w)).map((w) => w.word);

describe("words worth checking", () => {
  it("finds the words with their place and the words before them", () => {
    const w = wordsOf("hola q tal estas ");
    expect(w.map((x) => [x.start, x.end, x.word])).toEqual([[0, 4, "hola"], [5, 6, "q"], [7, 10, "tal"], [11, 16, "estas"]]);
    expect(w[3]!.before).toBe("hola q tal");
  });
  it("only checks finished words, never the one being typed", () => {
    expect(checked("tengo un herror")).toEqual([]);
    expect(checked("tengo un herror ")).toEqual(["herror"]);
    expect(checked("tengo un herror,")).toEqual(["herror"]);
  });
  it("skips what is not prose: code, paths, urls, identifiers, numbers, acronyms, commands", () => {
    expect(checked("revisa src/lib/foo.ts ahora ")).toEqual(["revisa"]);
    expect(checked("usa `kubectl aply` y getUserName luego ")).toEqual(["usa"]);
    expect(checked("```js\nconst herrror = 1\n``` listo ")).toEqual(["listo"]);
    expect(checked("abre https://example.com/docs ya ")).toEqual(["abre"]);
    expect(checked("escribe a juan@example.com ya ")).toEqual(["escribe"]);
    expect(checked("el puerto 8080 está ocupado ")).toEqual(["puerto", "ocupado"]);
    expect(checked("usa la API de NASA ahora ")).toEqual(["usa"]);
    expect(checked("/plan revisa el codigo ")).toEqual(["revisa", "codigo"]);
  });
  it("does not bother the model with very common words", () => {
    expect(checked("el perro de mi vecino ")).toEqual(["perro", "vecino"]);
  });
});

describe("chat shorthand", () => {
  it("is fixed without a model, keeping the capital", () => {
    expect(shorthandFix("q")).toBe("que");
    expect(shorthandFix("Q")).toBe("Que");
    expect(shorthandFix("xq")).toBe("porque");
    expect(shorthandFix("xfa")).toBe("por favor");
    expect(shorthandFix("casa")).toBeNull();
    expect(checked("dime q hiciste ")).toEqual(["q", "hiciste"]);
  });
});
