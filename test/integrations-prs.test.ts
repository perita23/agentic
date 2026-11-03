import { execFileSync } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext, type Context } from "@/lib/server/context";
import { splitUnifiedDiff } from "@/lib/server/integrations/pulls";
import { FAKE_CLAUDE, tmpDir } from "./helpers";

const calls: { method: string; path: string; body: unknown; auth?: string }[] = [];
let server: http.Server;
let base = "";
const HEAD = "abc1234def5678";

const DIFF = "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/README.md b/README.md\n@@ -0,0 +1 @@\n+hola\n";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const url = new URL(req.url!, "http://x");
      const p = url.pathname;
      calls.push({ method: req.method!, path: p, body: raw ? JSON.parse(raw) : null, auth: req.headers.authorization });
      const json = (o: unknown, status = 200) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(o));
      };
      // ---- GitHub ----
      if (p.startsWith("/gh/")) {
        if (req.headers.authorization !== "Bearer ghp_test") return json({ message: "Bad credentials" }, 401);
        const pr = { number: 7, title: "Add login", user: { login: "ana" }, head: { ref: "feat/login", sha: HEAD }, base: { ref: "main" }, updated_at: "2026-11-02T10:00:00Z", html_url: "https://github.com/acme/web/pull/7", state: "open", draft: false, body: "Descripción", mergeable: true, mergeable_state: "clean", comments: 1 };
        if (p === "/gh/user") return json({ login: "agentic" });
        if (p === "/gh/repos/acme/web/pulls" && req.method === "GET") return json([pr]);
        if (p === "/gh/repos/acme/web/pulls/7" && req.method === "GET") return json(pr);
        if (p === "/gh/repos/acme/web/pulls/7/files") return json([{ filename: "src/app.ts", status: "modified", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-old\n+new" }]);
        if (p === "/gh/repos/acme/web/pulls/7/reviews" && req.method === "GET") return json([{ user: { login: "luis" }, state: "APPROVED", body: "LGTM", submitted_at: "2026-11-02T11:00:00Z" }, { user: { login: "x" }, state: "PENDING" }]);
        if (p === "/gh/repos/acme/web/issues/7/comments" && req.method === "GET") return json([{ user: { login: "ana" }, body: "¿Lo miras?", created_at: "2026-11-02T10:30:00Z" }]);
        if (p === `/gh/repos/acme/web/commits/${HEAD}/check-runs`) return json({ check_runs: [{ name: "CI", status: "completed", conclusion: "success", html_url: "https://ci" }, { name: "lint", status: "in_progress" }] });
        if (p === `/gh/repos/acme/web/commits/${HEAD}/status`) return json({ statuses: [{ context: "deploy", state: "failure" }] });
        if (p === "/gh/repos/acme/web/pulls/7/merge") return (JSON.parse(raw).sha === HEAD ? json({ merged: true }) : json({ message: "Head branch was modified" }, 409));
        return json({ ok: true }, 201);
      }
      // ---- Bitbucket ----
      if (p.startsWith("/bb/")) {
        const pr = { id: 3, title: "Fix API", author: { display_name: "Marta" }, source: { branch: { name: "fix/api" }, commit: { hash: "fedcba987654" } }, destination: { branch: { name: "main" } }, updated_on: "2026-11-03T09:00:00Z", links: { html: { href: "https://bitbucket.org/team/api/pull-requests/3" } }, state: "OPEN", comment_count: 0, description: "Arregla la API", participants: [{ user: { display_name: "Pablo" }, approved: true }] };
        if (p === "/bb/repositories/team/api/pullrequests" && req.method === "GET") return json({ values: [pr] });
        if (p === "/bb/repositories/team/api/pullrequests/3" && req.method === "GET") return json(pr);
        if (p === "/bb/repositories/team/api/pullrequests/3/diffstat") return json({ values: [{ status: "modified", lines_added: 1, lines_removed: 1, new: { path: "src/app.ts" } }] });
        if (p === "/bb/repositories/team/api/pullrequests/3/comments" && req.method === "GET") return json({ values: [{ user: { display_name: "Pablo" }, content: { raw: "ok" }, created_on: "2026-11-03T09:10:00Z" }, { deleted: true, content: { raw: "x" } }] });
        if (p === "/bb/repositories/team/api/pullrequests/3/statuses") return json({ values: [{ name: "Pipelines", state: "SUCCESSFUL" }] });
        if (p === "/bb/repositories/team/api/pullrequests/3/diff") {
          res.writeHead(302, { location: "/bb/repositories/team/api/diff/raw" });
          return res.end();
        }
        if (p === "/bb/repositories/team/api/diff/raw") {
          res.writeHead(200, { "content-type": "text/plain" });
          return res.end(DIFF);
        }
        return json({ ok: true });
      }
      json({}, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.AGENTIC_ALLOW_INSECURE_INTEGRATIONS = "1";
});
afterAll(() => {
  server.close();
  delete process.env.AGENTIC_ALLOW_INSECURE_INTEGRATIONS;
});

function repoWithRemote(remote: string) {
  const dir = tmpDir("prs-repo-");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", remote], { cwd: dir });
  return dir;
}

function setup(): Context {
  const c = createContext({ dataDir: tmpDir(), claudeHome: tmpDir(), claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 2, maxLogBytes: 1e6 });
  c.integrations.configure("github", { token: "ghp_test", apiUrl: `${base}/gh` });
  c.integrations.configure("bitbucket", { token: "bb_test", apiUrl: `${base}/bb` });
  c.projects.create({ path: repoWithRemote("https://127.0.0.1/acme/web.git") });
  c.projects.create({ path: repoWithRemote("git@bitbucket.org:team/api.git") });
  c.projects.create({ path: repoWithRemote("https://gitlab.com/other/thing.git") });
  return c;
}

describe("PullService", () => {
  it("builds one inbox from GitHub and Bitbucket repos of known projects", async () => {
    const c = setup();
    const { items, errors } = await c.pulls.inbox();
    expect(errors).toEqual([]);
    expect(items.map((i) => `${i.provider}:${i.owner}/${i.repo}#${i.number}`)).toEqual(["bitbucket:team/api#3", "github:acme/web#7"]);
    expect(items[1]).toMatchObject({ title: "Add login", author: "ana", branch: "feat/login", base: "main" });
  });

  it("returns GitHub detail with checks, reviews, comments and patches", async () => {
    const c = setup();
    const d = await c.pulls.detail("github", "acme", "web", 7);
    expect(d).toMatchObject({ headSha: HEAD, mergeable: true, canMerge: true, body: "Descripción" });
    expect(d.checks.map((x) => `${x.name}:${x.status}`)).toEqual(["CI:success", "lint:pending", "deploy:failure"]);
    expect(d.reviews).toEqual([{ author: "luis", state: "APPROVED", body: "LGTM", at: "2026-11-02T11:00:00Z" }]);
    expect(d.comments_[0].body).toBe("¿Lo miras?");
    expect(d.files[0].patch).toContain("+new");
  });

  it("returns Bitbucket detail, following a same-origin redirect for the diff", async () => {
    const c = setup();
    const d = await c.pulls.detail("bitbucket", "team", "api", 3);
    expect(d).toMatchObject({ headSha: "fedcba987654", author: "Marta", body: "Arregla la API" });
    expect(d.checks).toEqual([{ name: "Pipelines", status: "success", url: null }]);
    expect(d.reviews[0]).toMatchObject({ author: "Pablo", state: "APPROVED" });
    expect(d.comments_).toHaveLength(1);
    expect(d.files[0]).toMatchObject({ file: "src/app.ts", additions: 1 });
    expect(d.files[0].patch).toContain("+new");
  });

  it("comments, reviews, merges (with head check) and closes on GitHub", async () => {
    const c = setup();
    calls.length = 0;
    await c.pulls.action("github", "acme", "web", 7, "comment", { body: "Gracias" });
    await expect(c.pulls.action("github", "acme", "web", 7, "review", { event: "REQUEST_CHANGES", body: "" })).rejects.toMatchObject({ status: 400 });
    await c.pulls.action("github", "acme", "web", 7, "review", { event: "APPROVE" });
    await c.pulls.action("github", "acme", "web", 7, "merge", { method: "squash", expectedHeadSha: HEAD });
    await expect(c.pulls.action("github", "acme", "web", 7, "merge", { method: "squash", expectedHeadSha: "0000000" })).rejects.toMatchObject({ status: 502 });
    await c.pulls.action("github", "acme", "web", 7, "close", {});
    const writes = calls.filter((x) => x.method !== "GET").map((x) => `${x.method} ${x.path} ${JSON.stringify(x.body)}`);
    expect(writes).toEqual([
      'POST /gh/repos/acme/web/issues/7/comments {"body":"Gracias"}',
      'POST /gh/repos/acme/web/pulls/7/reviews {"event":"APPROVE","body":""}',
      `PUT /gh/repos/acme/web/pulls/7/merge {"merge_method":"squash","sha":"${HEAD}"}`,
      'PUT /gh/repos/acme/web/pulls/7/merge {"merge_method":"squash","sha":"0000000"}',
      'PATCH /gh/repos/acme/web/pulls/7 {"state":"closed"}',
    ]);
    expect(calls.every((x) => x.auth === "Bearer ghp_test")).toBe(true);
  });

  it("approves, requests changes, merges and declines on Bitbucket", async () => {
    const c = setup();
    calls.length = 0;
    await c.pulls.action("bitbucket", "team", "api", 3, "review", { event: "APPROVE", body: "bien" });
    await c.pulls.action("bitbucket", "team", "api", 3, "review", { event: "REQUEST_CHANGES", body: "" });
    await expect(c.pulls.action("bitbucket", "team", "api", 3, "merge", { expectedHeadSha: "1111111" })).rejects.toMatchObject({ status: 409 });
    await c.pulls.action("bitbucket", "team", "api", 3, "merge", { method: "merge", expectedHeadSha: "fedcba9" });
    await c.pulls.action("bitbucket", "team", "api", 3, "close", {});
    const writes = calls.filter((x) => x.method !== "GET").map((x) => `${x.method} ${x.path}`);
    expect(writes).toEqual([
      "POST /bb/repositories/team/api/pullrequests/3/comments",
      "POST /bb/repositories/team/api/pullrequests/3/approve",
      "POST /bb/repositories/team/api/pullrequests/3/request-changes",
      "POST /bb/repositories/team/api/pullrequests/3/merge",
      "POST /bb/repositories/team/api/pullrequests/3/decline",
    ]);
    expect(calls.find((x) => x.path.endsWith("/merge"))?.body).toEqual({ type: "pullrequest", merge_strategy: "merge_commit" });
  });

  it("refuses repositories that are not part of a known project, and bad input", async () => {
    const c = setup();
    await expect(c.pulls.detail("github", "someone", "else", 1)).rejects.toMatchObject({ status: 404 });
    await expect(c.pulls.detail("github", "../x", "web", 1)).rejects.toMatchObject({ status: 400 });
    await expect(c.pulls.detail("gitlab", "other", "thing", 1)).rejects.toMatchObject({ status: 404 });
    await expect(c.pulls.detail("github", "acme", "web", -1)).rejects.toMatchObject({ status: 400 });
    await expect(c.pulls.action("github", "acme", "web", 7, "delete-repo", {})).rejects.toMatchObject({ status: 404 });
  });
});

describe("splitUnifiedDiff", () => {
  it("splits per file", () => {
    const m = splitUnifiedDiff(DIFF);
    expect([...m.keys()]).toEqual(["src/app.ts", "README.md"]);
    expect(m.get("README.md")).toContain("+hola");
  });
});
