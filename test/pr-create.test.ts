import { execFileSync } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "@/lib/server/context";
import { FAKE_CLAUDE, tmpDir } from "./helpers";

const posts: { path: string; body: Record<string, unknown> }[] = [];
let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      res.writeHead(201, { "content-type": "application/json" });
      if (req.method === "POST") posts.push({ path: req.url!, body: JSON.parse(raw) });
      if (req.url === "/gh/user") return res.end(JSON.stringify({ login: "me" }));
      if (req.url!.startsWith("/gh/repos/acme/web/collaborators")) return res.end(JSON.stringify([{ login: "ana" }, { login: "me" }, { login: "luis" }]));
      res.end(JSON.stringify({ number: 9, html_url: "https://github.com/acme/web/pull/9" }));
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

const sh = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });

function setup() {
  const bare = tmpDir("pr-bare-");
  sh(bare, "init", "-q", "--bare");
  const repo = tmpDir("pr-repo-");
  sh(repo, "init", "-q", "-b", "main");
  sh(repo, "commit", "-q", "--allow-empty", "-m", "inicio");
  sh(repo, "remote", "add", "origin", "https://127.0.0.1/acme/web.git");
  sh(repo, "config", `url.${bare}.pushInsteadOf`, "https://127.0.0.1/acme/web.git");
  sh(repo, "checkout", "-q", "-b", "feat/login");
  sh(repo, "commit", "-q", "--allow-empty", "-m", "Añade login");
  sh(repo, "checkout", "-q", "-b", "vacia", "main");
  const c = createContext({ dataDir: tmpDir(), claudeHome: tmpDir(), claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 2, maxLogBytes: 1e6 });
  c.integrations.configure("github", { token: "ghp_test", apiUrl: `${base}/gh` });
  c.projects.create({ path: repo });
  return { c, repo, bare };
}

describe("create a PR from the UI", () => {
  it("lists branches with how far ahead they are, and the default base", async () => {
    const { c, repo } = setup();
    const info = await c.pulls.branches(repo);
    expect(info).toMatchObject({ base: "main", current: "vacia", repo: { owner: "acme", repo: "web" } });
    expect(info.branches.find((b) => b.name === "feat/login")).toMatchObject({ ahead: 1, subject: "Añade login" });
    expect(info.branches.find((b) => b.name === "vacia")?.ahead).toBe(0);
  });

  it("pushes the branch and opens the PR", async () => {
    const { c, repo, bare } = setup();
    posts.length = 0;
    const pr = await c.pulls.createFromBranch(repo, { head: "feat/login", base: "main", title: "Añade login", body: "Detalle", draft: true });
    expect(pr).toMatchObject({ provider: "github", number: 9 });
    expect(posts[0]).toMatchObject({ path: "/gh/repos/acme/web/pulls", body: { head: "feat/login", base: "main", title: "Añade login", draft: true } });
    expect(sh(bare, "branch", "--list", "feat/login")).toContain("feat/login");
  });

  it("lists reviewer candidates (not yourself) and asks for the chosen ones on the PR", async () => {
    const { c, repo } = setup();
    expect((await c.pulls.reviewerCandidates(repo)).map((r) => r.id)).toEqual(["ana", "luis"]);
    posts.length = 0;
    await c.pulls.createFromBranch(repo, { head: "feat/login", base: "main", title: "t", reviewers: ["ana", "luis"] });
    expect(posts.find((x) => x.path.endsWith("/requested_reviewers"))?.body).toEqual({ reviewers: ["ana", "luis"] });
    await expect(c.pulls.createFromBranch(repo, { head: "feat/login", base: "main", title: "t", reviewers: ["a b; rm"] })).rejects.toThrow(/Revisor no válido/);
  });

  it("refuses bad input before touching anything", async () => {
    const { c, repo } = setup();
    posts.length = 0;
    const attempt = (b: object) => c.pulls.createFromBranch(repo, { base: "main", title: "t", ...b });
    await expect(attempt({ head: "main" })).rejects.toThrow(/la misma/);
    await expect(attempt({ head: "vacia" })).rejects.toThrow(/no tiene commits nuevos/);
    await expect(attempt({ head: "no-existe" })).rejects.toThrow(/no existe/);
    await expect(attempt({ head: "--upload-pack=x" })).rejects.toThrow(/no válido/);
    await expect(attempt({ head: "a..b" })).rejects.toThrow(/no válido/);
    await expect(attempt({ head: "feat/login", title: "  " })).rejects.toThrow(/título/);
    expect(posts).toHaveLength(0);
  });
});
