import { z } from "zod";
import { git } from "../git";
import type { JsonStore } from "../store";
import type { Task, TaskService } from "../tasks";
import { HttpError, parse, text } from "../util";
import { IntegrationError, request, safeBaseUrl } from "./http";

interface SlackRawMessage {
  ts: string;
  thread_ts?: string;
  reply_count?: number;
  user?: string;
  username?: string;
  bot_profile?: { name?: string };
  subtype?: string;
  text?: string;
  files?: { name: string }[];
}

export function slackChannelId(c: string) {
  if (!/^[CGD][A-Z0-9]{2,20}$/.test(c)) throw new HttpError(400, "canal no válido");
  return c;
}
export function slackTs(ts: string) {
  if (!/^\d{1,12}\.\d{1,9}$/.test(ts)) throw new HttpError(400, "ts no válido");
  return ts;
}

export const PROVIDERS = ["slack", "github", "jira", "bitbucket"] as const;
export type Provider = (typeof PROVIDERS)[number];

const secret = z.string().max(4096).refine((s) => !/[\r\n\0]/.test(s), "caracteres no válidos");

const schemas = {
  slack: z.object({
    botToken: secret.optional(),
    webhookUrl: z.string().max(500).default(""),
    notifyChannel: z.string().regex(/^([CG][A-Z0-9]{2,20})?$/, "ID de canal no válido (p. ej. C0123ABCD)").default(""),
    events: z.object({ runFinished: z.boolean().default(true), queueFinished: z.boolean().default(true), onlyFailures: z.boolean().default(false) }).default({ runFinished: true, queueFinished: true, onlyFailures: false }),
  }),
  github: z.object({
    token: secret.optional(),
    apiUrl: z.string().max(500).default("https://api.github.com"),
  }),
  jira: z.object({
    siteUrl: z.string().max(500),
    email: text(320).min(3),
    token: secret.optional(),
    defaultJql: text(2000).default("assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC"),
  }),
  bitbucket: z.object({
    username: text(320).default(""),
    token: secret.optional(),
    apiUrl: z.string().max(500).default("https://api.bitbucket.org/2.0"),
  }),
};

const SECRET_FIELD: Record<Provider, "botToken" | "token"> = { slack: "botToken", github: "token", jira: "token", bitbucket: "token" };

type Config = { [P in Provider]?: z.infer<(typeof schemas)[P]> & { updatedAt: string } };
const F = "integrations";

export interface ExternalRef {
  provider: Provider;
  id: string;
  key: string;
  url: string;
}

export interface ExternalItem {
  ref: ExternalRef;
  kind: "issue" | "pr";
  title: string;
  body: string;
  state: string;
  author: string | null;
  updatedAt: string | null;
  labels: string[];
  branch?: string | null;
  imported?: string | null; // task id if already imported
}

