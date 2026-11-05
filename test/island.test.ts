import { notchPath } from "@/components/app/island-view";
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { RunManager, type Run } from "@/lib/server/runs";
import { islandSnapshot } from "@/lib/server/island";
import { JsonStore } from "@/lib/server/store";
import { FAKE_CLAUDE, tmpDir, waitFor } from "./helpers";

const { SAFE_PATH } = createRequire(import.meta.url)("../desktop/lib/island.cjs") as { SAFE_PATH: RegExp };

describe("island", () => {
  it("lists a run while it works and as recent once it ends", async () => {
    const dataDir = tmpDir();
    const m = new RunManager(new JsonStore(dataDir), { dataDir, claudeBin: FAKE_CLAUDE, maxConcurrent: 2, maxLogBytes: 1024 * 1024 });
    const r = await m.start({ projectPath: tmpDir(), prompt: "STREAMTEXT hola" });
    const during = islandSnapshot(m);
    expect(during.running.map((x) => x.id)).toEqual([r.id]);
    expect(during.running[0].href).toBe(`/runs/${r.id}`);
    expect(during.recent).toEqual([]);
    await waitFor(() => (m.get(r.id).status !== "running" ? (m.get(r.id) as Run) : null));
    const after = islandSnapshot(m);
    expect(after.running).toEqual([]);
    expect(after.recent.map((x) => x.id)).toEqual([r.id]);
    expect(after.recent[0].state).toBe("done");
    // Old runs are not announced again.
    expect(islandSnapshot(m, Date.now() + 10 * 60_000).recent).toEqual([]);
  });

  it("only opens in-app paths from the island", () => {
    expect(SAFE_PATH.test("/runs/abc-123")).toBe(true);
    for (const bad of ["https://evil.com", "//evil.com", "/runs/../../x?y=1", "javascript:alert(1)", "runs/1"]) expect(SAFE_PATH.test(bad)).toBe(false);
  });
});


describe("notch shape", () => {
  const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  it("is a closed outline that stays inside its box, at any size", () => {
    for (const [w, h, tr, br] of [[328, 37, 7, 12], [420, 125, 14, 26], [180, 20, 4, 8], [40, 10, 30, 30]] as const) {
      const d = notchPath(w, h, tr, br);
      expect(d.startsWith("M0 0")).toBe(true);
      expect(d.endsWith("Z")).toBe(true);
      const n = nums(d);
      expect(Math.max(...n)).toBeLessThanOrEqual(Math.max(w, h));
      expect(Math.min(...n)).toBeGreaterThanOrEqual(0);
    }
  });
  it("has concave shoulders on top and rounded bottom corners", () => {
    const d = notchPath(300, 40, 8, 14);
    expect(d).toContain("C"); // curves, not straight cuts
    expect((d.match(/C/g) ?? []).length).toBe(4);
    expect(d).toContain("L8 26"); // the body is inset by the shoulder radius
  });
});

const { parseNotch } = createRequire(import.meta.url)("../desktop/lib/island.cjs") as { parseNotch: (out: string) => { notchWidth: number; notchHeight: number } | null };

describe("real notch", () => {
  it("reads the notch from the areas AppKit reports around it", () => {
    // A 14" MacBook Pro: 1512 pt wide, 32 pt tall notch, about 185 pt wide.
    expect(parseNotch(JSON.stringify({ width: 1512, left: 663.5, right: 663.5, height: 32 }))).toEqual({ notchWidth: 185, notchHeight: 32 });
    expect(parseNotch(`${JSON.stringify({ width: 1728, left: 770, right: 770, height: 32 })}\n`)).toEqual({ notchWidth: 188, notchHeight: 32 });
  });
  it("is null without a notch or with unusable output", () => {
    expect(parseNotch(JSON.stringify({ width: 1920, left: 0, right: 0, height: 0 }))).toBeNull();
    expect(parseNotch("")).toBeNull();
    expect(parseNotch("not json")).toBeNull();
    expect(parseNotch(JSON.stringify({ width: 1000, left: 100, right: 100, height: 30 }))).toBeNull(); // implausible width
  });
});
