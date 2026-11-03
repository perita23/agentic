import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "@/lib/server/context";
import { OAuthService } from "@/lib/server/integrations/oauth";
import { FAKE_CLAUDE, tmpDir } from "./helpers";

/** One stand-in for GitHub, Atlassian and Bitbucket (their paths don't overlap). */
const calls: { method: string; path: string; body: string; auth?: string }[] = [];
let server: http.Server;
let base = "";
let devicePolls = 0;
let jiraRefreshes = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const p = new URL(req.url!, "http://x").pathname;
      calls.push({ method: req.method!, path: p, body: raw, auth: req.headers.authorization });
      const json = (o: unknown, status = 200) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(o));
      };
      const form = new URLSearchParams(raw);
      const body = raw.startsWith("{") ? JSON.parse(raw) : {};
      // GitHub
      if (p === "/login/device/code") return json({ device_code: "dev-1", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 1 });
      if (p === "/login/oauth/access_token") {
        if (form.get("device_code") !== "dev-1" || form.get("client_id") !== "gh-client") return json({ error: "bad_verification_code" });
        return ++devicePolls < 2 ? json({ error: "authorization_pending" }) : json({ access_token: "gho_devicetoken000000000000" });
      }
      if (p === "/user" && /^Bearer gh[op]_/.test(req.headers.authorization ?? "")) return json({ login: "perita" });
      // Atlassian
      if (p === "/oauth/token") {
        if (body.client_id !== "jira-client" || body.client_secret !== "jira-secret") return json({ error: "invalid_client" }, 401);
        if (body.grant_type === "authorization_code" && body.code === "jira-code" && body.redirect_uri === "http://localhost:4317/api/integrations/oauth/callback")
          return json({ access_token: "jira-access-1", refresh_token: "jira-refresh-1", expires_in: 3600 });
        if (body.grant_type === "refresh_token" && body.refresh_token === "jira-refresh-1") {
          jiraRefreshes++;
          return json({ access_token: "jira-access-2", refresh_token: "jira-refresh-2", expires_in: 3600 });
        }
        return json({ error: "invalid_grant" }, 400);
      }
      if (p === "/oauth/token/accessible-resources") return json([{ id: "cloud-1", url: "https://acme.atlassian.net", name: "Acme", scopes: ["read:jira-work"] }]);
      if (p === "/ex/jira/cloud-1/rest/api/3/myself") {
        return req.headers.authorization === "Bearer jira-access-1" || req.headers.authorization === "Bearer jira-access-2" ? json({ displayName: "Ana" }) : json({}, 401);
      }
      // Bitbucket
      if (p === "/site/oauth2/access_token") {
        if (req.headers.authorization !== `Basic ${Buffer.from("bb-key:bb-secret").toString("base64")}`) return json({ error: "invalid_client" }, 401);
        if (form.get("grant_type") === "authorization_code" && form.get("code") === "bb-code") return json({ access_token: "bb-access", refresh_token: "bb-refresh", expires_in: 7200 });
        return json({ error: "invalid_grant" }, 400);
      }
      // Slack
      if (p === "/api/oauth.v2.access") {
        if (form.get("client_id") !== "slack-client" || form.get("client_secret") !== "slack-secret") return json({ ok: false, error: "invalid_client" });
        if (form.get("code") !== "slack-code" || form.get("redirect_uri") !== "https://relay.test/oauth/") return json({ ok: false, error: "invalid_code" });
        return json({ ok: true, authed_user: { id: "U1", access_token: "xoxp-user-token-123" }, access_token: "xoxb-not-used", team: { name: "Acme" } });
      }
      if (p === "/2.0/user") return req.headers.authorization === "Bearer bb-access" ? json({ display_name: "Ana BB" }) : json({}, 401);
      json({ error: "not found" }, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.AGENTIC_ALLOW_INSECURE_INTEGRATIONS = "1";
  process.env.AGENTIC_ATLASSIAN_API_URL = base;
  process.env.AGENTIC_OAUTH_RELAY = ""; // loopback redirect unless a test opts into the relay
});
afterAll(() => {
  server.close();
  delete process.env.AGENTIC_ALLOW_INSECURE_INTEGRATIONS;
  delete process.env.AGENTIC_ATLASSIAN_API_URL;
  delete process.env.AGENTIC_OAUTH_RELAY;
});

