import { describe, expect, it } from "vitest";
import { upstreamDetail } from "@/lib/server/integrations/http";

describe("upstreamDetail", () => {
  it("extracts Bitbucket's reason, with the field that failed", () => {
    expect(upstreamDetail(JSON.stringify({ type: "error", error: { message: "Bad request", fields: { reviewers: ["User cannot be a reviewer"] } } }))).toBe("Bad request · reviewers: User cannot be a reviewer");
  });
  it("extracts GitHub's reason and ignores non-JSON", () => {
    expect(upstreamDetail(JSON.stringify({ message: "Validation Failed", errors: [{ message: "No commits between main and feat" }] }))).toBe("Validation Failed · No commits between main and feat");
    expect(upstreamDetail("<html>boom</html>")).toBe("");
  });
});
