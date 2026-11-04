import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext, setContext, type Context } from "@/lib/server/context";
import { slugify } from "@/lib/server/worktrees";
import * as tasksRoute from "@/app/api/tasks/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import * as taskRunRoute from "@/app/api/tasks/[id]/run/route";
import * as worktreeRoute from "@/app/api/tasks/[id]/worktree/route";
import { FAKE_CLAUDE, makeClaudeHome, tmpDir, waitFor } from "./helpers";

let c: Context;
let repo: string;
const g = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });

beforeAll(() => {
  repo = fs.realpathSync(tmpDir("repo-"));
  g(repo, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "a.txt"), "hola\n");
  g(repo, "add", ".");
  g(repo, "commit", "-qm", "init");
  const ch = makeClaudeHome(repo);
  c = createContext({ dataDir: tmpDir(), claudeHome: ch.home, claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 2, maxLogBytes: 1e6 });
  c.projects.create({ path: repo, name: "repo" });
  setContext(c);
});
afterAll(() => {
  c.runs.shutdown();
  setContext(undefined);
});

type H = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function call(h: unknown, opts: { method?: string; body?: unknown; params?: Record<string, string>; query?: string } = {}) {
  const headers: Record<string, string> = { host: "127.0.0.1:4317", authorization: `Bearer ${c.token}` };
  let body: string | undefined;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["content-type"] = "application/json";
  }
  const req = new Request(`http://127.0.0.1:4317/api/x${opts.query ?? ""}`, { method: opts.method ?? (body !== undefined ? "POST" : "GET"), headers, body });
  const res = await (h as H)(req, { params: Promise.resolve(opts.params ?? {}) });
  return { status: res.status, data: await res.json() };
}

describe("task worktrees", () => {
  it("slugifies titles for branch names", () => {
    expect(slugify("Arreglar el Login (móvil)!")).toBe("arreglar-el-login-movil");
    expect(slugify("¿¿??")).toBe("tarea");
  });

  it("runs a task in its own worktree and branch, reuses it, and removes it keeping the branch", async () => {
    const task = (await call(tasksRoute.POST, { body: { title: "Añadir tests", projectPath: repo, prompt: "hazlo" } })).data;
    const run = await call(taskRunRoute.POST, { params: { id: task.id }, body: { worktree: true, permissionMode: "plan" } });
    expect(run.status).toBe(201);
    const wt = c.tasks.get(task.id).worktree!;
    expect(wt.branch).toBe(`agentic/anadir-tests-${task.id.slice(0, 8)}`);
    expect(wt.base).toBe("main");
    expect(run.data.projectPath).toBe(wt.path);
    expect(fs.existsSync(path.join(wt.path, "a.txt"))).toBe(true);
    // The user's checkout is untouched.
    expect(g(repo, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("main");
    await waitFor(() => c.runs.get(run.data.id).status !== "running");

    // Work in the worktree shows up in its status.
    fs.writeFileSync(path.join(wt.path, "b.txt"), "nuevo\n");
    g(wt.path, "add", "b.txt");
    g(wt.path, "commit", "-qm", "add b");
    fs.writeFileSync(path.join(wt.path, "c.txt"), "sin commit\n");
    const st = (await call(worktreeRoute.GET, { params: { id: task.id } })).data;
    expect(st.status).toMatchObject({ exists: true, ahead: 1, changedFiles: ["c.txt"] });
    expect(st.status.commits[0].subject).toBe("add b");

    // Running again reuses the same worktree.
    const again = await call(taskRunRoute.POST, { params: { id: task.id }, body: { worktree: true, permissionMode: "plan" } });
    expect(again.data.projectPath).toBe(wt.path);
    await waitFor(() => c.runs.get(again.data.id).status !== "running");

    // Worktrees never show up as projects.
    expect(c.projects.list().some((p) => p.path.startsWith(path.dirname(path.dirname(wt.path))))).toBe(false);

    const del = await call(worktreeRoute.DELETE, { method: "DELETE", params: { id: task.id } });
    expect(del.status).toBe(200);
    expect(fs.existsSync(wt.path)).toBe(false);
    expect(c.tasks.get(task.id).worktree).toBeNull();
    expect(g(repo, "branch", "--list", wt.branch).trim()).toContain(wt.branch);

    // A new worktree for the same task picks the kept branch (with its commit) back up.
    await call(taskRunRoute.POST, { params: { id: task.id }, body: { worktree: true, permissionMode: "plan" } });
    const wt2 = c.tasks.get(task.id).worktree!;
    expect(fs.existsSync(path.join(wt2.path, "b.txt"))).toBe(true);
    await waitFor(() => c.runs.list().every((r) => r.status !== "running"));
    expect((await call(taskRoute.DELETE, { method: "DELETE", params: { id: task.id } })).status).toBe(200);
    expect(fs.existsSync(wt2.path)).toBe(false);
  });

  it("runs in the same subfolder when the project is part of a monorepo", async () => {
    const pkg = path.join(repo, "packages", "web");
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, "index.js"), "1\n");
    g(repo, "add", ".");
    g(repo, "commit", "-qm", "pkg");
    c.projects.create({ path: pkg, name: "web" });
    const task = (await call(tasksRoute.POST, { body: { title: "web", projectPath: pkg, prompt: "x" } })).data;
    const run = await call(taskRunRoute.POST, { params: { id: task.id }, body: { worktree: true, permissionMode: "plan" } });
    const wt = c.tasks.get(task.id).worktree!;
    expect(run.data.projectPath).toBe(path.join(wt.path, "packages", "web"));
    await waitFor(() => c.runs.get(run.data.id).status !== "running");
  });

  it("refuses worktrees outside git repos", async () => {
    const plain = fs.realpathSync(tmpDir("plain-"));
    c.projects.create({ path: plain, name: "plain" });
    const task = (await call(tasksRoute.POST, { body: { title: "x", projectPath: plain } })).data;
    const res = await call(taskRunRoute.POST, { params: { id: task.id }, body: { worktree: true } });
    expect(res.status).toBe(400);
    expect(res.data.error).toMatch(/git/);
  });
});
