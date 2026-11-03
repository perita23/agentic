import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext, type Context } from "@/lib/server/context";
import { adfToText, textToAdf } from "@/lib/server/integrations/jira";
import { FAKE_CLAUDE, tmpDir } from "./helpers";

const calls: { method: string; path: string; body: unknown; auth?: string }[] = [];
let server: http.Server;
let site = "";
const AUTH = `Basic ${Buffer.from("ana@acme.test:jira-token").toString("base64")}`;

const adfDesc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "El login falla" }, { type: "hardBreak" }, { type: "text", text: "con mayúsculas." }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "paso 1" }] }] }] },
    { type: "paragraph", content: [{ type: "mention", attrs: { text: "@Luis" } }, { type: "text", text: " ¿lo miras?" }] },
  ],
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const p = new URL(req.url!, "http://x").pathname;
      calls.push({ method: req.method!, path: p, body: raw ? JSON.parse(raw) : null, auth: req.headers.authorization });
      const json = (o: unknown, status = 200) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(o === undefined ? "" : JSON.stringify(o));
      };
      if (req.headers.authorization !== AUTH) return json({ errorMessages: ["unauthorized"] }, 401);
      const fields = { summary: "Login roto", status: { name: "To Do", statusCategory: { key: "new" } }, priority: { name: "Highest" }, issuetype: { name: "Bug" }, assignee: { displayName: "Ana" }, updated: "2026-11-03T08:00:00.000+0000", project: { key: "WEB" } };
      if (p === "/rest/api/3/myself") return json({ displayName: "Ana" });
      if (p === "/rest/api/3/search/jql") return json({ issues: [{ id: "1", key: "WEB-42", fields }] });
      if (p === "/rest/api/3/issue/WEB-42" && req.method === "GET")
        return json({ key: "WEB-42", fields: { ...fields, description: adfDesc, reporter: { displayName: "Luis" }, created: "2026-11-01T08:00:00.000+0000", labels: ["auth"], comment: { comments: [{ author: { displayName: "Luis" }, body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Confirmado" }] }] }, created: "2026-11-02" }] } } });
      if (p === "/rest/api/3/issue/WEB-42/transitions" && req.method === "GET") return json({ transitions: [{ id: "21", name: "Empezar", to: { name: "In Progress", statusCategory: { key: "indeterminate" } } }] });
      if (req.method === "POST") return json(undefined, 204);
      json({ errorMessages: ["not found"] }, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  site = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.AGENTIC_ALLOW_INSECURE_INTEGRATIONS = "1";
});
afterAll(() => {
  server.close();
  delete process.env.AGENTIC_ALLOW_INSECURE_INTEGRATIONS;
});

function setup(): Context {
  const c = createContext({ dataDir: tmpDir(), claudeHome: tmpDir(), claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 2, maxLogBytes: 1e6 });
  c.integrations.configure("jira", { siteUrl: `${site}/some/path?x=1`, email: "ana@acme.test", token: "jira-token" });
  return c;
}

describe("ADF conversion", () => {
  it("renders ADF as readable plain text", () => {
    expect(adfToText(adfDesc).trim()).toBe("El login falla\ncon mayúsculas.\n\n- paso 1\n\n@Luis ¿lo miras?");
    expect(adfToText(null)).toBe("");
    expect(adfToText({ type: "paragraph", content: [{ type: "text", text: "<script>" }] })).toContain("<script>"); // text, never HTML
  });
  it("builds ADF paragraphs with hard breaks", () => {
    expect(textToAdf("a\nb\n\nc")).toEqual({
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }] },
        { type: "paragraph", content: [{ type: "text", text: "c" }] },
      ],
    });
  });
});

describe("JiraService", () => {
  it("normalises the site URL and tests the connection", async () => {
    const c = setup();
    expect(c.integrations.status().jira).toMatchObject({ configured: true, siteUrl: site, email: "ana@acme.test" });
    expect(await c.integrations.test("jira")).toEqual({ ok: true, account: "Ana" });
  });

  it("searches by JQL and returns issue details", async () => {
    const c = setup();
    calls.length = 0;
    const { issues } = await c.jira.search({ jql: "assignee = currentUser()" });
    expect(issues[0]).toMatchObject({ key: "WEB-42", summary: "Login roto", status: "To Do", statusCategory: "new", priority: "Highest", url: `${site}/browse/WEB-42`, imported: null });
    expect(calls[0].body).toMatchObject({ jql: "assignee = currentUser()", maxResults: 50 });
    const d = await c.jira.detail("WEB-42");
    expect(d.description).toContain("con mayúsculas.");
    expect(d.comments).toEqual([{ author: "Luis", body: "Confirmado", at: "2026-11-02" }]);
    expect(d.transitions).toEqual([{ id: "21", name: "Empezar", to: "In Progress", category: "indeterminate" }]);
    expect(calls.every((x) => x.auth === AUTH)).toBe(true);
  });

  it("comments in ADF and only applies transitions Jira offers", async () => {
    const c = setup();
    calls.length = 0;
    await c.jira.comment("WEB-42", { body: "Lo miro hoy" });
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/rest/api/3/issue/WEB-42/comment" });
    expect((calls.at(-1)!.body as { body: unknown }).body).toEqual(textToAdf("Lo miro hoy"));
    await c.jira.transition("WEB-42", { transitionId: "21" });
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/rest/api/3/issue/WEB-42/transitions", body: { transition: { id: "21" } } });
    await expect(c.jira.transition("WEB-42", { transitionId: "99" })).rejects.toMatchObject({ status: 409 });
  });

  it("imports an issue once as a linked task", async () => {
    const c = setup();
    const proj = tmpDir();
    const a = await c.jira.importIssue("WEB-42", { projectPath: proj });
    expect(a.created).toBe(true);
    expect(a.task).toMatchObject({ title: "WEB-42 Login roto", priority: "urgent", labels: ["jira", "auth"], external: { provider: "jira", id: "WEB-42" } });
    const b = await c.jira.importIssue("WEB-42", {});
    expect(b).toMatchObject({ created: false, task: { id: a.task.id } });
    expect((await c.jira.search({ jql: "x" })).issues[0].imported).toBe(a.task.id);
  });

  it("validates keys and input", async () => {
    const c = setup();
    for (const k of ["web-1", "WEB-", "../WEB-1", "WEB-1/comment"]) await expect(c.jira.detail(k)).rejects.toMatchObject({ status: 400 });
    await expect(c.jira.search({ jql: "" })).rejects.toMatchObject({ status: 400 });
    await expect(c.jira.comment("WEB-42", { body: "  " })).rejects.toMatchObject({ status: 400 });
    await expect(c.jira.transition("WEB-42", { transitionId: "1; drop" })).rejects.toMatchObject({ status: 400 });
    expect(() => c.integrations.configure("jira", { siteUrl: "ftp://x", email: "a@b.c", token: "t" })).toThrow();
  });
});
