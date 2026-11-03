#!/usr/bin/env node
// End-to-end smoke test: boots the production build against a throw-away
// AGENTIC_HOME, a fake ~/.claude and a fake `claude` binary, then drives the
// UI in headless Chromium. Usage: npm run build && npm run smoke [-- --shots dir]
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require(execFileSync("npm", ["root", "-g"]).toString().trim() + "/playwright"));
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotsIdx = process.argv.indexOf("--shots");
const shots = shotsIdx > 0 ? path.resolve(process.argv[shotsIdx + 1]) : null;
if (shots) fs.mkdirSync(shots, { recursive: true });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-smoke-"));
const dataDir = path.join(tmp, "data");
const claudeHome = path.join(tmp, "claude");
const project = path.join(tmp, "demo-app");
fs.mkdirSync(project, { recursive: true });
fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "demo-app", scripts: { dev: "next dev", test: "vitest" } }));
fs.writeFileSync(path.join(project, "CLAUDE.md"), "# Demo app\n\n- Usa TypeScript estricto.\n");
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: project });
execFileSync("git", ["-c", "user.name=demo", "-c", "user.email=d@d", "add", "."], { cwd: project });
execFileSync("git", ["-c", "user.name=demo", "-c", "user.email=d@d", "commit", "-qm", "Initial commit"], { cwd: project });
execFileSync("git", ["remote", "add", "origin", "https://127.0.0.1/acme/demo.git"], { cwd: project });

const enc = project.replace(/\//g, "-");
fs.mkdirSync(path.join(claudeHome, "projects", enc), { recursive: true });
fs.mkdirSync(path.join(claudeHome, "sessions"), { recursive: true });
const sid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const lines = [
  { type: "user", cwd: project, gitBranch: "main", version: "2.1.0", timestamp: new Date().toISOString(), message: { role: "user", content: "Añade modo oscuro al dashboard" } },
  { type: "assistant", timestamp: new Date().toISOString(), message: { model: "claude-sonnet", content: [{ type: "text", text: "Claro, voy a revisar los estilos." }, { type: "tool_use", name: "Read", input: { file_path: "src/app.css" } }], usage: { input_tokens: 1200, output_tokens: 300 } } },
];
fs.writeFileSync(path.join(claudeHome, "projects", enc, `${sid}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
fs.writeFileSync(path.join(claudeHome, "sessions", `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: sid, cwd: project, status: "busy", name: "demo-app", entrypoint: "cli", startedAt: Date.now(), updatedAt: Date.now() }));


// Minimal Slack Web API stand-in so integrations can be exercised end to end.
const slackPosted = [];
const slack = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (o) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(o));
  };
  if (req.headers.authorization !== "Bearer xoxb-smoke-token") return send({ ok: false, error: "invalid_auth" });
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const routes = {
      "/auth.test": () => ({ ok: true, user: "agentic", team: "Smoke" }),
      "/users.list": () => ({ ok: true, members: [{ id: "U01ANA", name: "ana", profile: { display_name: "Ana" } }] }),
      "/conversations.list": () => ({ ok: true, channels: [{ id: "C01DEV", name: "dev", is_private: false, is_member: true, topic: { value: "Equipo" } }] }),
      "/conversations.history": () => ({ ok: true, messages: [{ ts: "1700000000.000100", user: "U01ANA", text: "¿Alguien revisa la PR <@U01ANA>?", reply_count: 0 }] }),
      "/conversations.replies": () => ({ ok: true, messages: [{ ts: url.searchParams.get("ts"), user: "U01ANA", text: "¿Alguien revisa la PR?" }] }),
      "/chat.postMessage": () => {
        slackPosted.push(JSON.parse(body));
        return { ok: true, ts: "1700000001.000100" };
      },
    };
    send((routes[url.pathname] ?? (() => ({ ok: false, error: "unknown_method" })))());
  });
});
await new Promise((r) => slack.listen(0, "127.0.0.1", r));
const slackUrl = `http://127.0.0.1:${slack.address().port}/`;


