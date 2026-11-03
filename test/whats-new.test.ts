import { describe, expect, it } from "vitest";
import { compareVersions, markSeen, parseChangelog, whatsNew } from "@/lib/server/changelog";
import { JsonStore } from "@/lib/server/store";
import { redactUrl } from "@/lib/server/util";
import { tmpDir } from "./helpers";

const MD = `# Changelog

## [0.3.0] - 2026-11-03

### Añadido
- Tres

## [0.2.0] - 2026-11-02

- Dos

## [0.1.0] - 2026-11-01

- Uno
`;

describe("what's new", () => {
  it("parses Keep a Changelog sections", () => {
    expect(parseChangelog(MD).map((s) => [s.version, s.date])).toEqual([
      ["0.3.0", "2026-11-03"],
      ["0.2.0", "2026-11-02"],
      ["0.1.0", "2026-11-01"],
    ]);
    expect(parseChangelog(MD)[0].body).toBe("### Añadido\n- Tres");
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
  });

  it("shows the notes since the last version seen, then nothing until the next update", () => {
    const store = new JsonStore(tmpDir());
    expect(whatsNew(store, "0.3.0", MD)).toMatchObject({ show: true, sections: [{ version: "0.3.0" }] }); // nothing seen yet: current only
    markSeen(store, "0.1.0");
    expect(whatsNew(store, "0.3.0", MD).sections.map((s) => s.version)).toEqual(["0.3.0", "0.2.0"]);
    markSeen(store, "0.3.0");
    expect(whatsNew(store, "0.3.0", MD).show).toBe(false);
  });
});

describe("redactUrl", () => {
  it("drops credentials embedded in URLs", () => {
    expect(redactUrl("origin https://x-bitbucket-api-token-auth:ATATT3xSECRET@bitbucket.org/acme/inox.git")).toBe("origin https://bitbucket.org/acme/inox.git");
    expect(redactUrl("https://user@github.com/a/b")).toBe("https://github.com/a/b");
    expect(redactUrl("git@github.com:a/b.git")).toBe("git@github.com:a/b.git");
  });
});
