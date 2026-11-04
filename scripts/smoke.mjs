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
// Pushes land in a local bare repo; the fetch URL still looks like GitHub for the PR inbox.
const bareRemote = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-smoke-bare-"));
execFileSync("git", ["init", "-q", "--bare"], { cwd: bareRemote });
execFileSync("git", ["config", `url.${bareRemote}.pushInsteadOf`, "https://127.0.0.1/acme/demo.git"], { cwd: project });

const enc = project.replace(/\//g, "-");
fs.mkdirSync(path.join(claudeHome, "projects", enc), { recursive: true });
fs.mkdirSync(path.join(claudeHome, "sessions"), { recursive: true });
const sid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const lines = [
  { type: "user", cwd: project, gitBranch: "main", version: "2.1.0", timestamp: new Date().toISOString(), message: { role: "user", content: "Añade modo oscuro al dashboard" } },
  { type: "assistant", timestamp: new Date().toISOString(), message: { model: "claude-sonnet", content: [{ type: "text", text: "Claro, voy a revisar los estilos." }, { type: "tool_use", name: "Read", input: { file_path: "src/app.css" } }], usage: { input_tokens: 1200, output_tokens: 300 } } },
  // A Claude artifact link in the conversation: the Library indexes it.
  { type: "assistant", cwd: project, timestamp: new Date().toISOString(), message: { model: "claude-sonnet", content: [{ type: "text", text: "Comparativa de precios lista:\nhttps://claude.ai/artifact/SmokeArtifact123" }] } },
];
fs.writeFileSync(path.join(claudeHome, "projects", enc, `${sid}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
// A second, finished session to delete (trash) and restore from the UI.
const sid2 = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
fs.writeFileSync(path.join(claudeHome, "projects", enc, `${sid2}.jsonl`), JSON.stringify({ type: "user", cwd: project, timestamp: new Date().toISOString(), message: { role: "user", content: "Sesión desechable para borrar" } }) + "\n");
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
      "/conversations.list": () => ({
        ok: true,
        channels: [{ id: "C01DEV", name: "dev", is_private: false, is_member: true, topic: { value: "Equipo" } }, { id: "D01ANA", is_im: true, user: "U01ANA", updated: 1 }],
      }),
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
      "/repos/acme/demo/pulls": () => (req.method === "POST" ? { number: 13, html_url: "https://github.com/acme/demo/pull/13" } : [pr]),
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
  // After an update the release notes show up once.
  await page.getByText(/Novedades de la v/).waitFor();
  await shot("00-whats-new");
  await page.getByRole("button", { name: "Entendido" }).click();
  await page.reload();
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  await page.waitForTimeout(500);
  check(!(await page.getByText(/Novedades de la v/).isVisible()), "release notes appear once after an update, then stay dismissed");
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

  // Delete a session -> trash -> restore.
  await page.goto(`${base}/sessions`);
  await page.getByText("Sesión desechable para borrar").first().waitFor();
  await page.getByRole("button", { name: /^Borrar «Sesión desechable/ }).click({ force: true });
  await page.getByText("Sesión movida a la papelera").waitFor();
  await page.getByText("Sesión desechable para borrar").first().waitFor({ state: "detached" });
  check(!fs.existsSync(path.join(claudeHome, "projects", enc, `${sid2}.jsonl`)) && (await page.getByText("Sesión desechable para borrar").count()) === 0, "deleting a session moves it to the trash");
  await page.getByRole("button", { name: /Papelera/ }).click();
  await page.getByRole("button", { name: "Restaurar" }).click();
  await page.getByText("Sesión restaurada").waitFor();
  check(fs.existsSync(path.join(claudeHome, "projects", enc, `${sid2}.jsonl`)), "a session can be restored from the trash");
  await page.keyboard.press("Escape");

  // Hide a sidebar item and keep it hidden.
  await page.getByRole("button", { name: "Personalizar menú" }).click();
  await page.getByRole("button", { name: "Ocultar MCP" }).click();
  await page.getByRole("button", { name: "Listo" }).click();
  check((await page.locator("aside nav").getByRole("link", { name: "MCP", exact: true }).count()) === 0, "a sidebar item can be hidden");
  await page.getByRole("button", { name: "Personalizar menú" }).click();
  await page.getByRole("button", { name: "Mostrar MCP" }).click();
  await page.getByRole("button", { name: "Listo" }).click();
  check((await page.locator("aside nav").getByRole("link", { name: "MCP", exact: true }).count()) === 1, "a hidden sidebar item can be shown again");
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
  await page.getByText("Archivos modificados").first().waitFor({ timeout: 10000 });
  check(await page.locator("main details[aria-label='Archivos modificados']").getByText("created-by-claude.txt").isVisible(), "the chat lists the files Claude changed, next to the output");
  await page.getByRole("tab", { name: "Cambios" }).click();
  await page.locator("main [role=tabpanel][data-state=active]").getByText("created-by-claude.txt").waitFor({ timeout: 10000 });
  await page.locator("main").getByText("+hello from claude").waitFor();
  check(await page.locator("main").getByText("+2", { exact: true }).isVisible(), "diff summary counts lines of new files");
  check(true, "run diff tab shows files created by Claude");
  await shot("03b-run-diff");
  await shot("03-run");

  // The liquid orb shows what Claude did; Headless runs can be answered (continues the same session).
  await page.getByRole("tab", { name: "Salida" }).click();
  await page.locator('main .orb[data-state="done"]').first().waitFor();
  check(true, "run page shows the liquid orb in its final state");
  await page.getByText("62 % usado").waitFor();
  await page.getByText(/Se reinicia en 2 h/).waitFor();
  check(true, "run page shows plan usage and when it resets");
  await shot("03d-usage-jira");
  await shot("03c-run-orb");
  const firstRunId = page.url().split("/").pop();
  const authH = { authorization: `Bearer ${token}` };
  const firstRun = await (await fetch(base + `/api/runs/${firstRunId}`, { headers: authH })).json();
  // "/" opens the command menu; /plan switches to plan mode for this message and is not sent to Claude.
  await page.getByLabel("Responder a Claude").fill("/pl");
  await page.getByRole("option", { name: /\/plan/ }).waitFor();
  await page.getByLabel("Responder a Claude").press("Tab");
  check((await page.getByLabel("Responder a Claude").inputValue()) === "/plan ", "the / menu completes a command with Tab");
  await page.getByLabel("Responder a Claude").fill("/plan Sí, hazlo con TypeScript");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  // The reply appears below in the SAME page (no new run page) and Claude answers it there.
  await page.getByText("done: Sí, hazlo con TypeScript").waitFor({ timeout: 15000 });
  const replyRun = (await (await fetch(base + "/api/runs", { headers: authH })).json()).runs.find((r) => r.threadId === firstRunId);
  check(page.url().endsWith(firstRunId) && !!firstRun.sessionId && replyRun?.resumeSessionId === firstRun.sessionId && replyRun.prompt === "Sí, hazlo con TypeScript" && replyRun.permissionMode === "plan", "reply in Headless continues the same conversation in the same page (/plan applied, not sent as text)");
  await shot("03e-thread");

  // Stop a long-running run from the UI (regression: body-less POSTs were rejected with 415).
  const longRun = await (
    await fetch(base + "/api/runs", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ projectPath: project, prompt: "SLEEP" }) })
  ).json();
  await page.goto(`${base}/runs/${longRun.id}`);
  await page.getByText("en vivo").waitFor({ timeout: 10000 });
  await page.locator("main").getByText("some stderr line").waitFor({ timeout: 10000 });
  check((await fetch(base + `/api/runs/${longRun.id}`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json())).status === "running", "live log streams over SSE while the run is still running");
  check((await page.locator("aside").getByText("Claude trabajando").count()) === 0, "sidebar hides the live card on the run page (it already shows its own orb)");
  await page.goto(`${base}/tasks`);
  await page.locator("aside").getByText("Claude trabajando").waitFor({ timeout: 20000 });
  check(true, "sidebar shows the live orb while a run is working");
  await page.goto(`${base}/runs/${longRun.id}`);
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

  // Run a task in its own git worktree (own branch); the user's checkout stays on main.
  await fetch(base + "/api/tasks", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ title: "Aislar en rama", projectPath: project, prompt: "rama", status: "backlog" }) });
  await page.goto(`${base}/tasks`);
  await page.locator("main").getByText("Aislar en rama").click();
  await page.getByRole("button", { name: "Guardar y ejecutar" }).click();
  await page.getByLabel("Trabajar en un worktree aislado").check();
  await page.getByRole("button", { name: "Lanzar", exact: true }).click();
  await page.waitForURL(/\/runs\/[0-9a-f-]{36}$/);
  const wtRun = await (await fetch(base + `/api/runs/${page.url().split("/").pop()}`, { headers: { authorization: `Bearer ${token}` } })).json();
  check(wtRun.projectPath.includes(`${path.sep}worktrees${path.sep}`) && execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: project, encoding: "utf8" }).trim() === "main", "task runs in an isolated git worktree");
  await page.locator("main").getByText("Ejecución completada").or(page.getByText("Ejecución completada")).first().waitFor({ timeout: 15000 });
  await page.goto(`${base}/tasks`);
  await page.locator("main").getByText("Aislar en rama").click();
  await page.getByRole("region", { name: "Worktree" }).getByText(/agentic\/aislar-en-rama-/).waitFor();
  check(true, "task dialog shows the worktree branch");
  await shot("04b-task-worktree");
  await page.keyboard.press("Escape");

  // Scheduled runs: create one from a preset, then launch it right away.
  await page.goto(`${base}/schedules`);
  await page.getByRole("heading", { name: "Programadas" }).waitFor();
  await page.getByRole("button", { name: "Nueva programación" }).first().click();
  await page.getByRole("button", { name: "Resumen diario" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Crear" }).click();
  await page.getByText("Programación creada").waitFor();
  await page.locator("main").getByText("Lunes a viernes a las 09:00").waitFor();
  check(true, "schedule created from a preset");
  await page.getByRole("button", { name: "Ejecutar ahora" }).click();
  await page.getByText("«Resumen de ayer» lanzada").waitFor();
  await page.locator("main").getByRole("link", { name: /Última:/ }).waitFor();
  check(true, "scheduled job runs on demand and links to its run");
  await shot("04c-schedules");

  // Chat with Claude outside any project; the conversation lands in the history.
  await page.goto(`${base}/chat`);
  await page.getByText("¿En qué te ayudo?").waitFor();
  await shot("05a-chat-empty");
  await page.getByLabel("Mensaje para Claude").fill("Hola Claude, ¿me explicas los closures?");
  await page.keyboard.press("Enter");
  await page.getByRole("navigation", { name: "Historial de chats" }).getByText("Hola Claude, ¿me explicas los closures?").waitFor();
  const chats = await (await fetch(base + "/api/chats", { headers: { authorization: `Bearer ${token}` } })).json();
  const chatRun = (await (await fetch(base + "/api/runs", { headers: { authorization: `Bearer ${token}` } })).json()).runs.find((r) => r.prompt.startsWith("Hola Claude"));
  check(chats.chats.length === 1 && chatRun && chatRun.projectPath.endsWith("/chat"), "chat starts a Claude conversation outside any project and keeps it in the history");
  await shot("05b-chat");

  // MCP servers: add a popular one through `claude mcp add`.
  await page.goto(`${base}/mcp`);
  await page.getByRole("heading", { name: "Servidores MCP" }).waitFor();
  await page.getByRole("button", { name: "Añadir servidor" }).first().click();
  await page.getByRole("button", { name: "Playwright" }).click();
  check((await page.getByLabel("Argumentos").inputValue()).includes("@playwright/mcp"), "MCP presets fill the server definition");
  await page.getByRole("dialog").getByRole("button", { name: "Añadir", exact: true }).click();
  await page.getByText("Servidor «playwright» añadido").waitFor();
  check(true, "MCP server added through the claude CLI from the app");
  await shot("05c-mcp");

  // Claude Code permissions: a recipe + a custom rule, saved to ~/.claude/settings.json.
  await page.goto(`${base}/permissions`);
  await page.getByRole("heading", { name: "Permisos" }).waitFor();
  await page.getByRole("button", { name: "Proteger secretos" }).click();
  await page.getByLabel("Nueva regla: Permitir siempre").fill("Bash(npm run build:*)");
  await page.getByLabel("Nueva regla: Permitir siempre").press("Enter");
  await page.getByRole("button", { name: /Aceptar ediciones/ }).click();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await page.getByText("Permisos guardados").waitFor();
  const perms = JSON.parse(fs.readFileSync(path.join(claudeHome, "settings.json"), "utf8")).permissions;
  check(perms.deny.includes("Read(./.env)") && perms.allow.includes("Bash(npm run build:*)") && perms.defaultMode === "acceptEdits", "permissions saved to Claude Code settings.json");
  await shot("05d-permissions");

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

  // Library: the artifact mentioned in the session is indexed, with its context and a link that opens outside.
  await page.goto(`${base}/library`);
  await page.getByText("Comparativa de precios lista").waitFor();
  const openArtifact = page.getByRole("link", { name: "Abrir" }).first();
  check((await openArtifact.getAttribute("href")) === "https://claude.ai/artifact/SmokeArtifact123" && (await openArtifact.getAttribute("target")) === "_blank", "library lists the session's artifact with a link that opens in a new tab");
  await page.getByRole("button", { name: /^Artifacts/ }).click();
  await shot("11-library");

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

  // Budget: a tiny daily USD limit is already exceeded → banner + automation paused; then lift it.
  await page.getByRole("button", { name: "Definir límites" }).click();
  await page.getByLabel("Al día (USD)").fill("0.0001");
  await page.getByRole("dialog").getByRole("button", { name: "Guardar" }).click();
  await page.getByText("Presupuesto guardado").waitFor();
  await page.getByRole("meter", { name: /Gasto hoy/ }).waitFor();
  await page.getByRole("status").getByText(/Presupuesto superado/).waitFor({ timeout: 70000 }).catch(async () => {
    await page.reload();
    await page.getByRole("status").getByText(/Presupuesto superado/).waitFor();
  });
  const queueRes = await fetch(base + "/api/queue/start", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });
  check(queueRes.status === 402, "over budget: banner shown and the task queue refuses to start");
  await shot("10b-budget");
  await fetch(base + "/api/budgets", { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });

  // Integrations: connect Slack through the UI, then read and reply from Mensajes.
  await page.goto(`${base}/integrations`);
  // Advanced options (OAuth, gh CLI) stay available under "Avanzado".
  for (const summary of await page.getByText("Avanzado", { exact: true }).all()) await summary.click();
  for (const name of ["Conectar con GitHub", "Usar mi sesión de gh", "Conectar con Jira", "Conectar con Bitbucket", "Conectar con Slack"]) await page.getByRole("button", { name }).waitFor();
  await page.getByRole("button", { name: "Conectar con Jira" }).click();
  await page.getByText("Activar «Conectar con Jira»").waitFor();
  check(await page.getByText("https://perita23.github.io/agentic-releases/oauth/").isVisible(), "OAuth setup shows the (HTTPS relay) callback URL to register");
  await page.keyboard.press("Escape");
  const cbRes = await fetch(`${base}/api/integrations/oauth/callback?state=forged&code=x`);
  check(cbRes.status === 400 && (await cbRes.text()).includes("caducó"), "OAuth callback is reachable without a session but rejects unknown states");
  // The simple path: one "Conectar" button, a 2-step wizard, paste, done.
  await page.reload();
  await page.locator("main").getByRole("button", { name: "Conectar", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Abrir Slack" }).waitFor();
  await shot("10b-connect-slack");
  await page.getByLabel("Pega el token").fill("xoxb-wrong-token");
  const errorsBefore = consoleErrors.length;
  await page.getByRole("dialog").getByRole("button", { name: "Conectar", exact: true }).click();
  await page.getByText("Ese token no funciona").waitFor();
  consoleErrors.splice(errorsBefore); // the rejected test request is expected here
  check((await (await fetch(base + "/api/integrations", { headers: { authorization: `Bearer ${token}` } })).json()).slack.configured === false, "a wrong token gives a plain message and leaves nothing half-configured");
  await page.getByLabel("Pega el token").fill("xoxb-smoke-token");
  await page.getByRole("dialog").getByRole("button", { name: "Conectar", exact: true }).click();
  await page.getByText("agentic @ Smoke").waitFor();
  const integrations = await (await fetch(base + "/api/integrations", { headers: { authorization: `Bearer ${token}` } })).text();
  check(!integrations.includes("xoxb-smoke-token"), "integration secrets are never returned by the API");
  await page.goto(`${base}/messages`);
  await page.getByText("¿Alguien revisa la PR @Ana?").waitFor();
  check(true, "Slack channel history renders with resolved mentions");
  await page.getByText("Mensajes directos").waitFor();
  check(await page.getByRole("navigation", { name: "Conversaciones" }).getByRole("button", { name: "Ana" }).isVisible(), "Slack direct messages are listed");
  await page.getByText("¿Alguien revisa la PR @Ana?").hover();
  await page.getByRole("button", { name: "Crear tarea" }).click();
  await page.getByText("Tarea creada en el backlog").waitFor();
  const slackTasks = await (await fetch(base + "/api/tasks", { headers: { authorization: `Bearer ${token}` } })).json();
  check(slackTasks.tasks.some((t) => t.labels.includes("slack") && t.title.startsWith("¿Alguien revisa la PR")), "a Slack message becomes an Agentic task");
  await page.locator("main section").getByText("¿Alguien revisa la PR @Ana?").hover();
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

  // Save part of a session as a comment on its Jira issue (the prompt has no key: it is typed).
  await page.goto(`${base}/runs/${firstRunId}`);
  // The page now shows the whole conversation: pick the button of the FIRST run's result, not of a reply still loading.
  await page.locator("div.rounded-md.border", { hasText: "done: Escribe tests para el login EDIT" }).getByRole("button", { name: "Comentar en Jira" }).click();
  await page.getByLabel("Incidencia").fill("SHOP-7");
  await page.getByRole("button", { name: "Añadir comentario" }).click();
  await page.getByText("Comentario añadido a SHOP-7").waitFor();
  check(jiraWrites.some((w) => w.path.endsWith("/comment") && JSON.stringify(w.body).includes("done: Escribe tests")), "comment on the session's Jira issue from a run");

  // Open a PR straight from a task's worktree (commit + push + GitHub PR).
  const wtTask = (await (await fetch(base + "/api/tasks", { headers: { authorization: `Bearer ${token}` } })).json()).tasks.find((t) => t.title === "Aislar en rama");
  fs.writeFileSync(path.join(wtTask.worktree.path, "dark.css"), ".dark {}\n");
  await page.goto(`${base}/tasks`);
  await page.locator("main").getByText("Aislar en rama").click();
  await page.getByRole("button", { name: "Crear PR" }).click();
  await page.getByRole("button", { name: "Crear PR" }).last().click();
  await page.getByText("PR #13 creada").waitFor();
  const prCall = ghWrites.find((w) => w.method === "POST" && w.path === "/repos/acme/demo/pulls");
  check(prCall?.body.head === wtTask.worktree.branch && prCall?.body.base === "main" && execFileSync("git", ["log", "--format=%s", "-1", wtTask.worktree.branch], { cwd: bareRemote, encoding: "utf8" }).trim() === "Aislar en rama", "task worktree: commit, push and open a PR from the app");
  await page.keyboard.press("Escape");

  await page.goto(`${base}/settings`);
  await page.getByText("9.9.9 (Fake Claude)").waitFor();
  const appVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  check((await page.locator("aside").textContent()).includes(`v${appVersion}`), `app version v${appVersion} shown`);
  check(true, "settings shows detected claude version");
  await shot("08-settings");

  // Backups: save a copy, export (no credentials), then restore an exported file.
  await page.getByRole("button", { name: "Guardar copia ahora" }).click();
  await page.getByText("Copia guardada").waitFor();
  await page.getByRole("button", { name: /^Restaurar agentic-.*-manual\.json$/ }).waitFor();
  const exported = await (await fetch(base + "/api/backup", { headers: { authorization: `Bearer ${token}` } })).text();
  check(exported.includes('"app": "agentic"') && !exported.includes("xoxp-") && !/"integrations"/.test(exported), "backup export contains data but no credentials");
  const exportFile = path.join(tmp, "export.json");
  fs.writeFileSync(exportFile, exported);
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("Archivo de copia").setInputFiles(exportFile);
  await page.getByText("Copia restaurada").waitFor();
  check(true, "backup file restored from Settings (with a safety copy first)");
  await shot("08b-backups");

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
