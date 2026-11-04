import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { categorize, matchProject, type MailCategory, type ProjectRef } from "../mail";
import { dataKeys, isSealed, seal, unseal } from "./seal";
import type { JsonStore } from "./store";
import { HttpError, parse, text } from "./util";

/**
 * Mail, read only. Messages are fetched over IMAP (TLS, app password), never changed or deleted on the server,
 * organised locally by rules (no AI, no tokens) and kept encrypted on this device.
 */
export interface MailAccount {
  id: string;
  label: string;
  host: string;
  port: number;
  user: string;
  password: string;
  createdAt: string;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface MailItem {
  id: string;
  accountId: string;
  uid: number;
  fromName: string;
  fromAddress: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  listUnsubscribe: boolean;
  category: MailCategory;
  urgent: boolean;
  projectPath: string | null;
  /** Why it was filed where it was (shown to the user). */
  reason: string;
  /** The user set category/project by hand: sync never changes it. */
  manual: boolean;
  done: boolean;
  /** Read/unread chosen by the user here; sync does not overwrite it. */
  userRead?: boolean;
}

export interface MailBody {
  text: string;
  to: string;
  attachments: { name: string; size: number }[];
  truncated: boolean;
  /** The message as sent (sanitised HTML, inline pictures embedded). Shown in a sandboxed frame. */
  html?: string;
}

export type MailBodyFetcher = (account: MailAccount, uid: number) => Promise<MailBody>;
export type MailSeenSetter = (account: MailAccount, uid: number, seen: boolean) => Promise<void>;

export interface RawMail {
  uid: number;
  fromName: string;
  fromAddress: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  listUnsubscribe: boolean;
  /** Full text, when the fetcher already has it (new messages are preloaded so opening is instant). */
  body?: MailBody;
}

export interface MailSettings {
  enabled: boolean;
  intervalMin: number;
  days: number;
  /** Also mark messages read/unread on the mail server (off by default: Agentic then never changes your mailbox). */
  syncSeen: boolean;
  senderRules: Record<string, string>;
  lastRunAt: string | null;
}

/** `known` = uids already filed: only their read state is needed, so the fetcher skips their (big) bodies. */
export type MailFetcher = (account: MailAccount, opts: { since: Date; max: number; known: Set<number> }) => Promise<RawMail[]>;

const ACCOUNTS = "mail-accounts";
const ITEMS = "mail-items";
const SETTINGS = "mail-settings";
const MAX_ITEMS = 1000;
const DEFAULTS: MailSettings = { enabled: true, intervalMin: 15, days: 7, syncSeen: false, senderRules: {}, lastRunAt: null };

export const MAIL_STORES = [ACCOUNTS, ITEMS];

const HOST_RE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^(127\.0\.0\.1|localhost)$/i;
const accountSchema = z.object({
  label: text(60).default(""),
  host: z.string().trim().regex(HOST_RE, "Servidor IMAP no válido (p. ej. imap.gmail.com)"),
  port: z.number().int().min(1).max(65535).default(993),
  user: text(320).refine((s) => s.trim().length > 0, "Falta el usuario"),
  password: z.string().min(1, "Falta la contraseña").max(512).refine((s) => !/[\r\n\0]/.test(s), "caracteres no válidos"),
});
const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMin: z.number().int().min(5).max(240).optional(),
  days: z.number().int().min(1).max(30).optional(),
  syncSeen: z.boolean().optional(),
});
const patchSchema = z.object({
  projectPath: z.string().max(1000).nullable().optional(),
  category: z.enum(["urgente", "reuniones", "facturas", "desarrollo", "seguridad", "newsletters", "personal"]).optional(),
  done: z.boolean().optional(),
  read: z.boolean().optional(),
  /** Remember "mail from this sender goes to this project" for future messages. */
  remember: z.boolean().default(true),
});

export function publicAccount(a: MailAccount) {
  const { password: _p, ...rest } = a; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
}