function setup(opts: { ghPaths?: string[] } = {}) {
  const c = createContext({ dataDir: tmpDir(), claudeHome: tmpDir(), claudeBin: FAKE_CLAUDE, maxConcurrentRuns: 2, maxLogBytes: 1e6 });
  const endpoints = { slackWeb: base, githubWeb: base, githubApi: base, atlassianAuth: base, atlassianApi: base, bitbucketWeb: base, bitbucketApi: `${base}/2.0` };
  const oauth = new OAuthService(c.store, c.integrations, { endpoints, ghPaths: opts.ghPaths ?? ["/nonexistent/gh"], pollScale: 1 });
  return { c, oauth };
}

async function until<T>(fn: () => T | undefined, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("GitHub", () => {
  it("connects with the device flow once the user approves", async () => {
    const { c, oauth } = setup();
    await expect(oauth.startGithubDevice()).rejects.toThrow(/app OAuth de GitHub/);
    oauth.setApp("github", { clientId: "gh-client" });
    const flow = await oauth.startGithubDevice();
    expect(flow).toMatchObject({ userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", status: "pending" });
    const done = await until(() => (oauth.deviceStatus(flow.id).status !== "pending" ? oauth.deviceStatus(flow.id) : undefined));
    expect(done).toMatchObject({ status: "connected", account: "perita" });
    expect(c.integrations.status().github).toMatchObject({ configured: true, source: "oauth" });
    expect(c.integrations.connection("github")?.token).toBe("gho_devicetoken000000000000");
  });

  it("reuses the GitHub CLI login", async () => {
    const dir = tmpDir();
    const gh = path.join(dir, "gh");
    fs.writeFileSync(gh, `#!/usr/bin/env node\nif (process.argv.slice(2).join(" ").startsWith("auth token")) console.log("gho_fromtheclitoken0000000");\n`, { mode: 0o755 });
    const { c, oauth } = setup({ ghPaths: [gh] });
    await oauth.connectGithubCli();
    expect(c.integrations.status().github).toMatchObject({ configured: true, source: "gh" });
    expect((await c.integrations.test("github")).account).toBe("perita");
  });

  it("explains how to log in when there is no gh session", async () => {
    const { oauth } = setup();
    await expect(oauth.connectGithubCli()).rejects.toThrow(/gh auth login/);
  });
});

describe("Jira (Atlassian 3LO)", () => {
  it("connects through the browser, calls Jira via the API gateway and refreshes the token", async () => {
    const { c, oauth } = setup();
    oauth.setApp("jira", { clientId: "jira-client", clientSecret: "jira-secret" });
    const { url } = oauth.start("jira", "http://localhost:4317");
    const u = new URL(url);
    expect(u.pathname).toBe("/authorize");
    expect(u.searchParams.get("client_id")).toBe("jira-client");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:4317/api/integrations/oauth/callback");
    expect(u.searchParams.get("scope")).toContain("offline_access");
    const state = u.searchParams.get("state")!;
    expect(state).toMatch(/^4317\.[\w-]{43,}$/);

    expect(await oauth.callback(state, "jira-code", null)).toEqual({ provider: "Jira", account: "Acme" });
    // The state is single-use.
    await expect(oauth.callback(state, "jira-code", null)).rejects.toThrow(/caducó/);
    expect(c.integrations.status().jira).toMatchObject({ configured: true, auth: "oauth", siteUrl: "https://acme.atlassian.net", cloudId: "cloud-1" });
    expect(JSON.stringify(c.integrations.status())).not.toContain("jira-refresh");
    expect(JSON.stringify(oauth.appsStatus())).not.toContain("jira-secret");
    expect((await c.integrations.test("jira")).account).toBe("Ana");

    // About to expire: renewed once, with the rotated refresh token stored.
    c.integrations.saveConnection("jira", { expiresAt: Date.now() + 1000 });
    await Promise.all([c.integrations.test("jira"), c.integrations.test("jira")]);
    expect(jiraRefreshes).toBe(1);
    expect(c.integrations.connection("jira")).toMatchObject({ token: "jira-access-2", refreshToken: "jira-refresh-2" });
    expect(calls.filter((x) => x.path.endsWith("/myself")).at(-1)?.auth).toBe("Bearer jira-access-2");
  });

  it("rejects unknown states and a denied authorization", async () => {
    const { oauth } = setup();
    oauth.setApp("jira", { clientId: "jira-client", clientSecret: "jira-secret" });
    await expect(oauth.callback("forged", "jira-code", null)).rejects.toThrow(/caducó/);
    const state = new URL(oauth.start("jira", "http://localhost:4317").url).searchParams.get("state");
    await expect(oauth.callback(state, null, "access_denied")).rejects.toThrow(/cancelado/);
  });

  it("requires the client secret for Jira and Bitbucket", () => {
    const { oauth } = setup();
    expect(() => oauth.setApp("jira", { clientId: "jira-client" })).toThrow(/Secret es obligatorio/);
    expect(() => oauth.start("jira", "http://localhost:4317")).toThrow(/app OAuth de Jira/);
  });
});

describe("Bitbucket", () => {
  it("connects with the authorization code and uses the bearer token", async () => {
    const { c, oauth } = setup();
    oauth.setApp("bitbucket", { clientId: "bb-key", clientSecret: "bb-secret" });
    const u = new URL(oauth.start("bitbucket", "http://localhost:4317").url);
    expect(u.pathname).toBe("/site/oauth2/authorize");
    expect(await oauth.callback(u.searchParams.get("state"), "bb-code", null)).toEqual({ provider: "Bitbucket", account: "Ana BB" });
    expect(c.integrations.status().bitbucket).toMatchObject({ configured: true, auth: "oauth" });
    expect((await c.integrations.test("bitbucket")).account).toBe("Ana BB");
  });
});

describe("Slack and the HTTPS relay", () => {
  it("connects Slack with a user token through the relay redirect", async () => {
    process.env.AGENTIC_OAUTH_RELAY = "https://relay.test/oauth/";
    try {
      const { c, oauth } = setup();
      oauth.setApp("slack", { clientId: "slack-client", clientSecret: "slack-secret" });
      expect(oauth.redirectUri("http://localhost:4317")).toBe("https://relay.test/oauth/");
      const u = new URL(oauth.start("slack", "http://localhost:4317").url);
      expect(u.pathname).toBe("/oauth/v2/authorize");
      expect(u.searchParams.get("redirect_uri")).toBe("https://relay.test/oauth/");
      expect(u.searchParams.get("user_scope")).toContain("im:history");
      expect(u.searchParams.get("state")).toMatch(/^4317\./);
      expect(await oauth.callback(u.searchParams.get("state"), "slack-code", null)).toEqual({ provider: "Slack", account: "Acme" });
      expect(c.integrations.connection("slack")?.botToken).toBe("xoxp-user-token-123");
      expect(c.integrations.status().slack).toMatchObject({ configured: true });
    } finally {
      process.env.AGENTIC_OAUTH_RELAY = "";
    }
  });

  it("uses apps shipped with the build unless one is configured in the app", () => {
    process.env.AGENTIC_SLACK_CLIENT_ID = "built-in-id";
    process.env.AGENTIC_SLACK_CLIENT_SECRET = "built-in-secret";
    try {
      const { oauth } = setup();
      expect(oauth.appsStatus().slack).toEqual({ configured: true, clientId: "built-in-id", builtIn: true });
      expect(JSON.stringify(oauth.appsStatus())).not.toContain("built-in-secret");
      oauth.setApp("slack", { clientId: "mine", clientSecret: "my-secret" });
      expect(oauth.appsStatus().slack).toEqual({ configured: true, clientId: "mine", builtIn: false });
    } finally {
      delete process.env.AGENTIC_SLACK_CLIENT_ID;
      delete process.env.AGENTIC_SLACK_CLIENT_SECRET;
    }
  });
});
