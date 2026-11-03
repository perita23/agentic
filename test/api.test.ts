import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext, setContext, type Context } from "@/lib/server/context";
import { FAKE_CLAUDE, makeClaudeHome, tmpDir, waitFor } from "./helpers";
import * as tasksRoute from "@/app/api/tasks/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import * as taskRunRoute from "@/app/api/tasks/[id]/run/route";
import * as runsRoute from "@/app/api/runs/route";
import * as runLogRoute from "@/app/api/runs/[id]/log/route";
import * as sessionsRoute from "@/app/api/sessions/route";
import * as sessionRoute from "@/app/api/sessions/[id]/route";
import * as agentsRoute from "@/app/api/agents/route";
import * as agentRoute from "@/app/api/agents/[scope]/[name]/route";
import * as overviewRoute from "@/app/api/overview/route";
import * as projectInfoRoute from "@/app/api/projects/info/route";
import * as instantiateRoute from "@/app/api/templates/[id]/instantiate/route";
import * as authRoute from "@/app/auth/route";
import { NextRequest } from "next/server";

let c: Context;
let projectDir: string;
let ids: { live: string };

beforeAll(() => {
  projectDir = tmpDir("proj-");
  const ch = makeClaudeHome(projectDir);
  ids = { live: ch.live };
  c = createContext({ dataDir: tmpDir(), claudeHome: ch.home, claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 2, maxLogBytes: 1e6 });
  setContext(c);
});
afterAll(() => {
  c.runs.shutdown();
  setContext(undefined);
});

type H = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function call(h: unknown, opts: { method?: string; body?: unknown; params?: Record<string, string>; query?: string; headers?: Record<string, string>; rawBody?: string } = {}) {
  const headers: Record<string, string> = { host: "127.0.0.1:4317", authorization: `Bearer ${c.token}`, ...opts.headers };
  let body: string | undefined = opts.rawBody;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["content-type"] ??= "application/json";
  }
  const req = new Request(`http://127.0.0.1:4317/api/x${opts.query ?? ""}`, { method: opts.method ?? (body !== undefined ? "POST" : "GET"), headers, body });
  const res = await (h as H)(req, { params: Promise.resolve(opts.params ?? {}) });
  return { status: res.status, data: await res.json() };
}

