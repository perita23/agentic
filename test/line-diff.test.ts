import { describe, expect, it } from "vitest";
import { lineDiff, parsePatch } from "@/lib/line-diff";

describe("lineDiff", () => {
  it("keeps common lines as context and counts the rest", () => {
    const r = lineDiff("a\nb\nc", "a\nB\nc\nd");
    expect(r.lines.map((l) => l.t + l.s)).toEqual([" a", "-b", "+B", " c", "+d"]);
    expect(r).toMatchObject({ add: 2, del: 1 });
  });
  it("handles new files, empty results and huge inputs", () => {
    expect(lineDiff("", "x\ny")).toMatchObject({ add: 2, del: 0 });
    expect(lineDiff("x", "")).toMatchObject({ add: 0, del: 1 });
    const big = Array.from({ length: 500 }, (_, i) => `l${i}`).join("\n");
    expect(lineDiff(big, big + "\nz")).toMatchObject({ del: 500, add: 501 });
  });
});

describe("parsePatch", () => {
  it("turns a git patch into lines, without the file header", () => {
    const p = "diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n ctx\n-old\n+new\n\\ No newline at end of file";
    expect(parsePatch(p).map((l) => l.t + l.s)).toEqual([" @@ -1,2 +1,2 @@", " ctx", "-old", "+new"]);
  });
});
