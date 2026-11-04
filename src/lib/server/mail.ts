import crypto from "node:crypto";
import { z } from "zod";
import { categorize, matchProject, type MailCategory, type ProjectRef } from "../mail";
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
}

export interface RawMail {
  uid: number;
  fromName: string;
  fromAddress: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  listUnsubscribe: boolean;
}

export interface MailSettings {
  enabled: boolean;
  intervalMin: number;
  days: number;
  senderRules: Record<string, string>;
  lastRunAt: string | null;
}

export type MailFetcher = (account: MailAccount, opts: { since: Date; max: number }) => Promise<RawMail[]>;

const ACCOUNTS = "mail-accounts";
const ITEMS = "mail-items";
const SETTINGS = "mail-settings";
const MAX_ITEMS = 1000;
const DEFAULTS: MailSettings = { enabled: true, intervalMin: 15, days: 7, senderRules: {}, lastRunAt: null };

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
});
const patchSchema = z.object({
  projectPath: z.string().max(1000).nullable().optional(),
  category: z.enum(["urgente", "reuniones", "facturas", "desarrollo", "seguridad", "newsletters", "personal"]).optional(),
  done: z.boolean().optional(),
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
  }

  updateSettings(body: unknown) {
    const s = parse(settingsSchema, body);
    this.store.update<Partial<MailSettings>>(SETTINGS, {}, (cur) => void Object.assign(cur, Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined))));
    return { ...this.settings(), senderRules: undefined };
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
      out = m;
    });
    if (!out) throw new HttpError(404, "Mensaje no encontrado");
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
          const raw = await this.fetcher(account, { since, max: 150 });
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
    this.store.update<MailItem[]>(ITEMS, [], (all) => {
      const byId = new Map(all.map((m) => [m.id, m]));
      for (const r of raw) {
        const id = `${account.id}:${r.uid}`;
        const prev = byId.get(id);
        if (prev) {
          prev.unread = r.unread; // read elsewhere
          continue;
        }
        const like = { ...r, fromName: r.fromName, fromAddress: r.fromAddress };
        const cat = categorize(like);
        const proj = matchProject(like, projects, settings.senderRules);
        all.push({ id, accountId: account.id, ...r, category: cat.category, urgent: cat.urgent, projectPath: proj?.path ?? null, reason: proj ? `${cat.reason} · ${proj.reason}` : cat.reason, manual: false, done: false });
        added++;
      }
      all.sort((a, b) => (a.date < b.date ? 1 : -1));
      all.length = Math.min(all.length, MAX_ITEMS);
    });
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
