import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonStore } from "@/lib/server/store";
import { tmpDir } from "./helpers";

const g = globalThis as unknown as { __agenticDataKey?: string };
afterEach(() => delete g.__agenticDataKey);

describe("encryption at rest", () => {
  it("never writes sealed collections in clear and reads them back", () => {
    const d = tmpDir();
    const s = new JsonStore(d, new Set(["integrations"]));
    s.write("integrations", { slack: { botToken: "xoxp-super-secret" } });
    s.write("tasks", { title: "visible" });
    const raw = fs.readFileSync(path.join(d, "integrations.json"), "utf8");
    expect(raw).not.toContain("xoxp-super-secret");
    expect(JSON.parse(raw).format).toBe("agentic-sealed-v1");
    expect(fs.readFileSync(path.join(d, "tasks.json"), "utf8")).toContain("visible");
    expect(fs.statSync(path.join(d, "data.key")).mode & 0o777).toBe(0o600);
    expect(new JsonStore(d, new Set(["integrations"])).read("integrations", {})).toEqual({ slack: { botToken: "xoxp-super-secret" } });
  });

  it("seals files written in clear by older versions", () => {
    const d = tmpDir();
    fs.writeFileSync(path.join(d, "integrations.json"), JSON.stringify({ github: { token: "ghp_old" } }));
    const s = new JsonStore(d, new Set(["integrations"]));
    s.sealExisting();
    expect(fs.readFileSync(path.join(d, "integrations.json"), "utf8")).not.toContain("ghp_old");
    expect(new JsonStore(d, new Set(["integrations"])).read<{ github: { token: string } }>("integrations", {} as never).github.token).toBe("ghp_old");
  });

  it("uses the app's Keychain key first and still opens data sealed with the old file key", () => {
    const d = tmpDir();
    new JsonStore(d, new Set(["integrations"])).write("integrations", { jira: { token: "t1" } }); // file key
    g.__agenticDataKey = "a".repeat(64);
    const s = new JsonStore(d, new Set(["integrations"]));
    expect(s.read<{ jira: { token: string } }>("integrations", {} as never).jira.token).toBe("t1");
    s.write("integrations", { jira: { token: "t2" } }); // re-sealed with the Keychain key
    fs.rmSync(path.join(d, "data.key"));
    expect(new JsonStore(d, new Set(["integrations"])).read<{ jira: { token: string } }>("integrations", {} as never).jira.token).toBe("t2");
  });

  it("starts empty (keeping a backup) when the key is gone", () => {
    const d = tmpDir();
    g.__agenticDataKey = "b".repeat(64);
    new JsonStore(d, new Set(["integrations"])).write("integrations", { x: 1 });
    g.__agenticDataKey = "c".repeat(64);
    expect(new JsonStore(d, new Set(["integrations"])).read("integrations", {})).toEqual({});
    expect(fs.readdirSync(d).some((f) => f.startsWith("integrations.json.corrupt-"))).toBe(true);
  });
});
