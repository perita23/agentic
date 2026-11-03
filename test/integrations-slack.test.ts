import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request, safeBaseUrl } from "@/lib/server/integrations/http";
import { createContext, type Context } from "@/lib/server/context";
import { FAKE_CLAUDE, tmpDir, waitFor } from "./helpers";

let legacyScopes = false; // app created before DMs were supported (no im:read)

const TOKEN = "xoxb-test-123";
let server: http.Server;
let base: string;
const posted: Record<string, unknown>[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    const send = (o: unknown, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(o));
    };
    if (url.pathname === "/redirect") {
      res.writeHead(302, { location: "http://example.com/" });
      return res.end();
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send({ ok: false, error: "invalid_auth" });
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      switch (url.pathname) {
        case "/auth.test":
          return send({ ok: true, user: "agentic-bot", team: "Acme" });
        case "/users.list":
          return send({ ok: true, members: [{ id: "U1", name: "ana", profile: { display_name: "Ana" } }] });
        case "/conversations.list": {
          const types = url.searchParams.get("types") ?? "";
          if (types.includes("im") && legacyScopes) return send({ ok: false, error: "missing_scope" });
          const chans: unknown[] = [{ id: "C02RND", name: "random", is_private: false, is_member: false }, { id: "C01DEV", name: "dev", is_private: false, is_member: true }];
          if (types.includes("im")) chans.push({ id: "D01ANA", is_im: true, user: "U1", updated: 10 }, { id: "G01GRP", name: "mpdm-ana--luis-1", is_mpim: true, updated: 20 });
          return send({ ok: true, channels: chans });
        }
        case "/conversations.history":
          if (url.searchParams.get("channel") === "C0404X") return send({ ok: false, error: "channel_not_found" });
          return send({
            ok: true,
            messages: [
              { ts: "1700000002.000200", user: "U1", text: "segundo <@U1>", reply_count: 2, thread_ts: "1700000002.000200" },
              { ts: "1700000001.000100", subtype: "channel_join", user: "U1", text: "joined" },
              { ts: "1700000000.000100", bot_profile: { name: "CI" }, subtype: "bot_message", text: "<script>x</script>" },
            ],
          });
        case "/conversations.replies":
          return send({ ok: true, messages: [{ ts: url.searchParams.get("ts"), user: "U1", text: "raíz" }, { ts: "1700000003.000300", user: "U9", text: "respuesta" }] });
        case "/chat.postMessage":
          posted.push(JSON.parse(body));
          return send({ ok: true, ts: "1700000009.000900" });
        default:
          return send({ ok: false, error: "unknown_method" }, 404);
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  process.env.AGENTIC_ALLOW_INSECURE_INTEGRATIONS = "1";
  process.env.AGENTIC_SLACK_API_URL = base;
});
afterAll(() => {
  server.close();
  delete process.env.AGENTIC_ALLOW_INSECURE_INTEGRATIONS;
  delete process.env.AGENTIC_SLACK_API_URL;
});

const make = (): Context => createContext({ dataDir: tmpDir(), claudeHome: tmpDir(), claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 2, maxLogBytes: 1e6 });

