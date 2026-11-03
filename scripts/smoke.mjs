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

const port = 4400 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, AGENTIC_HOME: dataDir, CLAUDE_HOME: claudeHome, CLAUDE_BIN: path.join(root, "test/fixtures/fake-claude.mjs"), PORT: String(port), HOST: "127.0.0.1" };
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
  let r = await fetch(base + "/");
  check(r.status === 401, "page without token -> 401");
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
  check(r.status === 303 && /HttpOnly/i.test(r.headers.get("set-cookie") || ""), "/auth sets HttpOnly cookie");
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
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll smoke checks passed");
process.exit(failures.length ? 1 : 0);
