import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { promisify } from "node:util";
import { z } from "zod";
import type { JsonStore } from "../store";
import { HttpError, parse } from "../util";
import { request } from "./http";
import type { IntegrationService } from "./service";

const execFileP = promisify(execFile);

/**
 * "Conectar con …" buttons instead of pasting tokens.
 *
 * - GitHub: OAuth device flow (the user types a code on github.com; no client
 *   secret, no redirect), or reuse the token of the GitHub CLI (`gh auth token`).
 * - Jira (Atlassian 3LO) and Bitbucket: authorization-code flow through the
 *   browser with a loopback redirect to this server; access tokens are renewed
 *   with the refresh token when they are about to expire.
 *
 * Each provider needs an OAuth app registered once by the user (client id and,
 * for Jira/Bitbucket, a secret). They are stored locally (0600) or read from
 * AGENTIC_<PROVIDER>_CLIENT_ID / _CLIENT_SECRET, and never sent to the browser.
 */
export type OAuthProvider = "github" | "jira" | "bitbucket";
const APP_PROVIDERS = ["github", "jira", "bitbucket"] as const;

export interface Endpoints {
  githubWeb: string; // https://github.com
  githubApi: string; // https://api.github.com
  atlassianAuth: string; // https://auth.atlassian.com
  atlassianApi: string; // https://api.atlassian.com
  bitbucketWeb: string; // https://bitbucket.org
  bitbucketApi: string; // https://api.bitbucket.org/2.0
}

const DEFAULT_ENDPOINTS: Endpoints = {
  githubWeb: "https://github.com",
  githubApi: "https://api.github.com",
  atlassianAuth: "https://auth.atlassian.com",
  atlassianApi: "https://api.atlassian.com",
  bitbucketWeb: "https://bitbucket.org",
  bitbucketApi: "https://api.bitbucket.org/2.0",
};

export const CALLBACK_PATH = "/api/integrations/oauth/callback";
const GITHUB_SCOPES = "repo read:org read:user";
const JIRA_SCOPES = "read:jira-work write:jira-work read:jira-user offline_access";
const FLOW_TTL = 10 * 60_000;
const F = "oauth-apps";

type Apps = Partial<Record<OAuthProvider, { clientId: string; clientSecret?: string }>>;

const appSchema = z
  .object({
    clientId: z.string().trim().min(4).max(200).regex(/^[\w.~-]+$/, "Client ID no válido"),
    clientSecret: z.string().trim().max(500).regex(/^[^\s\0]*$/, "Secret no válido").optional(),
  })
  .strict();

interface PendingFlow {
  provider: "jira" | "bitbucket";
  redirectUri: string;
  createdAt: number;
}