// Minimal GitHub REST stand-in for the pull request flow.
const ghWrites = [];
const PR_SHA = "0123456789abcdef0123456789abcdef01234567";
const github = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const p = new URL(req.url, "http://x").pathname;
    const json = (o, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(o));
    };
    if (req.headers.authorization !== "Bearer ghp_smoke") return json({ message: "Bad credentials" }, 401);
    if (req.method !== "GET") ghWrites.push({ method: req.method, path: p, body: body ? JSON.parse(body) : null });
    const pr = { number: 12, title: "Añade modo oscuro", user: { login: "ana" }, head: { ref: "feat/dark", sha: PR_SHA }, base: { ref: "main" }, updated_at: new Date().toISOString(), html_url: "https://github.com/acme/demo/pull/12", state: "open", draft: false, body: "Implementa el tema oscuro.", mergeable: true, comments: 0 };
    const routes = {
      "/user": () => ({ login: "smoke" }),
      "/repos/acme/demo/pulls": () => [pr],
      "/repos/acme/demo/pulls/12": () => pr,
      "/repos/acme/demo/pulls/12/files": () => [{ filename: "src/theme.css", status: "modified", additions: 2, deletions: 0, patch: "@@ -1 +1,3 @@\n body {}\n+.dark { color: white }\n+.dark a {}" }],
      "/repos/acme/demo/pulls/12/reviews": () => (req.method === "GET" ? [] : { id: 1 }),
      "/repos/acme/demo/issues/12/comments": () => [],
      [`/repos/acme/demo/commits/${PR_SHA}/check-runs`]: () => ({ check_runs: [{ name: "CI", status: "completed", conclusion: "success" }] }),
      [`/repos/acme/demo/commits/${PR_SHA}/status`]: () => ({ statuses: [] }),
      "/repos/acme/demo/pulls/12/merge": () => ({ merged: true }),
    };
    const fn = routes[p];
    return fn ? json(fn()) : json({ message: "Not Found" }, 404);
  });
});
await new Promise((r) => github.listen(0, "127.0.0.1", r));
const githubUrl = `http://127.0.0.1:${github.address().port}`;


// Minimal Jira Cloud stand-in.
const jiraWrites = [];
const jira = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const p = new URL(req.url, "http://x").pathname;
    const json = (o, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(o === undefined ? "" : JSON.stringify(o));
    };
    if (req.headers.authorization !== `Basic ${Buffer.from("ana@acme.test:jira-smoke").toString("base64")}`) return json({}, 401);
    if (req.method === "POST" && p !== "/rest/api/3/search/jql") {
      jiraWrites.push({ path: p, body: JSON.parse(body) });
      return json(undefined, 204);
    }
    const fields = { summary: "El checkout falla en Safari", status: { name: "To Do", statusCategory: { key: "new" } }, priority: { name: "High" }, issuetype: { name: "Bug" }, assignee: { displayName: "Ana" }, updated: new Date().toISOString() };
    if (p === "/rest/api/3/myself") return json({ displayName: "Ana" });
    if (p === "/rest/api/3/search/jql") return json({ issues: [{ key: "SHOP-7", fields }] });
    if (p === "/rest/api/3/issue/SHOP-7") return json({ key: "SHOP-7", fields: { ...fields, description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Al pagar con Safari 17 aparece un error 500." }] }] }, labels: ["checkout"], comment: { comments: [] } } });
    if (p === "/rest/api/3/issue/SHOP-7/transitions") return json({ transitions: [{ id: "31", name: "Empezar", to: { name: "In Progress", statusCategory: { key: "indeterminate" } } }] });
    json({}, 404);
  });
});
await new Promise((r) => jira.listen(0, "127.0.0.1", r));
const jiraUrl = `http://127.0.0.1:${jira.address().port}`;