describe("API", () => {
  it("rejects unauthenticated / foreign-host / cross-origin requests", async () => {
    expect((await call(tasksRoute.GET, { headers: { authorization: "" } })).status).toBe(401);
    expect((await call(tasksRoute.GET, { headers: { host: "evil.test" } })).status).toBe(421);
    expect((await call(tasksRoute.POST, { body: { title: "x" }, headers: { origin: "https://evil.test" } })).status).toBe(403);
    expect((await call(tasksRoute.POST, { rawBody: '{"title":"x"}', headers: { "content-type": "text/plain" } })).status).toBe(415);
  });

  it("validates JSON and body size", async () => {
    const bad = await call(tasksRoute.POST, { rawBody: "{nope", headers: { "content-type": "application/json" } });
    expect(bad.status).toBe(400);
    const huge = await call(tasksRoute.POST, { body: { title: "x", description: "y".repeat(1_100_000) } });
    expect(huge.status).toBe(413);
    const invalid = await call(tasksRoute.POST, { body: { title: 5 } });
    expect(invalid.status).toBe(400);
    expect(invalid.data.error).toMatch(/title/);
  });

  it("task CRUD + run with Claude moves it through the board", async () => {
    const created = await call(tasksRoute.POST, { body: { title: "Tarea", projectPath: projectDir, prompt: "hazlo" } });
    expect(created.status).toBe(201);
    const id = created.data.id;
    const patched = await call(taskRoute.PATCH, { method: "PATCH", params: { id }, body: { priority: "high" } });
    expect(patched.data.priority).toBe("high");
    const run = await call(taskRunRoute.POST, { method: "POST", params: { id }, body: { permissionMode: "plan" } });
    expect(run.status).toBe(201);
    expect(run.data.taskId).toBe(id);
    await waitFor(() => c.runs.get(run.data.id).status === "completed");
    expect(c.tasks.get(id).status).toBe("review");
    const log = await call(runLogRoute.GET, { params: { id: run.data.id }, query: "?offset=0" });
    expect(log.data.events.length).toBeGreaterThan(2);
    const del = await call(taskRoute.DELETE, { method: "DELETE", params: { id } });
    expect(del.status).toBe(200);
    expect((await call(taskRoute.GET, { params: { id } })).status).toBe(404);
  });

  it("lists runs and sessions, shows a transcript, overview", async () => {
    expect((await call(runsRoute.GET)).data.runs.length).toBeGreaterThan(0);
    const s = await call(sessionsRoute.GET, { query: "?q=login" });
    expect(s.data.total).toBe(1);
    const t = await call(sessionRoute.GET, { params: { id: ids.live } });
    expect(t.data.messages.length).toBe(3);
    expect((await call(sessionRoute.GET, { params: { id: "../../etc" } })).status).toBe(400);
    const o = await call(overviewRoute.GET);
    expect(o.data.counts.activeSessions).toBe(1);
  });

  it("refuses to start a run for a missing task", async () => {
    const before = c.runs.list().length;
    const r = await call(runsRoute.POST, { body: { projectPath: projectDir, prompt: "x", taskId: "11111111-1111-4111-8111-111111111111" } });
    expect(r.status).toBe(404);
    expect(c.runs.list().length).toBe(before);
  });

  it("instantiates templates", async () => {
    const r = await call(instantiateRoute.POST, { method: "POST", params: { id: "tpl-feature" }, body: { values: { feature: "dark mode" } } });
    expect(r.status).toBe(201);
    expect(r.data.title).toBe("Feature: dark mode");
  });

  it("only writes project agents into known projects", async () => {
    const agent = { name: "helper", description: "d", prompt: "p" };
    const outside = tmpDir();
    expect((await call(agentsRoute.POST, { body: { ...agent, scope: "project", projectPath: outside } })).status).toBe(400);
    expect((await call(agentsRoute.POST, { body: { ...agent, scope: "project", projectPath: projectDir } })).status).toBe(201);
    expect(fs.existsSync(path.join(projectDir, ".claude/agents/helper.md"))).toBe(true);
    expect((await call(agentRoute.DELETE, { method: "DELETE", params: { scope: "project", name: "helper" }, query: `?projectPath=${encodeURIComponent(outside)}` })).status).toBe(400);
    expect((await call(agentRoute.DELETE, { method: "DELETE", params: { scope: "project", name: "helper" }, query: `?projectPath=${encodeURIComponent(projectDir)}` })).status).toBe(200);
  });

  it("project info refuses arbitrary paths", async () => {
    expect((await call(projectInfoRoute.GET, { query: "?path=/etc" })).status).toBe(404);
    expect((await call(projectInfoRoute.GET, { query: `?path=${encodeURIComponent(projectDir)}` })).status).toBe(200);
  });

  it("/auth opens a server-side session (HttpOnly, SameSite=Strict) only for the right token", async () => {
    process.env.AGENTIC_HOME = c.config.dataDir;
    const bad = authRoute.GET(new NextRequest("http://127.0.0.1:4317/auth?token=nope", { headers: { host: "127.0.0.1:4317" } }));
    expect(bad.status).toBe(401);
    const ok = authRoute.GET(new NextRequest(`http://127.0.0.1:4317/auth?token=${c.token}`, { headers: { host: "127.0.0.1:4317" } }));
    expect(ok.status).toBe(303);
    const cookie = ok.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=strict/i);
    const rebind = authRoute.GET(new NextRequest(`http://evil.test/auth?token=${c.token}`, { headers: { host: "evil.test" } }));
    expect(rebind.status).toBe(421);
  });
});
