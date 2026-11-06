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


// A local model (Ollama) stand-in: it fixes two typos, or organises a prompt.
const ollama = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "fake:1b", size: 1.2e9 }] }));
    if (req.url === "/api/chat") {
      const body = JSON.parse(raw);
      const m = body.messages;
      const last = m[m.length - 1].content;
      const prop = body.format?.required?.[0];
      let out;
      if (prop === "existe") {
        const w = last.replace(/^[\s\S]*<palabra>/, "").replace(/<\/palabra>$/, "");
        const fixed = { herrores: "errores", escribiendo: "escribiendo" }[w] ?? w;
        out = { existe: fixed === w, palabra: fixed };
      } else {
        const text = last.replace(/^<texto>\n/, "").replace(/\n<\/texto>$/, "");
        out = m[0].content.includes("CORRECTOR") ? text.replace("herrores", "errores").replace("q tal", "qué tal") : `## Objetivo\n${text}`;
      }
      return setTimeout(() => res.end(JSON.stringify({ message: { role: "assistant", content: prop === "existe" ? JSON.stringify(out) : prop ? JSON.stringify({ [prop]: out }) : out } })), 120);
    }
    res.statusCode = 404;
    res.end("{}");
  });
});
await new Promise((r) => ollama.listen(0, "127.0.0.1", r));
const ollamaUrl = `http://127.0.0.1:${ollama.address().port}`;

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
const mailFixture = path.join(tmp, "mail.json");
fs.writeFileSync(mailFixture, JSON.stringify([
  { uid: 1, fromName: "Ana", fromAddress: "ana@cliente.com", subject: "Bug en demo-app al pagar", snippet: "No funciona el checkout", html: "<p>Hola <b>Ana</b>, esto es el HTML original</p><script>alert(1)</script><a href=\"https://example.com/x\">enlace</a>", body: "Texto completo del correo de Ana.\nSegunda línea.\nhttps://tracking.example.com/" + "a".repeat(400) + "\nResolución &#x2192; hecha", date: new Date().toISOString(), unread: true, listUnsubscribe: false },
  { uid: 2, fromName: "Facturación", fromAddress: "billing@proveedor.com", subject: "Factura de octubre", snippet: "", date: new Date().toISOString(), unread: true, listUnsubscribe: false },
]));
const env = { ...process.env, AGENTIC_MAIL_FIXTURE: mailFixture, AGENTIC_HOME: dataDir, CLAUDE_HOME: claudeHome, CLAUDE_BIN: path.join(root, "test/fixtures/fake-claude.mjs"), PORT: String(port), HOST: "127.0.0.1", AGENTIC_ALLOW_INSECURE_INTEGRATIONS: "1", AGENTIC_SLACK_API_URL: slackUrl };
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
  // Agentic's own MCP server: its own token, never the master one; the servers page stays behind the session.
  r = await fetch(base + "/api/agentic-mcp", { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
  check(r.status === 401, "Agentic MCP without its token -> 401");
  r = await fetch(base + "/api/agentic-mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
  check(r.status === 401, "Agentic MCP refuses the master token");
  const mcpTok = fs.readFileSync(path.join(dataDir, "mcp-token"), "utf8").trim();
  r = await fetch(base + "/api/agentic-mcp", { method: "POST", headers: { authorization: `Bearer ${mcpTok}`, "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' });
  const mcpList = r.ok ? await r.json() : null;
  check(!!mcpList?.result?.tools?.some((t) => t.name === "agentic_tasks"), "Agentic MCP lists its tools with its own token");
  r = await fetch(base + "/api/mcp");
  check(r.status === 401, "the MCP servers API stays behind the session");
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
  const shot0 = async (pg, name) => shots && pg.screenshot({ path: path.join(shots, `${name}.png`) });

  await page.addInitScript(() => {
    const result = (t, final) => Object.assign([{ transcript: t }], { isFinal: final });
    window.SpeechRecognition = class {
      start() {
        const phrase = window.__srPhrase || "hola claude, resume la tarea";
        setTimeout(() => this.onaudiostart?.(), 40);
        this.a = setTimeout(() => this.onresult?.({ results: [result(phrase.split(/[, ]+/).slice(0, 2).join(" "), false)] }), 200);
        this.b = setTimeout(() => this.onresult?.({ results: [result(phrase, false)] }), 450);
      }
      stop() {
        setTimeout(() => this.onend?.(), 80);
      }
      abort() {
        clearTimeout(this.a);
        clearTimeout(this.b);
        this.onend?.();
      }
    };
    // Reading aloud: the system's synthesiser, stood in for (it records what it is asked to say).
    window.__spoken = [];
    window.SpeechSynthesisUtterance = class {
      constructor(t) {
        this.text = t;
      }
    };
    const syn = {
      getVoices: () => [{ voiceURI: "fake", name: "Fake", lang: "es-ES", localService: true }],
      speak(u) {
        window.__spoken.push(u.text);
        this.t = setTimeout(() => u.onend?.({}), 600);
      },
      cancel() {
        clearTimeout(this.t);
      },
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(window, "speechSynthesis", { value: syn, configurable: true });
    navigator.mediaDevices.getUserMedia = async () => {
      const c = new AudioContext();
      const o = c.createOscillator();
      const d = c.createMediaStreamDestination();
      o.connect(d);
      o.start();
      return d.stream;
    };
  });
  await page.goto(`${base}/auth?token=${token}`);
  // After an update the release notes show up once. They are waited for first: while that dialog is open the rest of
  // the page is aria-hidden, and the dashboard streams in just after the loading skeleton, so it can open before it.
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

  // A long curl (command, output and answer) must never push the page sideways, live or finished.
  const curlRun = await (
    await fetch(base + "/api/runs", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ projectPath: project, prompt: "CURLLONG" }) })
  ).json();
  await page.goto(`${base}/runs/${curlRun.id}`);
  await page.locator("main").getByText(/Lo probé así/).waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  const overflowing = () =>
    page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const bad = [];
      for (const el of document.querySelectorAll("main *")) {
        const r = el.getBoundingClientRect();
        let p = el.parentElement, clipped = false;
        while (p && p !== document.body) { const o = getComputedStyle(p); if (/(hidden|auto|scroll|clip)/.test(o.overflowX)) { clipped = true; break; } p = p.parentElement; }
        if (!clipped && r.width > 0 && r.right > w + 1) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)}`);
      }
      return { scroll: document.documentElement.scrollWidth - w, bad: bad.slice(0, 6) };
    });
  const ov = await overflowing();
  // The log follows its end by itself (orb and status stay in view) until you scroll up; a button brings you back.
  const logEl = page.locator('[aria-label="Salida de Claude"]');
  const gap = () => logEl.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
  check((await gap()) <= 4, "the log follows its end while Claude writes");
  await logEl.hover();
  await page.mouse.wheel(0, -700);
  await page.waitForTimeout(400);
  check((await page.getByRole("button", { name: "Ir al final" }).count()) === 1 && (await gap()) > 20, "scrolling up pauses the follow and offers «Ir al final»");
  await page.getByRole("button", { name: "Ir al final" }).click();
  await page.waitForTimeout(1200);
  check((await gap()) <= 4 && (await page.getByRole("button", { name: "Ir al final" }).count()) === 0, "«Ir al final» brings you back to the end and follows again");
  await shot("03i-curl");
  check(ov.scroll <= 1 && ov.bad.length === 0, `a long curl does not overflow the page sideways ${JSON.stringify(ov)}`);
  // Obsidian: connect a vault in Ajustes; a session then writes its notes there and the run page links to them.
  const vaultDir = path.join(tmp, "vault");
  fs.mkdirSync(path.join(vaultDir, ".obsidian"), { recursive: true });
  await page.goto(`${base}/settings`);
  await page.getByLabel("Ruta de la bóveda").fill(vaultDir);
  await page.getByLabel("Que Claude escriba en Obsidian").click();
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await page.getByText(/Listo: las notas irán a/).waitFor({ timeout: 10000 });
  check(true, "Ajustes connects an Obsidian vault");
  const obRun = await (
    await fetch(base + "/api/runs", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ projectPath: project, prompt: "OBSIDIAN" }) })
  ).json();
  await page.goto(`${base}/runs/${obRun.id}`);
  const notes = page.getByLabel("Notas de Obsidian");
  await notes.waitFor({ timeout: 15000 });
  const noteHref = await notes.getByRole("link").first().getAttribute("href");
  check((await notes.innerText()).includes("Decisiones") && /^obsidian:\/\/open\?path=/.test(noteHref ?? ""), "the run page lists the notes Claude wrote in Obsidian, each with an «Abrir en Obsidian» link");
  await shot("03j-obsidian");
  await fetch(base + "/api/obsidian", { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ enabled: false }) });

  // Mi cuenta: name, a predefined avatar, an uploaded photo (cropped in the browser) and removing it.
  await page.goto(`${base}/account`);
  await page.getByRole("heading", { name: "Mi cuenta" }).waitFor();
  await page.getByLabel("Tu nombre").fill("Hugo");
  await page.getByLabel("Tu nombre").press("Enter");
  await page.getByLabel("Guardado").waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Cambiar imagen" }).click();
  await page.getByRole("radio", { name: "Aurora" }).click();
  await page.waitForTimeout(500);
  const apiProfile = () => fetch(base + "/api/profile", { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
  let pr = await apiProfile();
  check(pr.name === "Hugo" && pr.avatar?.kind === "preset" && pr.avatar.id === "aurora", "Mi cuenta saves the name and a predefined avatar");
  await page.getByRole("tab", { name: /Tu foto/ }).click();
  const avatarPng = path.join(tmp, "avatar.png");
  fs.writeFileSync(avatarPng, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  await page.locator('input[type="file"]').setInputFiles(avatarPng);
  await page.getByRole("button", { name: "Usar esta foto" }).click();
  await page.locator('header img[src^="/api/uploads/"]').waitFor({ timeout: 10000 });
  pr = await apiProfile();
  check(pr.avatar?.kind === "photo", "a photo is cropped, uploaded and shown in the top bar");
  const photoUrl = await page.locator('header img[src^="/api/uploads/"]').getAttribute("src");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Cambiar imagen" }).click();
  await page.getByRole("tab", { name: /Tu foto/ }).click();
  await page.getByRole("button", { name: "Quitar" }).click();
  await page.waitForTimeout(600);
  pr = await apiProfile();
  check(pr.avatar === null && (await fetch(base + photoUrl, { headers: { authorization: `Bearer ${token}` } })).status === 404, "removing the photo also deletes the file");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Cambiar imagen" }).click();
  await page.getByRole("radio", { name: "Brasa" }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await shot("07-account");
  // Placeholders sweep with light (the animation lives in globals.css).
  const sweep = await page.evaluate(() => {
    const d = document.createElement("div");
    d.setAttribute("data-slot", "skeleton");
    document.body.appendChild(d);
    const n = getComputedStyle(d).animationName;
    d.remove();
    return n;
  });
  check(sweep === "skeleton-sweep", "skeleton loaders have the light sweep");

  // Dictation: hold Space (or press the microphone) and what is said lands in the message box.
  await page.goto(`${base}/chat`);
  const chatBox = page.getByLabel("Mensaje para Claude");
  await chatBox.waitFor();
  await chatBox.click();
  await page.waitForTimeout(500);
  await page.keyboard.down("Space");
  const BOX = "textarea[aria-label='Mensaje para Claude']";
  await page.waitForFunction((q) => document.querySelector(q).value === "hola claude", BOX, { timeout: 5000 });
  check(true, "the words appear in the message box while still speaking");
  await page.waitForFunction((q) => document.querySelector(q).value === "hola claude, resume la tarea", BOX, { timeout: 5000 });
  check((await page.getByTestId("voice-text").count()) === 0 && (await chatBox.locator("xpath=ancestor::*[@data-composer]").getByTestId("voice-status").count()) === 1, "while it listens, the box shows the words and the status line only says it is listening");
  await shot("08-voice-listening");
  await page.keyboard.up("Space");
  await page.waitForFunction(() => document.querySelector("textarea[aria-label='Mensaje para Claude']").value === "hola claude, resume la tarea");
  check(true, "holding Space dictates into the message box (and types no spaces)");
  await page.getByTestId("voice-status").waitFor({ state: "detached", timeout: 5000 });
  await chatBox.fill("");
  await chatBox.fill("ya había: ");
  await page.getByRole("button", { name: "Dictar" }).first().click();
  await page.waitForFunction((q) => document.querySelector(q).value === "ya había: hola claude, resume la tarea", BOX, { timeout: 5000 });
  await page.getByRole("button", { name: "Dictar" }).first().click(); // pressing the microphone again finishes
  await page.waitForFunction((q) => document.querySelector(q).value === "ya había: hola claude, resume la tarea", BOX);
  check(true, "the microphone button dictates too, after what was already written");
  await page.getByTestId("voice-status").waitFor({ state: "detached", timeout: 5000 });
  await chatBox.fill("borrador");
  await page.getByRole("button", { name: "Dictar" }).first().click();
  await page.waitForFunction((q) => document.querySelector(q).value.startsWith("borrador hola"), BOX, { timeout: 5000 });
  await page.keyboard.press("Escape");
  await page.getByTestId("voice-status").waitFor({ state: "detached", timeout: 5000 });
  await page.waitForTimeout(500);
  check((await chatBox.inputValue()) === "borrador", "Esc cancels the dictation and leaves the box as it was");
  await page.goto(`${base}/tasks`);
  await page.getByRole("heading", { name: "Tareas" }).first().waitFor();
  await page.waitForTimeout(700); // the page is interactive (its keyboard shortcuts are attached) a moment after it shows
  await page.keyboard.down("Space");
  await page.getByTestId("voice-text").getByText("hola claude, resume la tarea").waitFor({ timeout: 5000 });
  await shot("08b-voice-floating");
  await page.keyboard.up("Space");
  await page.waitForFunction(() => document.querySelector("textarea[aria-label='Mensaje para Claude']")?.value === "hola claude, resume la tarea", null, { timeout: 10000 });
  check(page.url().endsWith("/chat"), "dictating with no field in focus opens a new chat with the text");
  // The Mac app's own engine (a native helper) reaches the same overlay through the preload bridge: here a stand-in.
  const natCtx = await browser.newContext({ storageState: await page.context().storageState() });
  const nat = await natCtx.newPage();
  await nat.addInitScript(() => {
    let cb = () => {};
    window.agenticDesktop = {
      isDesktop: true,
      voice: {
        available: async () => true,
        start: async () => {
          setTimeout(() => cb({ type: "ready" }), 30);
          setTimeout(() => cb({ type: "level", v: 0.7 }), 40);
          setTimeout(() => cb({ type: "text", text: "dictado nativo", final: false }), 120);
          return { ok: true };
        },
        stop: () => setTimeout(() => (cb({ type: "text", text: "dictado nativo", final: true }), cb({ type: "end" })), 60),
        cancel: () => cb({ type: "end" }),
        onEvent: (f) => ((cb = f), () => {}),
      },
    };
  });
  await nat.goto(`${base}/chat`);
  await nat.getByLabel("Mensaje para Claude").click();
  await nat.keyboard.down("Space");
  await nat.waitForFunction(() => document.querySelector("textarea[aria-label='Mensaje para Claude']").value === "dictado nativo", null, { timeout: 5000 });
  await nat.keyboard.up("Space");
  await nat.waitForFunction(() => document.querySelector("textarea[aria-label='Mensaje para Claude']").value === "dictado nativo");
  check(true, "the Mac app's native engine dictates through the same overlay");
  await natCtx.close();

  // A turn that has ended while the process lingers (background tasks): calm status, no clock, no dollars.
  const lingerRun = await (
    await fetch(base + "/api/runs", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ projectPath: project, prompt: "LINGER" }) })
  ).json();
  await page.goto(`${base}/runs/${lingerRun.id}`);
  await page.locator("main").getByText("Terminado", { exact: true }).first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  const lingering = await page.locator("main [role=status]").first().innerText();
  check(!/\d+ s\b/.test(lingering) && (await page.locator("main [role=status] .orb-text").count()) === 0, "when the turn ends the status stops glowing and loses its clock");
  check((await page.locator("main").getByText("Coste").count()) === 0 && (await page.locator("main").getByText("Tokens", { exact: true }).count()) >= 1, "the run page shows tokens instead of dollars");
  // The island (macOS app): rendered here in a plain page with a stand-in for the native bridge.
  const islCtx = await browser.newContext({ storageState: await page.context().storageState(), deviceScaleFactor: 3 });
  const isl = await islCtx.newPage();
  await isl.setViewportSize({ width: 560, height: 150 });
  await isl.addInitScript(() => {
    window.__island = [];
    window.__vis = true;
    window.__visCb = null;
    window.agenticIsland = {
      metrics: async () => ({ notch: true, notchWidth: 200, barHeight: 37 }),
      show: () => window.__island.push("show"),
      hide: () => window.__island.push("hide"),
      interactive: (on) => window.__island.push(`interactive:${on}`),
      open: (p) => window.__island.push(`open:${p}`),
      // The main window starts on screen: the island must stay away until it is not.
      mainVisible: async () => window.__vis,
      onMainVisible: (cb) => { window.__visCb = cb; return () => {}; },
    };
  });
  await isl.goto(`${base}/island`);
  await isl.waitForTimeout(1800);
  await (
    await fetch(base + "/api/runs", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ projectPath: project, prompt: "CURLLONG island" }) })
  ).json();
  await isl.waitForTimeout(2500);
  check(!(await isl.evaluate(() => window.__island.includes("show"))) && (await isl.getByText(/Escribiendo|Ejecutando|Pensando|Leyendo/).count()) === 0, "the island stays hidden while the app is on screen");
  await isl.evaluate(() => window.__visCb(false)); // the app is minimized / covered
  await isl.waitForFunction(() => window.__island.includes("show"), null, { timeout: 10000 });
  await isl.addStyleTag({ content: "html{background:#2c2c2e !important}" });
  await isl.waitForTimeout(700);
  await shot0(isl, "06a-island-work");
  check(await isl.evaluate(() => window.__island.includes("show")), "the island opens while Claude works");
  await isl.getByText("Claude ha terminado").locator("visible=true").waitFor({ timeout: 20000 });
  await isl.waitForTimeout(900);
  await shot0(isl, "06b-island-alert");
  const pillW = await isl.evaluate(() => Math.round(document.querySelector('div[style*="clip-path"]').getBoundingClientRect().width));
  check(pillW >= 340 && pillW <= 520, `the island's width follows its content (${pillW}px)`);
  await isl.getByRole("button", { name: "Abrir" }).click();
  check(await isl.evaluate(() => window.__island.some((c) => /^open:\/runs\/[0-9a-f-]+$/.test(c))), "the island's Abrir button opens the run in the main window");
  // Compact state with fixed data: the pill grows with the texts it has to show.
  const widths = [];
  for (const [project, label, state] of [["app", "Leyendo…", "reading"], ["inox-backend-services", "Ejecutando un comando…", "running"]]) {
    const p2 = await islCtx.newPage();
    await p2.setViewportSize({ width: 560, height: 150 });
    await p2.addInitScript(() => {
      window.__island = [];
      window.agenticIsland = { metrics: async () => ({ notch: true, notchWidth: 200, barHeight: 32 }), show() {}, hide() {}, interactive() {}, open() {}, mainVisible: async () => false, onMainVisible: () => () => {} };
    });
    await p2.route("**/api/island", (r) =>
      r.fulfill({ json: { running: [{ id: "x", title: "Revisar la PR", project, state, label, startedAt: new Date(Date.now() - 83_000).toISOString(), endedAt: null, href: "/runs/x" }], recent: [] } }),
    );
    await p2.goto(`${base}/island`);
    await p2.getByText(/\d+ s|min/).locator("visible=true").first().waitFor({ timeout: 10000 });
    await p2.addStyleTag({ content: "html{background:#2c2c2e !important}" });
    await p2.waitForTimeout(900);
    const pillWidth = () => p2.evaluate(() => Math.round(document.querySelector('div[style*="clip-path"]').getBoundingClientRect().width));
    widths.push(await pillWidth());
    if (widths.length === 1) {
      await p2.mouse.move(280, 14); // over the pill
      await p2.waitForTimeout(700);
      const swollen = await pillWidth();
      check(swollen > widths[0] + 8, `the island swells when hovered (${widths[0]}px → ${swollen}px)`);
      await p2.mouse.move(5, 140);
      await p2.waitForTimeout(700);
      widths[0] = await pillWidth(); // back to rest
    }
    await shot0(p2, `06c-island-compact-${widths.length}`);
    await p2.close();
  }
  check(widths[0] >= 328 && widths[1] > widths[0] && widths[1] <= 520, `the compact island grows with its texts (${widths.join("px → ")}px)`);
  await islCtx.close();
  await page.setViewportSize({ width: 820, height: 900 });
  await page.waitForTimeout(400);
  const ovNarrow = await overflowing();
  check(ovNarrow.scroll <= 1 && ovNarrow.bad.length === 0, `…nor in a narrow window ${JSON.stringify(ovNarrow)}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  if (process.env.SMOKE_ONLY_OVERFLOW) { await browser.close(); process.exit(0); }

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
  await page.getByText("Ejecución completada").first().waitFor({ timeout: 10000 });
  check(true, "finished run triggers a notification toast");
  // A file Claude creates shows up in the conversation right where it happened: the file, its line counts and the code.
  const createdCard = page.locator("main").getByRole("button", { name: /Creó archivo\s*created-by-claude\.txt/ });
  await createdCard.waitFor({ timeout: 15000 });
  await page.locator("main").getByText("hello from claude").first().waitFor();
  check((await createdCard.innerText()).includes("+1"), "an Edit/Write shows inline in the chat: file, lines added and the code");
  check((await page.locator("main details[aria-label='Archivos modificados']").count()) === 0, "there is no fixed 'modified files' panel any more");
  await page.getByRole("tab", { name: "Cambios" }).click();
  await page.locator("main [role=tabpanel][data-state=active]").getByText("created-by-claude.txt").waitFor({ timeout: 10000 });
  await page.locator("main [role=tabpanel][data-state=active]").getByText("+hello from claude").waitFor();
  check(await page.locator("main [role=tabpanel][data-state=active]").getByText("+2", { exact: true }).isVisible(), "diff summary counts lines of new files");
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

  // Rich tool cards + attachments: pasted images and long text, taller box.
  const box = page.getByLabel("Responder a Claude");
  await page.getByRole("button", { name: "Enviar", exact: true }).waitFor({ timeout: 15000 }); // idle again (while Claude works the button says "Añadir a la cola")
  check(((await box.boundingBox())?.height ?? 0) >= 110, "the reply box is tall");
  const png = path.join(tmp, "shot.png");
  fs.writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  await page.getByLabel("Adjuntar imágenes", { exact: true }).setInputFiles(png);
  await page.evaluate(() => {
    const ta = document.querySelector("textarea[aria-label='Responder a Claude']");
    const dt = new DataTransfer();
    dt.setData("text/plain", Array.from({ length: 30 }, (_, i) => `linea pegada ${i}`).join("\n"));
    ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.getByText("Texto pegado").waitFor();
  check((await box.inputValue()) === "" && (await page.locator("form img[alt='shot.png']").count()) === 1, "a long paste becomes a 'Texto pegado' chip and an image becomes a thumbnail");
  await box.fill("TOOLS mira esto");
  await page.getByRole("button", { name: "Enviar", exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector("form [aria-label='Subiendo']"));
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await page.getByText("Leyendo logs · api").waitFor({ timeout: 15000 });
  await page.getByText("Leyendo logs · api").click();
  await page.getByText("GET /health 200").waitFor();
  check(true, "docker logs render as a tool card with its output, not a bare Bash");

  // "@" autocompletes project files while typing.
  await page.getByRole("button", { name: "Enviar", exact: true }).waitFor({ timeout: 15000 }); // idle again (while Claude works the button says "Añadir a la cola")
  await page.getByLabel("Responder a Claude").fill("mira @trac");
  await page.getByRole("option", { name: /tracked\.txt/ }).waitFor({ timeout: 10000 });
  await page.getByLabel("Responder a Claude").press("Tab");
  check((await page.getByLabel("Responder a Claude").inputValue()) === "mira @tracked.txt ", "typing @ suggests project files and Tab inserts the chosen one");
  await page.getByLabel("Responder a Claude").fill("");

  // Branch switcher in the composer: create a branch from the chat and come back.
  await page.locator("button[aria-haspopup='listbox']").first().click();
  await page.getByLabel("Buscar rama").fill("nueva-ui");
  await page.getByRole("button", { name: /Crear y cambiar a «nueva-ui»/ }).click();
  await page.getByText("Rama «nueva-ui» creada").waitFor();
  check((await execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: project, encoding: "utf8" })).trim() === "nueva-ui", "the chat can create a branch and move the project to it");
  await page.locator("button[aria-haspopup='listbox']").first().click();
  await page.getByRole("option", { name: "main", exact: true }).click();
  await page.getByText("Ahora estás en «main»").waitFor();
  check((await execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: project, encoding: "utf8" })).trim() === "main", "the chat can switch back to another branch");

  // A reply whose tool result is a big screenshot must not stall the chat: the picture shows, and Claude's next message arrives.
  await page.getByRole("button", { name: "Enviar", exact: true }).waitFor({ timeout: 15000 }); // idle again (while Claude works the button says "Añadir a la cola")
  await page.getByLabel("Responder a Claude").fill("BIGIMG mira la captura");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await page.getByText("he visto la imagen").waitFor({ timeout: 15000 });
  await page.locator("main img[alt='Imagen de Claude']").first().waitFor({ timeout: 15000 });
  check(true, "a big screenshot in a tool result does not stall the chat: the picture shows and the conversation continues");

  // A change made through the terminal (not an Edit tool call) appears under that command, with its diff.
  await page.getByRole("button", { name: "Enviar", exact: true }).waitFor({ timeout: 15000 }); // idle again (while Claude works the button says "Añadir a la cola")
  await page.getByLabel("Responder a Claude").fill("BASHCHANGE hazlo por terminal");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  const terminalCard = page.locator("main").getByRole("button", { name: /Creó archivo\s*hecho-por-terminal\.txt/ });
  await terminalCard.waitFor({ timeout: 20000 });
  await page.locator("main").getByText("contenido nuevo").first().waitFor();
  check(true, "a file created through the terminal shows up in the chat under that command, with its code");
  fs.rmSync(path.join(project, "hecho-por-terminal.txt"), { force: true });

  // A plan renders as Markdown with three ways to answer it.
  await page.getByRole("button", { name: "Enviar", exact: true }).waitFor({ timeout: 15000 }); // idle again (while Claude works the button says "Añadir a la cola")
  await page.getByLabel("Responder a Claude").fill("/plan PLAN dame un plan");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await page.getByRole("heading", { name: "Plan de prueba" }).waitFor({ timeout: 15000 });
  check((await page.locator("main strong", { hasText: "Paso dos" }).count()) >= 1 && (await page.locator("main table").count()) >= 1, "the plan is rendered as Markdown (bold, table), not raw text");
  for (const name of ["Aceptar y ejecutar", "Rechazar", "Hablar con Claude"]) await page.getByRole("button", { name }).waitFor();
  check(true, "the plan offers Accept, Reject and Talk to Claude");
  await page.getByRole("button", { name: "Aceptar y ejecutar" }).click();
  await page.getByText("done: Apruebo el plan. Ejecútalo.").waitFor({ timeout: 15000 });
  const approved = (await (await fetch(base + "/api/runs", { headers: authH })).json()).runs.find((r) => r.prompt === "Apruebo el plan. Ejecútalo.");
  check(approved?.permissionMode === "acceptEdits", "accepting the plan continues the conversation with permission to edit");
  const withImg = (await (await fetch(base + "/api/runs", { headers: authH })).json()).runs.find((r) => r.prompt.includes("TOOLS mira esto"));
  check(withImg?.images?.length === 1 && withImg.prompt.includes("linea pegada 29"), "the message carries the image and the pasted text");
  check((await fetch(base + `/api/uploads/${withImg.images[0]}`, { headers: authH })).headers.get("content-type") === "image/png", "attached images are served back");

  // Stop a long-running run from the UI (regression: body-less POSTs were rejected with 415).
  const longRun = await (
    await fetch(base + "/api/runs", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ projectPath: project, prompt: "SLEEP" }) })
  ).json();
  await page.goto(`${base}/runs/${longRun.id}`);
  await page.getByText("en vivo").waitFor({ timeout: 10000 });
  await page.locator("main").getByText("some stderr line").waitFor({ timeout: 10000 });
  check((await fetch(base + `/api/runs/${longRun.id}`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json())).status === "running", "live log streams over SSE while the run is still running");
  // Live feedback while Claude works: the step, how long it has taken, the tokens written; the status text glows.
  await page.locator("main").getByText(/42 tokens/).waitFor({ timeout: 10000 });
  check(/\d+ s/.test(await page.locator("main [role=status]").first().innerText()) && (await page.locator("main .orb-text").count()) >= 1, "while Claude works the chat shows elapsed time, tokens and glowing status text");
  await shot("03g-live-status");
  check((await page.locator("aside").getByText("Claude trabajando").count()) === 0, "sidebar hides the live card on the run page (it already shows its own orb)");
  await page.goto(`${base}/tasks`);
  await page.locator("aside").getByText("Claude trabajando").waitFor({ timeout: 20000 });
  check(true, "sidebar shows the live orb while a run is working");
  await page.goto(`${base}/runs/${longRun.id}`);
  // While Claude works you can still write: the message waits in line (and is not sent yet).
  await page.getByLabel("Responder a Claude").fill("segundo mensaje en cola");
  await page.getByRole("button", { name: "Añadir a la cola" }).click();
  await page.getByLabel("Mensajes en cola").getByText("segundo mensaje en cola").waitFor({ timeout: 10000 });
  const queueApi = await (await fetch(base + `/api/runs/${longRun.id}/queue`, { headers: { authorization: `Bearer ${token}` } })).json();
  const threadRuns = (await (await fetch(base + "/api/runs", { headers: { authorization: `Bearer ${token}` } })).json()).runs.filter((r) => (r.threadId ?? r.id) === longRun.id);
  check(queueApi.queue.length === 1 && threadRuns.length === 1, "a message written while Claude works waits in the queue instead of being sent");
  await shot("03f-queue");
  // Stop from the chat box itself; the queue pauses and nothing is sent behind your back.
  await page.locator("form").getByRole("button", { name: "Detener" }).click();
  await page.locator("main").getByText("detenida", { exact: true }).waitFor({ timeout: 15000 });
  check(true, "stop a running run from the chat box");
  await page.getByLabel("Mensajes en cola").getByText(/Cola en pausa/).waitFor({ timeout: 10000 });
  check(true, "stopping pauses the queue (the user decides what to send)");
  await page.getByRole("button", { name: /Quitar de la cola/ }).click();
  await page.getByLabel("Mensajes en cola").waitFor({ state: "detached", timeout: 10000 });

  // Text streams in while Claude writes it (partial messages), before the complete message exists.
  const streamRun = await (
    await fetch(base + "/api/runs", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ projectPath: project, prompt: "STREAMTEXT" }) })
  ).json();
  await page.goto(`${base}/runs/${streamRun.id}`);
  await page.locator("main").getByText(/esto se va/).first().waitFor({ timeout: 10000 });
  await shot("03h-streaming");
  check(true, "the answer shows up while Claude is still writing it");

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
  const welcomeOrb = page.locator("main .orb").first();
  const seen = new Set();
  for (let i = 0; i < 3; i++) {
    seen.add(await welcomeOrb.getAttribute("data-state"));
    await page.waitForTimeout(3100);
  }
  check(seen.size >= 2, `the chat welcome shows the orb cycling through its states (${[...seen].join(", ")})`);
  await shot("05a-chat-empty");
  await page.getByLabel("Mensaje para Claude").fill("Hola Claude, ¿me explicas los closures?");
  await page.keyboard.press("Enter");
  await page.getByRole("navigation", { name: "Historial de chats" }).getByText("Hola Claude, ¿me explicas los closures?").waitFor();
  const chats = await (await fetch(base + "/api/chats", { headers: { authorization: `Bearer ${token}` } })).json();
  const chatRun = (await (await fetch(base + "/api/runs", { headers: { authorization: `Bearer ${token}` } })).json()).runs.find((r) => r.prompt.startsWith("Hola Claude"));
  check(chats.chats.length === 1 && chatRun && chatRun.projectPath.endsWith("/chat"), "chat starts a Claude conversation outside any project and keeps it in the history");
  await shot("05b-chat");
  // Reading the answer aloud, and talk mode (it reads, then it listens).
  await page.getByRole("button", { name: "Enviar", exact: true }).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Leer en voz alta" }).first().click();
  await page.getByTestId("speak-status").waitFor({ timeout: 5000 });
  const spoken = await page.evaluate(() => window.__spoken.join(" "));
  check(spoken.length > 5 && !/[`*#|]/.test(spoken), `«Leer en voz alta» reads the answer without markup (${spoken.slice(0, 40)}…)`);
  await page.keyboard.press("Escape");
  await page.getByTestId("speak-status").waitFor({ state: "detached", timeout: 5000 });
  check(true, "Esc silences the reading");
  await page.evaluate(() => (window.__srPhrase = "pregunta en modo voz"));
  await page.evaluate(() => (window.__spoken.length = 0));
  await page.getByRole("button", { name: "Modo voz" }).click();
  await page.getByTestId("voice-stage").waitFor();
  check(true, "talk mode takes over the screen: no message box, only the voice");
  await page.getByTestId("voice-stage-status").getByText("Te escucho…").first().waitFor({ timeout: 8000 });
  await page.getByTestId("voice-stage-caption").getByText("pregunta en modo voz").first().waitFor({ timeout: 5000 });
  check(true, "it listens by itself and shows the words as you speak");
  await shot("08c-voice-stage");
  await page.getByRole("button", { name: "Terminar de hablar" }).click();
  await page.waitForFunction(() => window.__spoken.length > 0, null, { timeout: 30000 });
  check(true, "in talk mode the answer is read aloud on its own");
  await page.getByTestId("voice-stage-caption").waitFor();
  await page.getByTestId("voice-stage-status").getByText("Te escucho…").first().waitFor({ timeout: 15000 });
  check(true, "and then it listens again");
  await page.evaluate(() => (window.__srPhrase = undefined));
  await page.getByRole("button", { name: "Salir del modo voz" }).click();
  await page.getByTestId("voice-stage").waitFor({ state: "detached", timeout: 5000 });
  check((await page.getByRole("button", { name: "Modo voz" }).getAttribute("aria-pressed")) === "false", "leaving talk mode brings the message box back");
  // Chat: edit a sent message, ↑ recalls the last one, stop a long answer, and a message waits its turn.
  await page.getByRole("button", { name: "Editar y reenviar" }).first().dispatchEvent("click");
  check((await page.getByLabel("Mensaje para Claude").inputValue()) === "Hola Claude, ¿me explicas los closures?", "«Editar y reenviar» puts a sent message back in the box");
  await page.getByLabel("Mensaje para Claude").fill("");
  await page.keyboard.press("ArrowUp");
  check((await page.getByLabel("Mensaje para Claude").inputValue()).includes("pregunta en modo voz"), "↑ in an empty box recalls the last message");
  await page.getByLabel("Mensaje para Claude").fill("SLEEP respuesta larga");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Detener" }).waitFor({ timeout: 10000 });
  await page.getByLabel("Mensaje para Claude").fill("después, otra cosa");
  await page.keyboard.press("Enter");
  await page.getByTestId("queued").waitFor();
  check(true, "a message written while Claude answers waits its turn");
  await page.getByRole("button", { name: "Detener" }).dispatchEvent("click");
  await page.getByTestId("queued").waitFor({ state: "detached", timeout: 15000 });
  await page.locator("main").getByText("después, otra cosa").first().waitFor({ timeout: 15000 });
  check(true, "stopping the answer sends the waiting message");
  // The local model: it corrects while you type (applied, undoable) and improves the prompt on request.
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  await fetch(base + "/api/ollama", { method: "PUT", headers: auth, body: JSON.stringify({ enabled: true, baseUrl: ollamaUrl, model: "fake:1b", autocorrect: "auto" }) });
  await page.goto(`${base}/chat`);
  const OBOX = "textarea[aria-label='Mensaje para Claude']";
  await page.locator(OBOX).waitFor();
  await page.waitForTimeout(600); // the settings reach the page
  await page.locator(OBOX).fill("hola q tal, tengo herrores en mi codigo");
  await page.waitForFunction((q) => document.querySelector(q).value === "hola qué tal, tengo errores en mi codigo", OBOX, { timeout: 8000 });
  check(true, "the local model corrects what is typed when you pause");
  await page.getByTestId("assist-chip").waitFor();
  await page.getByRole("button", { name: "Deshacer" }).click();
  check((await page.locator(OBOX).inputValue()) === "hola q tal, tengo herrores en mi codigo", "the correction can be undone");
  await page.locator(OBOX).fill("arregla el login que falla");
  await page.getByRole("button", { name: "Mejorar prompt" }).click();
  await page.waitForFunction((q) => document.querySelector(q).value === "## Objetivo\narregla el login que falla", OBOX, { timeout: 8000 });
  check(true, "«Mejorar prompt» rewrites and organises the prompt with the local model");
  // Word by word: each finished word is checked, and a wrong one is fixed on the spot, morphing.
  await fetch(base + "/api/ollama", { method: "PUT", headers: auth, body: JSON.stringify({ autocorrect: "words" }) });
  await page.goto(`${base}/chat`);
  await page.locator(OBOX).waitFor();
  await page.waitForTimeout(600);
  await page.locator(OBOX).click();
  await page.locator(OBOX).pressSequentially("dime q tengo herrores ", { delay: 45 });
  await page.getByTestId("word-morph").first().waitFor({ timeout: 8000 });
  check(true, "a corrected word morphs in place");
  await shot("08d-word-morph");
  await page.waitForFunction((q) => document.querySelector(q).value === "dime que tengo errores ", OBOX, { timeout: 8000 });
  check(true, "word by word: shorthand and typos are fixed as you type, without a pause");
  await page.locator(OBOX).pressSequentially("en el codigo y corrije escribiendo ", { delay: 45 });
  await page.waitForFunction((q) => document.querySelector(q).value === "dime que tengo errores en el código y corrige escribiendo ", OBOX, { timeout: 8000 });
  check(await page.locator(OBOX).evaluate((e) => e.selectionStart === e.value.length), "the caret stays where you were typing");
  await page.locator(OBOX).fill("");
  await page.goto(`${base}/settings`);
  await page.getByText("IA local (Ollama)").first().waitFor();
  await page.getByText("conectado", { exact: true }).waitFor({ timeout: 8000 });
  check((await page.getByLabel("Modelo de Ollama").inputValue()) === "fake:1b", "Ajustes shows the local model and that it is connected");
  await fetch(base + "/api/ollama", { method: "PUT", headers: auth, body: JSON.stringify({ enabled: false }) });
  await page.goto(`${base}/chat`);
  await page.getByRole("button", { name: /Nuevo chat/ }).first().waitFor();

  // A long curl pasted into the chat must not widen the conversation either.
  await page.getByRole("button", { name: /Nuevo chat/ }).first().click();
  const tok = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9".repeat(8);
  await page.getByLabel("Mensaje para Claude").fill(`CURLLONG curl -sS -H "Authorization: Bearer ${tok}" https://api.example.com/v1/${tok}?x=${tok}`);
  await page.keyboard.press("Enter");
  await page.locator("main").getByText(/Authorization: Bearer/).first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  const chatOv = await page.evaluate(() => { const w = document.documentElement.clientWidth; const c = document.querySelector("main .overflow-y-auto"); return { page: document.documentElement.scrollWidth - w, pane: c ? c.scrollWidth - c.clientWidth : 0 }; });
  await shot("05e-chat-curl");
  check(chatOv.page <= 1 && chatOv.pane <= 1, `a long curl in the chat does not overflow sideways ${JSON.stringify(chatOv)}`);

  // MCP servers: add a popular one through `claude mcp add`.
  await page.goto(`${base}/mcp`);
  await page.getByRole("heading", { name: "Servidores MCP" }).waitFor();
  await page.getByText("Agentic para Claude").first().waitFor();
  check((await page.getByLabel("Activar las herramientas de Agentic para Claude").getAttribute("aria-checked")) === "true", "Agentic's tools for Claude are on by default");
  await page.getByLabel("Que Claude pueda escribir en Agentic").click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Que Claude pueda escribir en Agentic"]')?.getAttribute("aria-checked") === "true");
  r = await fetch(base + "/api/agentic-mcp/settings", { headers: { authorization: `Bearer ${token}` } });
  check((await r.json()).settings.write === true, "allowing Claude to write is saved");
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

  // Mail: connect an account (offline fixture), messages get filed by project and type, nothing leaks.
  await page.goto(`${base}/mail`);
  await page.getByRole("button", { name: "Conectar correo" }).first().click();
  await page.getByLabel("Correo", { exact: true }).fill("yo@gmail.com");
  await page.getByLabel("Contraseña de aplicación").fill("bad");
  const mailErrorsBefore = consoleErrors.length;
  await page.getByRole("button", { name: "Conectar", exact: true }).click();
  await page.getByRole("alert").getByText(/contraseña de aplicación/).waitFor();
  consoleErrors.splice(mailErrorsBefore); // the rejected wrong password is expected
  await page.getByLabel("Contraseña de aplicación").fill("app-pass-123");
  await page.getByRole("button", { name: "Conectar", exact: true }).click();
  await page.getByText("Bug en demo-app al pagar").waitFor({ timeout: 15000 });
  const mailOverview = JSON.stringify(await (await fetch(base + "/api/mail", { headers: authH })).json());
  check(!mailOverview.includes("app-pass-123"), "the mail password is never returned by the API");
  check((await page.getByRole("heading", { name: /demo-app/ }).count()) + (await page.getByText("demo-app", { exact: true }).count()) > 0 && (await page.getByText("Factura de octubre").count()) === 1, "mail is filed under the project named in the subject");
  // Open a message: its text shows and it is marked read; mark it unread again by hand.
  await page.getByRole("button", { name: /Bug en demo-app al pagar/ }).click();
  const mailFrame = page.frameLocator("iframe[title^='Contenido']");
  await mailFrame.getByText("esto es el HTML original").waitFor();
  const frameAttrs = await page.locator("iframe[title^='Contenido']").getAttribute("sandbox");
  check(!/allow-scripts|allow-same-origin/.test(frameAttrs ?? "x") && !JSON.stringify(await (await fetch(base + "/api/mail", { headers: authH })).json()).includes("<script"), "the original HTML of a mail is shown in a sandbox (no scripts, no same-origin)");
  await page.getByRole("button", { name: "Ver como texto" }).click();
  await page.getByText("Texto completo del correo de Ana.").waitFor();
  await page.getByRole("button", { name: "Marcar sin leer" }).first().waitFor();
  check(true, "opening a mail shows its text and marks it read");
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "a mail with a very long link does not widen the page (desktop)");
  await page.getByRole("button", { name: "Marcar sin leer" }).first().click();
  await page.getByRole("button", { name: "Marcar leído" }).first().waitFor();
  await page.getByRole("button", { name: "Ver el mensaje original" }).click();
  // A second account can be added.
  await page.getByRole("button", { name: "Añadir otra cuenta" }).click();
  await page.getByLabel("Correo", { exact: true }).fill("trabajo@empresa.com");
  await page.getByLabel("Contraseña de aplicación").fill("otra-pass");
  await page.getByRole("button", { name: "Conectar", exact: true }).click();
  await page.getByText("trabajo@empresa.com").first().waitFor();
  check(((await (await fetch(base + "/api/mail", { headers: authH })).json()).accounts ?? []).length === 2, "more than one mail account can be connected");
  // Phone width: nothing spills out of the screen.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(300);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "the mail page fits a phone screen (no horizontal overflow)");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("tab", { name: "Por tipo" }).click();
  await page.getByText("Facturas y pagos").first().waitFor();
  check(!fs.readFileSync(path.join(dataDir, "mail-accounts.json"), "utf8").includes("app-pass-123"), "the mail password is encrypted at rest");
  await shot("12-mail");

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

  // New PR from the UI: pick a branch with commits, the app pushes it and opens the PR.
  execFileSync("git", ["checkout", "-q", "-b", "feat/nueva"], { cwd: project });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "Nueva desde la UI"], { cwd: project });
  execFileSync("git", ["checkout", "-q", "main"], { cwd: project });
  await page.goto(`${base}/pulls`);
  await page.getByRole("button", { name: "Nueva PR" }).click();
  await page.getByLabel("Título").waitFor();
  await page.waitForFunction(() => document.querySelector("#pr-title")?.value === "Nueva desde la UI");
  check((await page.locator("#pr-head").inputValue()) === "feat/nueva", "new PR dialog proposes the branch that has commits and its last commit as the title");
  // Claude writes the title and description (streamed into the fields).
  await page.getByRole("button", { name: "Generar con Claude" }).click();
  await page.locator("#pr-body").evaluate((el) => new Promise((r) => { const t = setInterval(() => { if (el.value.includes("Resumen")) { clearInterval(t); r(0); } }, 50); }));
  check((await page.locator(".orb-border").count()) >= 1, "while Claude writes the description the fields glow in the orb colours");
  await shot("12c-pr-generating");
  await page.waitForFunction(() => document.querySelector("#pr-title")?.value === "Añade login con Touch ID" && document.querySelector("#pr-body")?.value.includes("Nuevo botón de acceso"), null, { timeout: 20000 });
  await page.getByRole("button", { name: "Generar con Claude" }).waitFor();
  check(true, "the new PR dialog can have Claude write the title and description");
  await page.getByRole("button", { name: "Crear pull request" }).click();
  await page.getByText("PR #13 creada").waitFor();
  const uiPr = ghWrites.find((w) => w.method === "POST" && w.path === "/repos/acme/demo/pulls" && w.body.head === "feat/nueva");
  check(uiPr?.body.base === "main" && uiPr.body.title === "Añade login con Touch ID" && uiPr.body.body.includes("Permite entrar con la huella.") && execFileSync("git", ["branch", "--list", "feat/nueva"], { cwd: bareRemote, encoding: "utf8" }).includes("feat/nueva"), "new PR from the Pull requests page: branch pushed and PR opened");
  await page.getByText("PR #13 creada").waitFor({ state: "detached", timeout: 15000 });

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
  const prCall = ghWrites.find((w) => w.method === "POST" && w.path === "/repos/acme/demo/pulls" && w.body.head !== "feat/nueva");
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
  // Touch ID must never pop up by itself: the page only waits for the click. (Counted through a hook on WebAuthn.)
  await page.evaluate(() => {
    window.__credGets = 0;
    const orig = navigator.credentials.get.bind(navigator.credentials);
    navigator.credentials.get = (...a) => (window.__credGets++, orig(...a));
  });
  await page.reload();
  await page.getByRole("button", { name: "Entrar con Touch ID" }).waitFor();
  await page.evaluate(() => {
    window.__credGets = window.__credGets || 0;
    const orig = navigator.credentials.get.bind(navigator.credentials);
    navigator.credentials.get = (...a) => (window.__credGets++, orig(...a));
  });
  await page.waitForTimeout(2800);
  check((await page.evaluate(() => window.__credGets)) === 0 && !(await page.getByRole("button", { name: "Entrar con Touch ID" }).isDisabled()), "the login page does not start Touch ID by itself");
  check((await page.locator("main .orb").count()) === 1, "the login shows the AI orb");
  const orbStates = new Set();
  for (let i = 0; i < 4; i++) {
    orbStates.add(await page.locator("main .orb").first().getAttribute("data-state"));
    await page.waitForTimeout(3100);
  }
  check(orbStates.size >= 3, `the login orb keeps changing state (${[...orbStates].join(", ")})`);
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
  ollama.close();
  github.close();
  jira.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll smoke checks passed");
process.exit(failures.length ? 1 : 0);