export interface DeviceFlow {
  id: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  status: "pending" | "connected" | "expired" | "denied" | "error";
  account?: string;
  error?: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export class OAuthService {
  private flows = new Map<string, PendingFlow>();
  private devices = new Map<string, DeviceFlow>();
  private readonly ep: Endpoints;

  constructor(
    private store: JsonStore,
    private integrations: IntegrationService,
    opts: { endpoints?: Partial<Endpoints>; ghPaths?: string[]; pollScale?: number } = {},
  ) {
    this.ep = { ...DEFAULT_ENDPOINTS, ...opts.endpoints };
    this.ghPaths = opts.ghPaths ?? ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh"];
    this.pollScale = opts.pollScale ?? 1000;
    integrations.refresher = (p) => this.refresh(p);
  }
  private ghPaths: string[];
  private pollScale: number;

  // ---------- OAuth apps (client credentials) ----------

  private apps(): Apps {
    const stored = this.store.read<Apps>(F, {});
    const out: Apps = { ...stored };
    for (const p of APP_PROVIDERS) {
      const id = process.env[`AGENTIC_${p.toUpperCase()}_CLIENT_ID`];
      if (id) out[p] = { clientId: id, clientSecret: process.env[`AGENTIC_${p.toUpperCase()}_CLIENT_SECRET`] };
    }
    return out;
  }

  private app(p: OAuthProvider) {
    const a = this.apps()[p];
    if (!a?.clientId || (p !== "github" && !a.clientSecret)) throw new HttpError(400, `Configura primero la app OAuth de ${LABEL[p]}`);
    return a as { clientId: string; clientSecret: string };
  }

  /** What the UI may know: which apps are configured and the Client ID (never the secret). */
  appsStatus() {
    const a = this.apps();
    return Object.fromEntries(APP_PROVIDERS.map((p) => [p, { configured: !!a[p]?.clientId && (p === "github" || !!a[p]?.clientSecret), clientId: a[p]?.clientId ?? null }]));
  }

  setApp(provider: string, body: unknown) {
    const p = appProvider(provider);
    const data = parse(appSchema, body);
    if (p !== "github" && !data.clientSecret && !this.store.read<Apps>(F, {})[p]?.clientSecret) throw new HttpError(400, "El Client Secret es obligatorio");
    this.store.update<Apps>(F, {}, (apps) => {
      const prev = apps[p];
      // An empty secret keeps the stored one, so the Client ID can be edited alone.
      apps[p] = { clientId: data.clientId, ...(p !== "github" ? { clientSecret: data.clientSecret || prev?.clientSecret } : {}) };
    });
    return this.appsStatus()[p];
  }

  removeApp(provider: string) {
    const p = appProvider(provider);
    this.store.update<Apps>(F, {}, (apps) => {
      delete apps[p];
    });
  }

  // ---------- GitHub CLI ----------

  /** Reuse the token of the GitHub CLI (`gh auth login`), validated against the API. */
  async connectGithubCli() {
    let token = "";
    for (const bin of this.ghPaths) {
      if (bin !== "gh" && !fs.existsSync(bin)) continue;
      try {
        const { stdout } = await execFileP(bin, ["auth", "token", "--hostname", "github.com"], { timeout: 8000 });
        token = stdout.trim();
        if (token) break;
      } catch {}
    }
    if (!/^[\w-]{20,255}$/.test(token)) throw new HttpError(400, "No hay sesión del CLI de GitHub. Instala gh y ejecuta «gh auth login», o usa «Conectar con GitHub».");
    const me = await this.githubUser(token);
    return this.integrations.saveConnection("github", { token, source: "gh", apiUrl: this.ep.githubApi, account: me });
  }

  private async githubUser(token: string) {
    const me = await request<{ login: string }>("GitHub", new URL(this.ep.githubApi.replace(/\/?$/, "/")), "user", {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
    });
    return me.login;
  }

  // ---------- GitHub device flow ----------

  async startGithubDevice(): Promise<DeviceFlow> {
    const { clientId } = this.app("github");
    const res = await request<{ device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number; error?: string }>(
      "GitHub",
      new URL(this.ep.githubWeb),
      "/login/device/code",
      { method: "POST", form: { client_id: clientId, scope: GITHUB_SCOPES } },
    );
    if (!res?.device_code) throw new HttpError(502, `GitHub: ${res?.error ?? "no se pudo iniciar"}. ¿Activaste «Enable Device Flow» en la app OAuth?`);
    const flow: DeviceFlow = {
      id: crypto.randomUUID(),
      userCode: res.user_code,
      verificationUri: /^https:\/\/github\.com\//.test(res.verification_uri) ? res.verification_uri : `${this.ep.githubWeb}/login/device`,
      expiresAt: Date.now() + res.expires_in * 1000,
      status: "pending",
    };
    this.devices.set(flow.id, flow);
    void this.pollDevice(flow, clientId, res.device_code, Math.max(res.interval || 5, 1));
    return flow;
  }

  deviceStatus(id: string): DeviceFlow {
    const f = this.devices.get(id);
    if (!f) throw new HttpError(404, "Conexión no encontrada");
    return f;
  }

  private async pollDevice(flow: DeviceFlow, clientId: string, deviceCode: string, interval: number) {
    while (flow.status === "pending") {
      await new Promise((r) => setTimeout(r, interval * this.pollScale));
      if (Date.now() > flow.expiresAt) {
        flow.status = "expired";
        break;
      }
      try {
        const r = await request<TokenResponse>("GitHub", new URL(this.ep.githubWeb), "/login/oauth/access_token", {
          method: "POST",
          form: { client_id: clientId, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" },
        });
        if (r.access_token) {
          const account = await this.githubUser(r.access_token);
          this.integrations.saveConnection("github", { token: r.access_token, source: "oauth", apiUrl: this.ep.githubApi });
          flow.account = account;
          flow.status = "connected";
        } else if (r.error === "slow_down") interval += 5;
        else if (r.error === "expired_token") flow.status = "expired";
        else if (r.error === "access_denied") flow.status = "denied";
        else if (r.error !== "authorization_pending") {
          flow.status = "error";
          flow.error = r.error_description || r.error || "error desconocido";
        }
      } catch (e) {
        flow.status = "error";
        flow.error = (e as Error).message;
      }
    }
    // Forget finished flows after a while.
    setTimeout(() => this.devices.delete(flow.id), FLOW_TTL).unref?.();
  }

  // ---------- Jira / Bitbucket: authorization code with loopback redirect ----------

  /** Begin a browser login; `origin` is this server as the browser reaches it (http://localhost:PORT). */
  start(provider: string, origin: string): { url: string } {
    const p = provider === "jira" || provider === "bitbucket" ? provider : null;
    if (!p) throw new HttpError(400, "Este proveedor no usa este flujo");
    const { clientId } = this.app(p);
    const redirectUri = `${origin}${CALLBACK_PATH}`;
    const state = crypto.randomBytes(32).toString("base64url");
    this.gc();
    this.flows.set(state, { provider: p, redirectUri, createdAt: Date.now() });
    const url =
      p === "jira"
        ? new URL(`${this.ep.atlassianAuth}/authorize`)
        : new URL(`${this.ep.bitbucketWeb}/site/oauth2/authorize`);
    const q =
      p === "jira"
        ? { audience: "api.atlassian.com", client_id: clientId, scope: JIRA_SCOPES, redirect_uri: redirectUri, state, response_type: "code", prompt: "consent" }
        : { client_id: clientId, response_type: "code", state };
    for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v);
    return { url: url.toString() };
  }

  private gc() {
    const now = Date.now();
    for (const [k, f] of this.flows) if (now - f.createdAt > FLOW_TTL) this.flows.delete(k);
  }

  /** Redirect target. The single-use `state` is what authenticates this request. */
  async callback(state: string | null, code: string | null, error: string | null): Promise<{ provider: string; account: string }> {
    this.gc();
    const flow = state ? this.flows.get(state) : undefined;
    if (!state || !flow) throw new HttpError(400, "La conexión caducó o no es válida. Vuelve a pulsar «Conectar».");
    this.flows.delete(state);
    if (error) throw new HttpError(400, error === "access_denied" ? "Has cancelado la autorización." : `El proveedor devolvió: ${error.slice(0, 100)}`);
    if (!code || code.length > 2000) throw new HttpError(400, "Falta el código de autorización");
    const t = await this.exchange(flow.provider, { grant_type: "authorization_code", code, redirect_uri: flow.redirectUri });
    if (flow.provider === "jira") {
      const sites = await request<{ id: string; url: string; name: string; scopes: string[] }[]>("Jira", new URL(this.ep.atlassianApi), "/oauth/token/accessible-resources", {
        headers: { authorization: `Bearer ${t.access_token}` },
      });
      const site = sites.find((s) => s.scopes?.some((x) => x.includes("jira"))) ?? sites[0];
      if (!site) throw new HttpError(400, "Tu cuenta de Atlassian no tiene acceso a ningún sitio de Jira");
      const prev = this.integrations.connection("jira");
      this.integrations.saveConnection("jira", {
        auth: "oauth",
        token: t.access_token,
        refreshToken: t.refresh_token,
        expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000,
        cloudId: site.id,
        siteUrl: new URL(site.url).origin,
        email: prev?.email ?? "",
        defaultJql: prev?.defaultJql ?? "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC",
      });
      return { provider: "Jira", account: site.name };
    }
    const prev = this.integrations.connection("bitbucket");
    this.integrations.saveConnection("bitbucket", {
      auth: "oauth",
      token: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: Date.now() + (t.expires_in ?? 7200) * 1000,
      username: "",
      apiUrl: prev?.apiUrl ?? this.ep.bitbucketApi,
    });
    const me = await this.integrations.bb<{ display_name?: string }>("/user");
    return { provider: "Bitbucket", account: me.display_name ?? "Bitbucket" };
  }

  private async exchange(p: "jira" | "bitbucket", params: Record<string, string>): Promise<Required<Pick<TokenResponse, "access_token">> & TokenResponse> {
    const { clientId, clientSecret } = this.app(p);
    const t =
      p === "jira"
        ? await request<TokenResponse>("Jira", new URL(this.ep.atlassianAuth), "/oauth/token", {
            method: "POST",
            body: { client_id: clientId, client_secret: clientSecret, ...params },
          })
        : await request<TokenResponse>("Bitbucket", new URL(this.ep.bitbucketWeb), "/site/oauth2/access_token", {
            method: "POST",
            form: params,
            headers: { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` },
          });
    if (!t?.access_token) throw new HttpError(502, `${LABEL[p]}: ${t?.error_description || t?.error || "no se obtuvo el token"}`);
    return t as Required<Pick<TokenResponse, "access_token">> & TokenResponse;
  }

  /** Renew an expiring access token (refresh tokens rotate, so store the new one). */
  async refresh(p: "jira" | "bitbucket") {
    const cfg = this.integrations.connection(p);
    if (!cfg?.refreshToken) throw new HttpError(401, `${LABEL[p]}: la sesión caducó; vuelve a conectar`);
    const t = await this.exchange(p, { grant_type: "refresh_token", refresh_token: cfg.refreshToken });
    this.integrations.saveConnection(p, {
      token: t.access_token,
      refreshToken: t.refresh_token || cfg.refreshToken,
      expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000,
    });
  }
}

const LABEL: Record<OAuthProvider, string> = { github: "GitHub", jira: "Jira", bitbucket: "Bitbucket" };

function appProvider(p: string): OAuthProvider {
  if (!(APP_PROVIDERS as readonly string[]).includes(p)) throw new HttpError(404, "Proveedor sin OAuth");
  return p as OAuthProvider;
}

/** Slack has no localhost OAuth; instead, a one-click app creation from a manifest with the right scopes. */
export function slackManifestUrl() {
  const manifest = {
    display_information: { name: "Agentic", description: "Consola local para Claude Code", background_color: "#0a0a0a" },
    features: { bot_user: { display_name: "Agentic", always_online: false } },
    oauth_config: {
      scopes: {
        bot: ["channels:read", "channels:history", "groups:read", "groups:history", "im:read", "im:history", "mpim:read", "mpim:history", "users:read", "chat:write"],
      },
    },
    settings: { org_deploy_enabled: false, socket_mode_enabled: false, token_rotation_enabled: false },
  };
  return `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(manifest))}`;
}