describe("Slack integration", () => {
  it("validates config and never exposes the token", () => {
    const c = make();
    expect(() => c.integrations.configure("slack", { botToken: "nope" })).toThrow(/xoxb/);
    expect(() => c.integrations.configure("slack", { botToken: TOKEN, webhookUrl: "https://evil.example/hook" })).toThrow(/hooks.slack.com/);
    expect(() => c.integrations.configure("slack", { botToken: TOKEN, notifyChannel: "#general" })).toThrow();
    expect(() => c.integrations.configure("nope", {})).toThrow(/desconocida/);
    c.integrations.configure("slack", { botToken: TOKEN, notifyChannel: "C01DEV" });
    const st = JSON.stringify(c.integrations.status());
    expect(st).not.toContain(TOKEN);
    expect(st).toContain("xoxb…-123");
    // Editing without re-entering the token (or the webhook) keeps them.
    c.integrations.configure("slack", { webhookUrl: "https://hooks.slack.com/services/T0/B0/xyz" });
    c.integrations.configure("slack", { notifyChannel: "C02RND" });
    expect(c.integrations.status().slack).toMatchObject({ configured: true, notifyChannel: "C02RND", webhookUrl: "hooks.slack.com/…/xyz" });
    c.integrations.configure("slack", { botToken: "" });
    expect(c.integrations.status().slack).toMatchObject({ configured: true, secretHint: "xoxb…-123" });
    const file = path.join(c.config.dataDir, "integrations.json");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    c.integrations.remove("slack");
    expect(c.integrations.status().slack).toEqual({ configured: false });
  });

  it("tests the connection, lists channels and reads history and threads", async () => {
    const c = make();
    c.integrations.configure("slack", { botToken: TOKEN });
    expect(await c.integrations.test("slack")).toEqual({ ok: true, account: "agentic-bot @ Acme" });
    const channels = await c.integrations.slackChannels();
    // Channels first (member ones on top), then DMs and group DMs by recent activity.
    expect(channels.map((x) => [x.name, x.kind])).toEqual([
      ["dev", "channel"],
      ["random", "channel"],
      ["Ana, luis", "group"],
      ["Ana", "dm"],
    ]);
    legacyScopes = true;
    expect((await c.integrations.slackChannels()).map((x) => x.name)).toEqual(["dev", "random"]);
    legacyScopes = false;
    const h = await c.integrations.slackHistory("C01DEV");
    expect(h.messages.map((m) => m.text)).toEqual(["<script>x</script>", "segundo @Ana"]); // oldest first, joins hidden
    expect(h.messages[1]).toMatchObject({ author: "Ana", replyCount: 2 });
    expect(h.messages[0].author).toBe("CI");
    const r = await c.integrations.slackReplies("C01DEV", "1700000002.000200");
    expect(r.messages.map((m) => m.author)).toEqual(["Ana", "U9"]);
  });

  it("posts messages and thread replies, validating ids", async () => {
    const c = make();
    c.integrations.configure("slack", { botToken: TOKEN });
    posted.length = 0;
    await c.integrations.slackPost("C01DEV", "hola");
    await c.integrations.slackPost("C01DEV", "en hilo", "1700000002.000200");
    expect(posted).toEqual([
      { channel: "C01DEV", text: "hola", unfurl_links: false },
      { channel: "C01DEV", text: "en hilo", thread_ts: "1700000002.000200", unfurl_links: false },
    ]);
    await expect(c.integrations.slackPost("C01DEV;x", "x")).rejects.toMatchObject({ status: 400 });
    await expect(c.integrations.slackReplies("C01DEV", "../x")).rejects.toMatchObject({ status: 400 });
  });

  it("maps Slack errors to readable 502s", async () => {
    const c = make();
    c.integrations.configure("slack", { botToken: TOKEN });
    await expect(c.integrations.slackHistory("C0404X")).rejects.toMatchObject({ status: 502, message: "Slack: canal no encontrado" });
    c.integrations.configure("slack", { botToken: "xoxb-wrong" });
    await expect(c.integrations.test("slack")).rejects.toMatchObject({ status: 502, message: "Slack: token no válido" });
  });

  it("notifies the configured channel when a run finishes (respecting onlyFailures)", async () => {
    const c = make();
    c.integrations.configure("slack", { botToken: TOKEN, notifyChannel: "C01DEV", events: { runFinished: true, queueFinished: true, onlyFailures: false } });
    posted.length = 0;
    const r = await c.runs.start({ projectPath: tmpDir(), prompt: "hola <!channel>" });
    await waitFor(() => posted.length === 1);
    expect(String(posted[0].text)).toContain("ejecución completed");
    expect(String(posted[0].text)).toContain("&lt;!channel&gt;"); // user text cannot ping @channel
    expect(c.runs.get(r.id).status).toBe("completed");

    c.integrations.configure("slack", { notifyChannel: "C01DEV", events: { runFinished: true, queueFinished: true, onlyFailures: true } });
    posted.length = 0;
    const ok = await c.runs.start({ projectPath: tmpDir(), prompt: "fine" });
    await waitFor(() => c.runs.get(ok.id).status !== "running");
    const bad = await c.runs.start({ projectPath: tmpDir(), prompt: "FAIL" });
    await waitFor(() => c.runs.get(bad.id).status !== "running" && posted.length === 1);
    expect(String(posted[0].text)).toContain("failed");
  });
});

describe("integration HTTP client", () => {
  it("requires https unless explicitly allowed, and rejects credentials in URLs", () => {
    delete process.env.AGENTIC_ALLOW_INSECURE_INTEGRATIONS;
    expect(() => safeBaseUrl("http://example.com", "x")).toThrow(/https/);
    process.env.AGENTIC_ALLOW_INSECURE_INTEGRATIONS = "1";
    expect(() => safeBaseUrl("https://user:pass@example.com", "x")).toThrow(/credenciales/);
    expect(() => safeBaseUrl("not a url", "x")).toThrow();
  });

  it("never follows redirects or leaves the configured origin", async () => {
    await expect(request("T", new URL(base), "redirect")).rejects.toMatchObject({ message: "T: redirección no permitida" });
    await expect(request("T", new URL(base), "https://evil.example/steal")).rejects.toMatchObject({ message: "T: destino no permitido" });
    await expect(request("T", new URL(base), "//evil.example/x")).rejects.toMatchObject({ message: "T: destino no permitido" });
  });
});