const port = 4400 + Math.floor(Math.random() * 500);
// localhost (not 127.0.0.1): WebAuthn / Touch ID requires a domain.
const base = `http://localhost:${port}`;
const env = { ...process.env, AGENTIC_HOME: dataDir, CLAUDE_HOME: claudeHome, CLAUDE_BIN: path.join(root, "test/fixtures/fake-claude.mjs"), PORT: String(port), HOST: "127.0.0.1", AGENTIC_ALLOW_INSECURE_INTEGRATIONS: "1", AGENTIC_SLACK_API_URL: slackUrl };
const server = spawn(process.execPath, [path.join(root, "scripts/agentic.mjs"), "start"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let out = "";
server.stdout.on("data", (d) => (out += d));
server.stderr.on("data", (d) => (out += d));

const failures = [];
const check = (cond, msg) => {
  if (cond) console.log("  ✓", msg);
  else {
    console.log("  ✗", msg);
    failures.push(msg);
  }
};


async function waitUntil(fn, ms = 10000) {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error("waitUntil timeout");
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(base);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("server did not start:\n" + out);
}

let browser;
try {
  await waitUp();
  const token = fs.readFileSync(path.join(dataDir, "token"), "utf8").trim();
  console.log("HTTP security");
  let r = await fetch(base + "/", { redirect: "manual" });
  check(r.status === 303 && (r.headers.get("location") || "").includes("/login"), "page without session -> redirect to /login");
  r = await fetch(base + "/api/tasks");
  check(r.status === 401, "API without token -> 401");
  // fetch() cannot override Host, so use a raw HTTP request.
  const rebindStatus = await new Promise((resolve, reject) =>
    http
      .get({ host: "127.0.0.1", port, path: "/api/tasks", headers: { host: `evil.example:${port}`, authorization: `Bearer ${token}` } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .on("error", reject),
  );
  check(rebindStatus === 421, "foreign Host header -> 421 (DNS rebinding)");
  r = await fetch(base + "/api/tasks", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "text/plain" }, body: '{"title":"x"}' });
  check(r.status === 415, "text/plain POST -> 415 (CSRF)");
  r = await fetch(base + "/api/tasks", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", origin: "https://evil.example" }, body: '{"title":"x"}' });
  check(r.status === 403, "cross-origin POST -> 403");
  r = await fetch(base + "/auth?token=wrong", { redirect: "manual" });
  check(r.status === 401, "/auth with wrong token -> 401");
  r = await fetch(base + `/auth?token=${token}`, { redirect: "manual" });
  const setCookie = r.headers.get("set-cookie") || "";
  check(r.status === 303 && /agentic_session=[0-9a-f]{64}/.test(setCookie) && /HttpOnly/i.test(setCookie) && !setCookie.includes(token), "/auth opens a server-side session (cookie is not the token)");
  r = await fetch(base + "/", { headers: { authorization: `Bearer ${token}` } });
  const csp = r.headers.get("content-security-policy") || "";
  check(/script-src 'self' 'nonce-/.test(csp) && !csp.includes("unsafe-eval"), "strict CSP with nonce, no unsafe-eval");
  check(r.headers.get("x-frame-options") === "DENY", "X-Frame-Options DENY");
  check(!r.headers.get("x-powered-by"), "no X-Powered-By");

  console.log("UI");
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: shots ? 2 : 1 });
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  const shot = async (name) => shots && page.screenshot({ path: path.join(shots, `${name}.png`) });

  await page.goto(`${base}/auth?token=${token}`);
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  await page.getByText("Procesos de Claude Code en vivo").waitFor();
  await page.getByText("demo-app").first().waitFor();
  check(true, "dashboard renders with live process");
  await page.waitForTimeout(600);
  await shot("01-dashboard");

  // macOS app: what the Electron preload does. The brand must clear the traffic
  // lights (≈ 18–70px) and the top bars must drag the window, except controls.
  const chrome = await page.evaluate(() => {
    document.documentElement.dataset.desktop = "mac";
    const brand = document.querySelector("aside a[href='/']").getBoundingClientRect();
    const bar = getComputedStyle(document.querySelector("header.app-drag"));
    const btn = getComputedStyle(document.querySelector("header.app-drag button"));
    return { brandLeft: brand.left, bar: bar.getPropertyValue("app-region") || bar.webkitAppRegion, btn: btn.getPropertyValue("app-region") || btn.webkitAppRegion };
  });
  check(chrome.brandLeft >= 80 && chrome.bar === "drag" && chrome.btn === "no-drag", `macOS window chrome: brand clears traffic lights, top bar drags (${JSON.stringify(chrome)})`);
  await shot("01b-dashboard-macos");
  await page.evaluate(() => delete document.documentElement.dataset.desktop);

  await page.goto(`${base}/sessions`);
  await page.getByText("Añade modo oscuro al dashboard").first().click();
  await page.getByText("Claro, voy a revisar los estilos.").waitFor();
  check(true, "session transcript renders");
  await page.goto(`${base}/sessions`);
  await page.getByRole("button", { name: "En el contenido" }).click();
  await page.getByPlaceholder("Buscar dentro de las conversaciones…").fill("revisar los estilos");
  await page.locator("main mark").first().waitFor();
  check((await page.locator("main mark").first().textContent()) === "revisar los estilos", "full-text search highlights matches in replies");
  await shot("02-session");

  // Launch a headless run through the UI.
  await page.goto(`${base}/projects`);
  await page.getByText("demo-app").first().click();
  await page.getByText("Usa TypeScript estricto", { exact: false }).count();
  await page.getByRole("button", { name: "Nueva sesión aquí" }).click();
  await page.getByLabel("Prompt").fill("Escribe tests para el login EDIT");
  await page.getByRole("button", { name: "Lanzar", exact: true }).click();
  await page.waitForURL(/\/runs\/[0-9a-f-]{36}$/);
  await page.getByText("done: Escribe tests para el login EDIT").waitFor({ timeout: 15000 });
  check(true, "headless run launched from UI and finished with result");
  await page.getByText("Ejecución completada").waitFor({ timeout: 10000 });
  check(true, "finished run triggers a notification toast");
  await page.getByRole("tab", { name: "Cambios" }).click();
  await page.locator("main").getByText("created-by-claude.txt").waitFor({ timeout: 10000 });
  await page.locator("main").getByText("+hello from claude").waitFor();
  check(await page.locator("main").getByText("+2", { exact: true }).isVisible(), "diff summary counts lines of new files");
  check(true, "run diff tab shows files created by Claude");
  await shot("03b-run-diff");
  await shot("03-run");

  // Stop a long-running run from the UI (regression: body-less POSTs were rejected with 415).
  const longRun = await (
    await fetch(base + "/api/runs", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ projectPath: project, prompt: "SLEEP" }) })
  ).json();
  await page.goto(`${base}/runs/${longRun.id}`);
  await page.getByText("en vivo").waitFor({ timeout: 10000 });
  await page.locator("main").getByText("some stderr line").waitFor({ timeout: 10000 });
  check((await fetch(base + `/api/runs/${longRun.id}`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json())).status === "running", "live log streams over SSE while the run is still running");
  await page.getByRole("button", { name: "Detener" }).click();
  await page.locator("main").getByText("detenida", { exact: true }).waitFor({ timeout: 15000 });
  check(true, "stop a running run from the UI");

  // Tasks: create from template, then see it on the board.
  await page.goto(`${base}/tasks`);
  await page.getByRole("button", { name: "Desde plantilla" }).click();
  await page.getByText("Corregir bug").click();
  await page.getByLabel("Descripción del bug").fill("el login falla con emails en mayúsculas");
  await page.getByRole("button", { name: "Crear tarea" }).click();
  await page.locator("main").getByText("Bug: el login falla con emails en mayúsculas").waitFor();
  check(true, "task created from template appears on the board");
  await page.getByRole("button", { name: "Nueva tarea" }).click();
  await page.getByPlaceholder("Título de la tarea").fill("Documentar la API");
  await page.getByRole("button", { name: "Crear tarea" }).click();
  await page.locator("main").getByText("Documentar la API").waitFor();
  check(true, "manual task created");

  // Drag "Documentar la API" (To do) into "Hecho".
  const card = page.locator("main").getByText("Documentar la API");
  const target = page.getByText("Hecho", { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
  const cb = await card.boundingBox();
  const tb = await target.boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width / 2 + 20, cb.y + cb.height / 2 + 10, { steps: 5 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 120, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const tasks = await (await fetch(base + "/api/tasks", { headers: { authorization: `Bearer ${token}` } })).json();
  check(tasks.tasks.find((t) => t.title === "Documentar la API")?.status === "done", "drag & drop moves task to Done (persisted)");
  // Regression: moving a task must not wipe its other fields.
  const bug = tasks.tasks.find((t) => t.title.startsWith("Bug: el login"));
  await fetch(base + `/api/tasks/${bug.id}`, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ status: "review", order: 0 }) });
  const after = await (await fetch(base + `/api/tasks/${bug.id}`, { headers: { authorization: `Bearer ${token}` } })).json();
  check(after.status === "review" && after.labels.includes("bug") && after.checklist.length === 4 && after.prompt.length > 0, "moving a task keeps labels, checklist and prompt");
  await shot("04-tasks");

  // Autonomous queue: one To do task with a project gets executed and moves to review.
  const qt = await (
    await fetch(base + "/api/tasks", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ title: "Tarea en cola", projectPath: project, prompt: "cola" }) })
  ).json();
  await page.reload();
  await page.getByRole("button", { name: "Ejecutar cola" }).click();
  await page.getByText("Se ejecutarán 1 de 1 tareas pendientes").waitFor();
  await page.getByRole("button", { name: "Iniciar cola" }).click();
  await page.getByText("Cola finalizada").waitFor({ timeout: 20000 });
  const qtAfter = await (await fetch(base + `/api/tasks/${qt.id}`, { headers: { authorization: `Bearer ${token}` } })).json();
  check(qtAfter.status === "review" && qtAfter.runIds.length === 1, "task queue runs To do tasks and moves them to review");

  // Agents
  await page.goto(`${base}/agents`);
  await page.getByRole("button", { name: "Nuevo agente" }).first().click();
  await page.getByPlaceholder("code-reviewer").fill("code-reviewer");
  await page.getByPlaceholder("Revisa código buscando bugs").fill("Revisa código buscando bugs y problemas de seguridad");
  await page.getByPlaceholder("Eres un revisor de código senior…").fill("Eres un revisor de código senior. Sé conciso.");
  await page.getByRole("button", { name: "Guardar" }).click();
  await page.getByText("code-reviewer", { exact: true }).waitFor();
  check(fs.existsSync(path.join(claudeHome, "agents", "code-reviewer.md")), "agent saved to ~/.claude/agents");
  await shot("05-agents");

  await page.goto(`${base}/templates`);
  await page.getByText("Auditoría de seguridad").waitFor();
  await shot("06-templates");
  await page.goto(`${base}/projects/view?path=${encodeURIComponent(project)}`);
  await page.getByText("Initial commit").waitFor();
  check(true, "project view shows git history");
  await shot("07-project");

  await page.goto(`${base}/analytics`);
  await page.getByText("Tokens por día").waitFor();
  const bars = page.locator("main button[aria-label$='tokens']");
  await bars.last().hover();
  await page.getByText("Caché escritura").waitFor();
  check((await bars.last().getAttribute("aria-label")).includes("1.5k"), "analytics: today's bar reflects transcript tokens");
  await shot("10-analytics");
  await page.getByRole("button", { name: "Tabla" }).click();
  await page.locator("main table").waitFor();
  check(true, "analytics: table view available");

  // Integrations: connect Slack through the UI, then read and reply from Mensajes.
  await page.goto(`${base}/integrations`);
  // One-click connections: OAuth buttons, gh CLI reuse and Slack's app manifest.
  for (const name of ["Conectar con GitHub", "Usar mi sesión de gh", "Conectar con Jira", "Conectar con Bitbucket", "Crear app de Slack"]) await page.getByRole("button", { name }).waitFor();
  await page.getByRole("button", { name: "Conectar con Jira" }).click();
  await page.getByText("Activar «Conectar con Jira»").waitFor();
  check(await page.getByText(`localhost:${port}/api/integrations/oauth/callback`).isVisible(), "OAuth setup shows the callback URL to register");
  await page.keyboard.press("Escape");
  const cbRes = await fetch(`${base}/api/integrations/oauth/callback?state=forged&code=x`);
  check(cbRes.status === 400 && (await cbRes.text()).includes("caducó"), "OAuth callback is reachable without a session but rejects unknown states");
  await page.locator("main").getByRole("button", { name: "Pegar token" }).click();
  await page.getByLabel("Bot token").fill("xoxb-smoke-token");
  await page.getByRole("button", { name: "Guardar y probar" }).click();
  await page.getByText("agentic @ Smoke").waitFor();
  const integrations = await (await fetch(base + "/api/integrations", { headers: { authorization: `Bearer ${token}` } })).text();
  check(!integrations.includes("xoxb-smoke-token"), "integration secrets are never returned by the API");
  await page.goto(`${base}/messages`);
  await page.getByText("¿Alguien revisa la PR @Ana?").waitFor();
  check(true, "Slack channel history renders with resolved mentions");
  await page.getByText("¿Alguien revisa la PR @Ana?").hover();
  await page.getByText("Responder en hilo").click();
  await page.getByPlaceholder("Responder en el hilo…").fill("Yo la reviso");
  await page.keyboard.press("Enter");
  await waitUntil(() => slackPosted.length === 1);
  check(slackPosted[0]?.text === "Yo la reviso" && slackPosted[0]?.thread_ts === "1700000000.000100", "reply in a Slack thread from the app");
  await shot("11-messages");

  // Pull requests: configure GitHub, open the PR from the inbox, approve and merge it.
  await fetch(base + "/api/integrations/github", { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ token: "ghp_smoke", apiUrl: githubUrl }) });
  await page.goto(`${base}/pulls`);
  await page.getByText("Añade modo oscuro").click();
  await page.getByText("Implementa el tema oscuro.").waitFor();
  await page.getByText("checks OK").waitFor();
  check(true, "PR inbox and detail render (description, checks)");
  await page.getByRole("tab", { name: /Archivos/ }).click();
  await page.locator("main").getByText("+.dark { color: white }").waitFor();
  await shot("12-pull-request");
  await page.getByRole("button", { name: "Aprobar" }).click();
  await page.getByText("PR aprobada").waitFor();
  await page.getByRole("button", { name: "Mergear" }).click();
  await page.getByRole("button", { name: "Confirmar merge" }).click();
  await page.getByText("PR #12 mergeada").waitFor();
  const writes = ghWrites.map((w) => `${w.method} ${w.path}`);
  check(
    writes.includes("POST /repos/acme/demo/pulls/12/reviews") && ghWrites.some((w) => w.path.endsWith("/merge") && w.body.sha === PR_SHA && w.body.merge_method === "squash"),
    "approve and merge a PR from the app (merge pinned to the reviewed head SHA)",
  );

  // Jira: search, open an issue, move it, comment and import it as a task.
  await fetch(base + "/api/integrations/jira", { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ siteUrl: jiraUrl, email: "ana@acme.test", token: "jira-smoke" }) });
  await page.goto(`${base}/jira`);
  await page.getByText("El checkout falla en Safari").click();
  await page.getByText("Al pagar con Safari 17 aparece un error 500.").waitFor();
  check(true, "Jira issues list and detail (ADF description) render");
  await page.getByRole("combobox", { name: "Cambiar estado" }).click();
  await page.getByRole("option", { name: /Empezar/ }).click();
  await page.getByText("SHOP-7 → In Progress").waitFor();
  await page.getByPlaceholder("Añadir comentario…").fill("Lo reproduzco y lo arreglo hoy");
  await page.getByRole("button", { name: "Comentar" }).click();
  await page.getByText("Comentario publicado en Jira").waitFor();
  await page.getByRole("button", { name: "Importar como tarea" }).click();
  await page.getByText("SHOP-7 importada como tarea").waitFor();
  await shot("13-jira");
  const jt = (await (await fetch(base + "/api/tasks", { headers: { authorization: `Bearer ${token}` } })).json()).tasks.find((t) => t.external?.id === "SHOP-7");
  check(
    jiraWrites.some((w) => w.path.endsWith("/transitions") && w.body.transition.id === "31") &&
      jiraWrites.some((w) => w.path.endsWith("/comment") && JSON.stringify(w.body).includes("Lo reproduzco")) &&
      jt?.title === "SHOP-7 El checkout falla en Safari",
    "transition, comment and import a Jira issue from the app",
  );

  await page.goto(`${base}/settings`);
  await page.getByText("9.9.9 (Fake Claude)").waitFor();
  const appVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  check((await page.locator("aside").textContent()).includes(`v${appVersion}`), `app version v${appVersion} shown`);
  check(true, "settings shows detected claude version");
  await shot("08-settings");

  // Command palette
  await page.goto(`${base}/`);
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Busca páginas, sesiones, proyectos…").fill("plantillas");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/templates$/);
  check(true, "Ctrl+K command palette navigates");

  // XSS: a task title with markup must render as text.
  await fetch(base + "/api/tasks", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ title: '<img src=x onerror="window.__xss=1">' }) });
  await page.goto(`${base}/tasks`);
  await page.getByText('<img src=x onerror="window.__xss=1">').waitFor();
  check((await page.evaluate(() => window.__xss)) === undefined, "HTML in user data is not executed (XSS)");

  // Mobile layout
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/`);
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  await page.waitForTimeout(800);
  const wide = await page.evaluate(() => {
    const W = window.innerWidth;
    if (document.documentElement.scrollWidth <= W + 1) return [];
    return [...document.querySelectorAll("main *")]
      .filter((e) => e.getBoundingClientRect().right > W + 1)
      .slice(0, 5)
      .map((e) => `${e.tagName}.${String(e.className).slice(0, 60)}`);
  });
  check(wide.length === 0, `no horizontal overflow on mobile ${wide.join(" ; ")}`);
  await shot("09-mobile");


  // ---- Touch ID / passkeys with Chromium's virtual platform authenticator ----
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/settings`);
  await page.getByRole("button", { name: "Añadir Touch ID" }).click();
  await page.getByText("Touch ID registrado").waitFor();
  check(true, "register Touch ID (platform passkey with user verification)");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await page.waitForURL(/\/login/);
  await page.goto(`${base}/`);
  await page.waitForURL(/\/login/);
  check(true, "logout revokes the session (redirected to /login)");
  await page.waitForTimeout(500); // let the entrance animation finish
  await shot("14-login");
  await page.getByRole("button", { name: "Entrar con Touch ID" }).click();
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  check(true, "sign in with Touch ID");
  await page.goto(`${base}/settings`);
  await page.getByRole("switch", { name: "Exigir Touch ID" }).click();
  await page.getByText("Touch ID ahora es obligatorio").waitFor();
  const bearer = await fetch(base + "/api/tasks", { headers: { authorization: `Bearer ${token}` } });
  const tokenLogin = await fetch(base + `/auth?token=${token}`, { redirect: "manual" });
  check(bearer.status === 401 && tokenLogin.status === 303 && (tokenLogin.headers.get("location") || "").includes("reason=passkey"), "with Touch ID required, the token no longer grants access");
  await page.getByText("Registro de auditoría").scrollIntoViewIfNeeded();
  await page.getByText("Passkey añadida").first().waitFor();
  check(true, "audit log records security events");
  await shot("15-security");

  const cspErrors = consoleErrors.filter((e) => /Content Security Policy|Refused to/i.test(e));
  check(cspErrors.length === 0, `no CSP violations (${cspErrors.slice(0, 2).join(" | ")})`);
  const otherErrors = consoleErrors.filter((e) => !/Content Security Policy|Refused to/i.test(e));
  check(otherErrors.length === 0, `no console errors (${otherErrors.slice(0, 3).join(" | ")})`);
} catch (e) {
  failures.push(String(e?.stack || e));
  console.error(e);
  console.error("--- server output ---\n" + out.slice(-3000));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  slack.close();
  github.close();
  jira.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll smoke checks passed");
process.exit(failures.length ? 1 : 0);
