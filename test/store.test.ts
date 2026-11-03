import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonStore } from "@/lib/server/store";
import { tmpDir } from "./helpers";

describe("JsonStore", () => {
  it("returns fallback, persists atomically with 0600 perms", () => {
    const dir = tmpDir();
    const s = new JsonStore(dir);
    expect(s.read("items", [])).toEqual([]);
    s.write("items", [1, 2]);
    expect(new JsonStore(dir).read("items", [])).toEqual([1, 2]);
    expect(fs.statSync(path.join(dir, "items.json")).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("update() works on a copy and does not corrupt state when fn throws", () => {
    const s = new JsonStore(tmpDir());
    s.write("x", { n: 1 });
    expect(() =>
      s.update<{ n: number }>("x", { n: 0 }, (d) => {
        d.n = 99;
        throw new Error("nope");
      }),
    ).toThrow("nope");
    expect(s.read("x", { n: 0 }).n).toBe(1);
  });

  it("recovers from a corrupt file and keeps a backup", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "tasks.json"), "{broken");
    const s = new JsonStore(dir);
    expect(s.read("tasks", ["fallback"])).toEqual(["fallback"]);
    expect(fs.readdirSync(dir).some((f) => f.startsWith("tasks.json.corrupt-"))).toBe(true);
  });

  it("rejects collection names that could escape the directory", () => {
    const s = new JsonStore(tmpDir());
    expect(() => s.read("../etc/passwd", null)).toThrow();
    expect(() => s.write("A/B", 1)).toThrow();
  });
});
