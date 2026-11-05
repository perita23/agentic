import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

describe("macOS lock window", () => {
  it("carries exactly the orb CSS of the app (copy the orb section of src/app/globals.css between the orb:start/orb:end markers)", () => {
    const css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
    const orb = css.slice(css.indexOf("/* ---- Liquid orb")).trim();
    const html = fs.readFileSync(path.join(root, "desktop/lock.html"), "utf8");
    const a = html.indexOf("/* orb:start");
    const b = html.indexOf("/* orb:end */");
    const embedded = html.slice(html.indexOf("*/", a) + 2, b).trim();
    expect(embedded).toBe(orb);
  });

  it("never prompts Touch ID on its own when the lock window opens", () => {
    const main = fs.readFileSync(path.join(root, "desktop/main.cjs"), "utf8");
    // promptTouch() may only run from the explicit "Usar Touch ID" IPC handler.
    const calls = main.split("\n").filter((l) => /\bpromptTouch\(\)/.test(l) && !/async function promptTouch/.test(l));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("if (e.sender === wc)");
  });
});