export class MailService {
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private store: JsonStore,
    private projects: () => ProjectRef[],
    private fetcher: MailFetcher,
    private verify: (a: Pick<MailAccount, "host" | "port" | "user" | "password">) => Promise<void>,
    private io: { body?: MailBodyFetcher; setSeen?: MailSeenSetter } = {},
  ) {}

  private accounts() {
    return this.store.read<MailAccount[]>(ACCOUNTS, []);
  }
  private items() {
    return this.store.read<MailItem[]>(ITEMS, []);
  }
  settings(): MailSettings {
    return { ...DEFAULTS, ...this.store.read<Partial<MailSettings>>(SETTINGS, {}) };
  }

  overview() {
    const items = this.items().sort((a, b) => (a.date < b.date ? 1 : -1));
    return {
      accounts: this.accounts().map(publicAccount),
      settings: { ...this.settings(), senderRules: undefined },
      running: this.running,
      items,
    };
  }

  async addAccount(body: unknown) {
    const input = parse(accountSchema, body);
    if (this.accounts().some((a) => a.host === input.host && a.user.toLowerCase() === input.user.toLowerCase())) throw new HttpError(409, "Esa cuenta ya está conectada");
    await this.verify(input); // throws a friendly HttpError; the password is never echoed
    const account: MailAccount = { id: crypto.randomUUID(), label: input.label || input.user, host: input.host, port: input.port, user: input.user.trim(), password: input.password, createdAt: new Date().toISOString(), lastSyncAt: null, lastError: null };
    this.store.update<MailAccount[]>(ACCOUNTS, [], (all) => void all.push(account));
    return publicAccount(account);
  }

  removeAccount(id: string) {
    let found = false;
    this.store.update<MailAccount[]>(ACCOUNTS, [], (all) => {
      const i = all.findIndex((a) => a.id === id);
      if (i >= 0) {
        all.splice(i, 1);
        found = true;
      }
    });
    if (!found) throw new HttpError(404, "Cuenta no encontrada");
    this.store.update<MailItem[]>(ITEMS, [], (all) => {
      const keep = all.filter((m) => m.accountId !== id);
      all.length = 0;
      all.push(...keep);
    });
    this.saveBodies({});
  }

  updateSettings(body: unknown) {
    const s = parse(settingsSchema, body);
    this.store.update<Partial<MailSettings>>(SETTINGS, {}, (cur) => void Object.assign(cur, Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined))));
    return { ...this.settings(), senderRules: undefined };
  }

  // Message bodies (text + HTML) are kept one encrypted file each: they can be big and are read one at a time.
  private bodyDir() {
    return path.join(this.store.dir, "mail-bodies");
  }
  private bodyFile(id: string) {
    return path.join(this.bodyDir(), `${crypto.createHash("sha256").update(id).digest("hex").slice(0, 40)}.json`);
  }
  private hasBody(id: string) {
    return fs.existsSync(this.bodyFile(id));
  }
  private readBody(id: string): MailBody | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.bodyFile(id), "utf8"));
      return isSealed(raw) ? unseal<MailBody>(raw, dataKeys(this.store.dir)) : null;
    } catch {
      return null;
    }
  }
  private saveBodies(add: Record<string, MailBody>) {
    fs.mkdirSync(this.bodyDir(), { recursive: true, mode: 0o700 });
    const key = dataKeys(this.store.dir)[0];
    for (const [id, b] of Object.entries(add)) fs.writeFileSync(this.bodyFile(id), JSON.stringify(seal(b, key)), { mode: 0o600 });
    // Keep only the bodies of messages still filed.
    const live = new Set(this.items().map((m) => path.basename(this.bodyFile(m.id))));
    for (const n of fs.readdirSync(this.bodyDir())) if (!live.has(n)) fs.rmSync(path.join(this.bodyDir(), n), { force: true });
  }

  /** The full text of one message, fetched on demand (never stored). Text only: no HTML, no remote images. */
  async body(id: string): Promise<MailBody> {
    const m = this.items().find((x) => x.id === id);
    const account = m && this.accounts().find((a) => a.id === m.accountId);
    if (!m || !account) throw new HttpError(404, "Mensaje no encontrado");
    const cached = this.readBody(id);
    if (cached) return cached;
    if (!this.io.body) throw new HttpError(501, "No disponible");
    const fresh = await this.io.body(account, m.uid);
    this.saveBodies({ [id]: fresh });
    return fresh;
  }

  /** Move a message by hand; by default remember it for the sender. */
  patchItem(id: string, body: unknown) {
    const p = parse(patchSchema, body);
    const known = this.projects();
    if (typeof p.projectPath === "string" && !known.some((k) => k.path === p.projectPath)) throw new HttpError(400, "Ese proyecto no existe");
    let out: MailItem | undefined;
    this.store.update<MailItem[]>(ITEMS, [], (all) => {
      const m = all.find((x) => x.id === id);
      if (!m) return;
      if (p.projectPath !== undefined) {
        m.projectPath = p.projectPath;
        m.manual = true;
        m.reason = p.projectPath ? "Asignado por ti" : "Sin proyecto (por ti)";
      }
      if (p.category) {
        m.category = p.category;
        m.manual = true;
        m.reason = "Categoría elegida por ti";
      }
      if (p.done !== undefined) m.done = p.done;
      if (p.read !== undefined) {
        m.userRead = p.read;
        m.unread = !p.read;
      }
      out = m;
    });
    if (!out) throw new HttpError(404, "Mensaje no encontrado");
    if (p.read !== undefined && this.settings().syncSeen && this.io.setSeen) {
      const account = this.accounts().find((a) => a.id === out!.accountId);
      if (account) void this.io.setSeen(account, out.uid, p.read).catch(() => {}); // best effort: the local state is what counts
    }
    if (p.remember && typeof p.projectPath === "string") {
      const address = out.fromAddress.toLowerCase();
      this.store.update<Partial<MailSettings>>(SETTINGS, {}, (s) => void (s.senderRules = { ...(s.senderRules ?? {}), [address]: p.projectPath as string }));
    }
    return out;
  }

  /** Fetch new mail from every account and file it. Safe to call concurrently (second call is a no-op). */
  async sync(): Promise<{ added: number; errors: string[] }> {
    if (this.running) return { added: 0, errors: [] };
    this.running = true;
    const errors: string[] = [];
    let added = 0;
    try {
      const settings = this.settings();
      const since = new Date(Date.now() - settings.days * 86400_000);
      for (const account of this.accounts()) {
        try {
          // Messages already filed AND with their text cached only need their read state; the rest (new, or from older versions) get preloaded.
          const known = new Set(this.items().filter((m) => m.accountId === account.id && this.hasBody(m.id)).map((m) => m.uid));
          const raw = await this.fetcher(account, { since, max: 150, known });
          added += this.file(account, raw, settings);
          this.mark(account.id, null);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Error desconocido";
          errors.push(`${account.label}: ${msg}`);
          this.mark(account.id, msg);
        }
      }
      this.store.update<Partial<MailSettings>>(SETTINGS, {}, (s) => void (s.lastRunAt = new Date().toISOString()));
    } finally {
      this.running = false;
    }
    return { added, errors };
  }

  private mark(id: string, error: string | null) {
    this.store.update<MailAccount[]>(ACCOUNTS, [], (all) => {
      const a = all.find((x) => x.id === id);
      if (a) {
        a.lastError = error;
        if (!error) a.lastSyncAt = new Date().toISOString();
      }
    });
  }

  private file(account: MailAccount, raw: RawMail[], settings: MailSettings): number {
    const projects = this.projects();
    let added = 0;
    const bodies: Record<string, MailBody> = {};
    this.store.update<MailItem[]>(ITEMS, [], (all) => {
      const byId = new Map(all.map((m) => [m.id, m]));
      for (const r of raw) {
        const id = `${account.id}:${r.uid}`;
        const prev = byId.get(id);
        if (prev) {
          if (prev.userRead === undefined) prev.unread = r.unread; // read elsewhere
          if (r.body) bodies[id] = r.body;
          continue;
        }
        if (!r.date) continue; // a read-state-only entry for a message we no longer keep
        const { body, ...rest } = r;
        if (body) bodies[id] = body;
        const like = { ...rest };
        const cat = categorize(like);
        const proj = matchProject(like, projects, settings.senderRules);
        all.push({ id, accountId: account.id, ...rest, category: cat.category, urgent: cat.urgent, projectPath: proj?.path ?? null, reason: proj ? `${cat.reason} · ${proj.reason}` : cat.reason, manual: false, done: false });
        added++;
      }
      all.sort((a, b) => (a.date < b.date ? 1 : -1));
      all.length = Math.min(all.length, MAX_ITEMS);
    });
    if (Object.keys(bodies).length) this.saveBodies(bodies);
    return added;
  }

  /** Background routine: checks every minute whether it is time to sync. */
  startRoutine() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const s = this.settings();
      if (!s.enabled || !this.accounts().length) return;
      if (s.lastRunAt && Date.now() - Date.parse(s.lastRunAt) < s.intervalMin * 60_000) return;
      void this.sync();
    }, 60_000);
    this.timer.unref();
  }
}
