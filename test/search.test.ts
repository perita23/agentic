import { describe, expect, it } from "vitest";
import { SessionIndex } from "@/lib/server/sessions";
import { makeClaudeHome, tmpDir } from "./helpers";

describe("SessionIndex.search", () => {
  const { home, live, old } = makeClaudeHome(tmpDir());
  const idx = new SessionIndex(home);

  it("finds text in prompts and replies with snippets", async () => {
    const r = await idx.search("LOGIN");
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]).toMatchObject({ sessionId: live, role: "user" });
    expect(r.hits[0].snippet).toContain("Arregla el login");
    const a = await idx.search("voy a mirar");
    expect(a.hits[0]).toMatchObject({ sessionId: live, role: "assistant" });
  });

  it("ignores sidechains, tool results and command wrappers", async () => {
    expect((await idx.search("sidechain")).hits).toEqual([]);
    expect((await idx.search("/clear")).hits).toEqual([]);
  });

  it("handles short queries, quotes and limits", async () => {
    expect((await idx.search("a")).hits).toEqual([]);
    expect((await idx.search('"hola')).hits).toEqual([]);
    const h = await idx.search("hola");
    expect(h.hits.map((x) => x.sessionId)).toEqual([old]);
    expect((await idx.search("a", { limit: 0 })).hits).toEqual([]);
  });
});
