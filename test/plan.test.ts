import { describe, expect, it } from "vitest";
import { extractPlan } from "@/lib/plan";

const use = (name: string, input: object, id = "x") => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const FILE = "/Users/a/.claude/plans/mi-plan.md";

describe("extractPlan", () => {
  it("uses the plan sent to ExitPlanMode", () => {
    expect(extractPlan([use("ExitPlanMode", { plan: "## Plan\n1. a" }, "p1")])).toEqual({ plan: "## Plan\n1. a", id: "p1" });
  });
  it("falls back to the plan file Claude wrote (with later edits applied)", () => {
    const events = [use("Write", { file_path: FILE, content: "# Plan\npaso uno" }), use("Edit", { file_path: FILE, old_string: "uno", new_string: "dos" }), use("ExitPlanMode", {}, "p2")];
    expect(extractPlan(events)).toEqual({ plan: "# Plan\npaso dos", id: "p2" });
  });
  it("shows a plan file even when ExitPlanMode was never called", () => {
    expect(extractPlan([use("Write", { file_path: FILE, content: "# Solo archivo" })])).toEqual({ plan: "# Solo archivo", id: null });
  });
  it("ignores ordinary files and empty input", () => {
    expect(extractPlan([use("Write", { file_path: "/p/README.md", content: "x" }), null, 3])).toBeNull();
    expect(extractPlan([])).toBeNull();
  });
});
