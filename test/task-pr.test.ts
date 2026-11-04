import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext, setContext, type Context } from "@/lib/server/context";
import * as taskRunRoute from "@/app/api/tasks/[id]/run/route";
import * as prRoute from "@/app/api/tasks/[id]/worktree/pr/route";
import { FAKE_CLAUDE, tmpDir, waitFor } from "./helpers";

const created: Record<string, unknown>[] = [];
let server: http.Server;
let c: Context;
let repo: string;
let bare: string;
const g = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      res.writeHead(req.url === "/gh/repos/acme/web/pulls" && req.method === "POST" ? 201 : 404, { "content-type": "application/json" });
      if (req.url === "/gh/repos/acme/web/pulls" && req.method === "POST") {
        created.push(JSON.parse(raw));
        return res.end(JSON.stringify({ number: 42, html_url: "https://github.example/acme/web/pull/42" }));
      }
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.AGENTIC_ALLOW_INSECURE_INTEGRATIONS = "1";

  bare = fs.realpathSync(tmpDir("bare-"));
  g(bare, "init", "-q", "--bare");
  repo = fs.realpathSync(tmpDir("repo-"));
  g(repo, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "a.txt"), "hola\n");
  g(repo, "add", ".");
  g(repo, "commit", "-qm", "init");
  // The remote looks like GitHub (so the PR goes there) but pushes land in a local bare repo.
  g(repo, "remote", "add", "origin", "https://127.0.0.1/acme/web.git");
  g(repo, "config", `url.${bare}.pushInsteadOf`, "https://127.0.0.1/acme/web.git");

  c = createContext({ dataDir: tmpDir(), claudeHome: tmpDir(), claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 2, maxLogBytes: 1e6 });
  c.integrations.configure("github", { token: "ghp_test", apiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/gh` });
  c.projects.create({ path: repo, name: "web" });
  setContext(c);
});
afterAll(() => {
  server.close();
  c.runs.shutdown();
  setContext(undefined);
  delete process.env.AGENTIC_ALLOW_INSECURE_INTEGRATIONS;
});

type H = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function call(h: unknown, id: string, body: unknown) {
  const req = new Request("http://127.0.0.1:4317/api/x", { method: "POST", headers: { host: "127.0.0.1:4317", authorization: `Bearer ${c.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const res = await (h as H)(req, { params: Promise.resolve({ id }) });
  return { status: res.status, data: await res.json() };
}

describe("PR from a task worktree", () => {
  it("commits pending work, pushes the branch and opens the PR", async () => {
    const task = c.tasks.create({ title: "Saludo nuevo", projectPath: repo, prompt: "x" });
    const run = await call(taskRunRoute.POST, task.id, { worktree: true, permissionMode: "plan" });
    await waitFor(() => c.runs.get(run.data.id).status !== "running");
    const wt = c.tasks.get(task.id).worktree!;

    // Nothing changed yet → refused, nothing pushed.
    const empty = await call(prRoute.POST, task.id, { title: "Saludo nuevo" });
    expect(empty.status).toBe(400);

    fs.writeFileSync(path.join(wt.path, "b.txt"), "nuevo\n");
    const res = await call(prRoute.POST, task.id, { title: "Saludo nuevo", body: "Hecho con Agentic", draft: true });
    expect(res.status).toBe(200);
    expect(res.data.pullRequest).toMatchObject({ provider: "github", number: 42, url: "https://github.example/acme/web/pull/42" });
    expect(res.data.status).toBe("review");
    expect(created[0]).toEqual({ title: "Saludo nuevo", head: wt.branch, base: "main", body: "Hecho con Agentic", draft: true });
    // The commit reached the remote branch, and the user's checkout is untouched.
    expect(g(bare, "log", "--format=%s", "-1", wt.branch).trim()).toBe("Saludo nuevo");
    expect(fs.existsSync(path.join(repo, "b.txt"))).toBe(false);

    const again = await call(prRoute.POST, task.id, { title: "otra" });
    expect(again.status).toBe(409);
  });
});