/** Show only enough of a secret to recognise it. */
export function mask(s: string | undefined): string | null {
  if (!s) return null;
  if (s.startsWith("https://hooks.slack.com/")) return `hooks.slack.com/…${s.slice(-4)}`;
  return s.length <= 8 ? "••••" : `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/** owner/repo from a git remote URL for a given host (https or scp-like ssh). */
export function parseRemote(remote: string, host: string): { owner: string; repo: string } | null {
  const h = host.replace(/\./g, "\\.");
  const m = new RegExp(`^(?:https?://(?:[^@/]+@)?${h}(?::\\d+)?/|ssh://(?:[^@/]+@)?${h}(?::\\d+)?/|[^@/]+@${h}:)([^/]+)/([^/]+?)(?:\\.git)?/?$`, "i").exec(remote.trim());
  return m ? { owner: m[1], repo: m[2] } : null;
}

export class IntegrationService {
  constructor(
    private store: JsonStore,
    private tasks: TaskService,
  ) {}

  private config(): Config {
    return this.store.read<Config>(F, {});
  }

  /** Public view: never includes secrets. */
  status() {
    const c = this.config();
    return Object.fromEntries(
      PROVIDERS.map((p) => {
        const cfg = c[p] as Record<string, unknown> | undefined;
        if (!cfg) return [p, { configured: false }];
        const { [SECRET_FIELD[p]]: s, ...rest } = cfg;
        if (typeof rest.webhookUrl === "string") rest.webhookUrl = rest.webhookUrl ? mask(rest.webhookUrl) : "";
        return [p, { configured: !!s, secretHint: mask(s as string | undefined), ...rest }];
      }),
    );
  }

  configure(provider: string, body: unknown) {
    const p = this.provider(provider);
    const field = SECRET_FIELD[p];
    const { updatedAt: _u, ...prev } = (this.config()[p] ?? {}) as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unused-vars
    // Fields not sent keep their stored value; an empty secret means "keep the stored one"
    // so non-secret edits never require re-entering credentials.
    const given = Object.fromEntries(Object.entries((body ?? {}) as Record<string, unknown>).filter(([k, v]) => v !== undefined && !(k === field && v === "")));
    const data = parse(schemas[p] as z.ZodType, { ...prev, ...given }) as Record<string, unknown>;
    if (!data[field]) throw new HttpError(400, `${field} es obligatorio`);
    if (p === "slack" && data.webhookUrl && !/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(String(data.webhookUrl)))
      throw new HttpError(400, "webhookUrl debe ser una URL https://hooks.slack.com/services/…");
    if (p === "slack" && !/^xox[bp]-[A-Za-z0-9-]+$/.test(String(data.botToken))) throw new HttpError(400, "botToken debe empezar por xoxb- (bot) o xoxp- (usuario)");
    if (p === "github") safeBaseUrl(String(data.apiUrl), "apiUrl");
    if (p === "bitbucket") safeBaseUrl(String(data.apiUrl), "apiUrl");
    if (p === "jira") data.siteUrl = safeBaseUrl(String(data.siteUrl), "siteUrl").origin;
    this.store.update<Config>(F, {}, (c) => {
      (c as Record<string, unknown>)[p] = { ...data, updatedAt: new Date().toISOString() };
    });
    return this.status()[p];
  }

  remove(provider: string) {
    const p = this.provider(provider);
    this.store.update<Config>(F, {}, (c) => {
      delete c[p];
    });
  }

  private provider(p: string): Provider {
    if (!(PROVIDERS as readonly string[]).includes(p)) throw new HttpError(404, "Integración desconocida");
    return p as Provider;
  }

  private need<P extends Provider>(p: P): NonNullable<Config[P]> {
    const cfg = this.config()[p];
    if (!cfg) throw new HttpError(400, `La integración ${p} no está configurada`);
    return cfg as NonNullable<Config[P]>;
  }

  /** Verify credentials against the provider. */
  async test(provider: string): Promise<{ ok: true; account: string }> {
    const p = this.provider(provider);
    if (p === "slack") {
      const me = await this.slackApi<{ ok: boolean; user?: string; team?: string }>("auth.test");
      return { ok: true, account: `${me.user ?? "bot"} @ ${me.team ?? "Slack"}` };
    }
    if (p === "github") {
      const me = await this.gh<{ login: string }>("/user");
      return { ok: true, account: me.login };
    }
    if (p === "jira") {
      const me = await this.jira<{ displayName?: string; emailAddress?: string }>("/rest/api/3/myself");
      return { ok: true, account: me.displayName || me.emailAddress || "jira" };
    }
    const me = await this.bb<{ display_name?: string; username?: string }>("/user");
    return { ok: true, account: me.display_name || me.username || "bitbucket" };
  }

  // ---------- Slack ----------

  /** Slack Web API call. Slack answers HTTP 200 with `{ ok: false, error }` on failure. */
  async slackApi<T extends { ok: boolean; error?: string }>(method: string, params: Record<string, string | number | undefined> = {}, body?: unknown): Promise<T> {
    const cfg = this.need("slack");
    const base = safeBaseUrl(process.env.AGENTIC_SLACK_API_URL || "https://slack.com/api/", "slack api");
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    const res = await request<T>("Slack", base, `${method}${qs.size ? `?${qs}` : ""}`, {
      method: body ? "POST" : "GET",
      body,
      headers: { authorization: `Bearer ${cfg.botToken}` },
    });
    if (!res?.ok) {
      const err = res?.error ?? "error";
      const hint: Record<string, string> = {
        invalid_auth: "token no válido",
        not_authed: "token no válido",
        missing_scope: "al token le falta un scope (revisa los permisos de la app)",
        channel_not_found: "canal no encontrado",
        not_in_channel: "el bot no está en el canal (invítalo con /invite)",
        ratelimited: "límite de peticiones de Slack, inténtalo en unos segundos",
      };
      throw new IntegrationError("Slack", 200, hint[err] ?? err);
    }
    return res;
  }

  private userCache: { at: number; map: Map<string, string> } | null = null;

  /** id -> display name (cached 10 min; one page is enough for small workspaces). */
  async slackUsers(): Promise<Map<string, string>> {
    if (this.userCache && Date.now() - this.userCache.at < 600_000) return this.userCache.map;
    const map = new Map<string, string>();
    try {
      const r = await this.slackApi<{ ok: boolean; members: { id: string; name: string; real_name?: string; profile?: { display_name?: string } }[] }>("users.list", { limit: 500 });
      for (const u of r.members ?? []) map.set(u.id, u.profile?.display_name || u.real_name || u.name);
    } catch {
      // users:read is optional: fall back to raw ids
    }
    this.userCache = { at: Date.now(), map };
    return map;
  }

  async slackChannels() {
    const r = await this.slackApi<{ ok: boolean; channels: { id: string; name: string; is_private: boolean; is_member: boolean; num_members?: number; topic?: { value: string } }[] }>("conversations.list", {
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: 500,
    });
    return (r.channels ?? [])
      .map((c) => ({ id: c.id, name: c.name, isPrivate: c.is_private, isMember: c.is_member, members: c.num_members ?? null, topic: c.topic?.value ?? "" }))
      .sort((a, b) => Number(b.isMember) - Number(a.isMember) || a.name.localeCompare(b.name));
  }

  private async slackMessages(raw: SlackRawMessage[]) {
    const users = await this.slackUsers();
    const name = (id?: string) => (id ? (users.get(id) ?? id) : null);
    return raw
      .filter((m) => !m.subtype || ["bot_message", "thread_broadcast", "me_message", "file_share"].includes(m.subtype))
      .map((m) => ({
        ts: m.ts,
        threadTs: m.thread_ts ?? null,
        replyCount: m.reply_count ?? 0,
        user: m.user ?? null,
        author: name(m.user) ?? m.username ?? m.bot_profile?.name ?? "bot",
        // Resolve <@U123> mentions to names; the client renders it as plain text.
        text: (m.text ?? "").replace(/<@([A-Z0-9]+)>/g, (_, id: string) => `@${name(id)}`).slice(0, 40_000),
        files: (m.files ?? []).map((f) => f.name).slice(0, 10),
      }));
  }

  async slackHistory(channel: string, cursor?: string) {
    const r = await this.slackApi<{ ok: boolean; messages: SlackRawMessage[]; has_more?: boolean; response_metadata?: { next_cursor?: string } }>("conversations.history", {
      channel: slackChannelId(channel),
      limit: 50,
      cursor,
    });
    return { messages: (await this.slackMessages(r.messages ?? [])).reverse(), nextCursor: r.response_metadata?.next_cursor || null };
  }

  async slackReplies(channel: string, ts: string) {
    const r = await this.slackApi<{ ok: boolean; messages: SlackRawMessage[] }>("conversations.replies", { channel: slackChannelId(channel), ts: slackTs(ts), limit: 200 });
    return { messages: await this.slackMessages(r.messages ?? []) };
  }

  async slackPost(channel: string, textMsg: string, threadTs?: string | null) {
    const r = await this.slackApi<{ ok: boolean; ts: string }>("chat.postMessage", {}, {
      channel: slackChannelId(channel),
      text: textMsg,
      ...(threadTs ? { thread_ts: slackTs(threadTs) } : {}),
      unfurl_links: false,
    });
    return { ts: r.ts };
  }

  /** Fire-and-forget Agentic notification (bot channel, else webhook); never throws. */
  async notify(event: "runFinished" | "queueFinished", textMsg: string, failed: boolean) {
    const cfg = this.config().slack;
    if (!cfg || !cfg.events?.[event]) return;
    if (cfg.events.onlyFailures && !failed) return;
    try {
      if (cfg.notifyChannel) await this.slackPost(cfg.notifyChannel, textMsg);
      else if (cfg.webhookUrl) {
        const url = safeBaseUrl(cfg.webhookUrl, "webhookUrl");
        await request("Slack", new URL(url.origin), url.pathname, { method: "POST", body: { text: textMsg } });
      }
    } catch (e) {
      console.warn("[agentic] slack notification failed:", (e as Error).message);
    }
  }

  // ---------- GitHub ----------

  async gh<T>(path: string, init?: Parameters<typeof request>[3]) {
    const cfg = this.need("github");
    const base = safeBaseUrl(cfg.apiUrl.endsWith("/") ? cfg.apiUrl : `${cfg.apiUrl}/`, "apiUrl");
    return request<T>("GitHub", base, path.replace(/^\//, ""), {
      ...init,
      headers: { authorization: `Bearer ${cfg.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
    });
  }

  githubHost() {
    const api = new URL(this.need("github").apiUrl);
    return api.hostname === "api.github.com" ? "github.com" : api.hostname;
  }

  /** The GitHub repository behind a project's `origin` remote. */
  async githubRepo(projectPath: string) {
    const remote = (await git(projectPath, ["remote", "get-url", "origin"]))?.trim();
    if (!remote) throw new HttpError(400, "El proyecto no tiene remoto «origin»");
    const r = parseRemote(remote, this.githubHost());
    if (!r) throw new HttpError(400, "El remoto «origin» no es un repositorio de GitHub");
    return r;
  }

  async githubItems(projectPath: string, kind: "issue" | "pr"): Promise<ExternalItem[]> {
    const { owner, repo } = await this.githubRepo(projectPath);
    const slug = `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    type GhItem = { id: number; number: number; title: string; body: string | null; state: string; html_url: string; user?: { login: string }; updated_at: string; labels?: { name: string }[]; pull_request?: unknown; head?: { ref: string }; draft?: boolean };
    const rows = await this.gh<GhItem[]>(kind === "pr" ? `/repos/${slug}/pulls?state=open&per_page=50` : `/repos/${slug}/issues?state=open&per_page=50`);
    const imported = this.importedMap();
    return rows
      .filter((r) => kind === "pr" || !r.pull_request)
      .map((r) => {
        const ref: ExternalRef = { provider: "github", id: `${owner}/${repo}#${r.number}`, key: `#${r.number}`, url: r.html_url };
        return {
          ref,
          kind,
          title: r.title,
          body: (r.body ?? "").slice(0, 20_000),
          state: r.draft ? "draft" : r.state,
          author: r.user?.login ?? null,
          updatedAt: r.updated_at,
          labels: (r.labels ?? []).map((l) => l.name).slice(0, 20),
          branch: r.head?.ref ?? null,
          imported: imported.get(`github:${ref.id}`) ?? null,
        };
      });
  }

  // ---------- Jira / Bitbucket (v0.6.0) ----------

  async jira<T>(path: string, init?: Parameters<typeof request>[3]) {
    const cfg = this.need("jira");
    const auth = Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64");
    return request<T>("Jira", safeBaseUrl(cfg.siteUrl, "siteUrl"), path, { ...init, headers: { authorization: `Basic ${auth}` } });
  }

  async bb<T>(path: string, init?: Parameters<typeof request>[3]) {
    const cfg = this.need("bitbucket");
    const base = safeBaseUrl(cfg.apiUrl.endsWith("/") ? cfg.apiUrl : `${cfg.apiUrl}/`, "apiUrl");
    const authorization = cfg.username ? `Basic ${Buffer.from(`${cfg.username}:${cfg.token}`).toString("base64")}` : `Bearer ${cfg.token}`;
    return request<T>("Bitbucket", base, path.replace(/^\//, ""), { ...init, headers: { authorization } });
  }

  // ---------- import ----------

  private importedMap() {
    const m = new Map<string, string>();
    for (const t of this.tasks.list()) if (t.external) m.set(`${t.external.provider}:${t.external.id}`, t.id);
    return m;
  }

  /** Create (or return the existing) task for an external item. */
  importItem(item: ExternalItem, projectPath: string | null): { task: Task; created: boolean } {
    const existing = this.importedMap().get(`${item.ref.provider}:${item.ref.id}`);
    if (existing) return { task: this.tasks.get(existing), created: false };
    const title = `${item.ref.key} ${item.title}`.slice(0, 200);
    const task = this.tasks.create(
      {
        title,
        description: `${item.ref.url}\n\n${item.body}`.slice(0, 20_000),
        labels: [item.ref.provider, ...item.labels].map((l) => l.slice(0, 40)).slice(0, 20),
        projectPath,
        status: "todo",
        prompt:
          item.kind === "pr"
            ? `Revisa la pull request ${item.ref.key} «${item.title}» (${item.ref.url})${item.branch ? `, rama ${item.branch}` : ""}. Busca bugs, problemas de seguridad y mejoras; no modifiques código.`
            : `Resuelve la incidencia ${item.ref.key} «${item.title}» (${item.ref.url}).\n\n${item.body}`.slice(0, 50_000),
      },
      { external: item.ref },
    );
    return { task, created: true };
  }
}
