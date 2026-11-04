import { describe, expect, it } from "vitest";
import { changedFiles } from "@/lib/changed-files";

const tool = (name: string, input: object) => ({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });

describe("changedFiles", () => {
  it("lists created and edited files, newest first, relative to the project", () => {
    const files = changedFiles(
      [
        tool("Write", { file_path: "/p/app/new.ts" }),
        tool("Read", { file_path: "/p/app/ignored.ts" }),
        tool("Edit", { file_path: "/p/app/a.ts" }),
        tool("Edit", { file_path: "/p/app/a.ts" }),
        tool("Bash", { command: "ls" }),
      ],
      "/p",
    );
    expect(files).toEqual([
      { path: "app/a.ts", action: "edited", touches: 2 },
      { path: "app/new.ts", action: "created", touches: 1 },
    ]);
  });
  it("ignores malformed events", () => {
    expect(changedFiles([null, 3, { type: "assistant" }, tool("Edit", {})])).toEqual([]);
  });
});
