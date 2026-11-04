/** Organising mail locally: no AI, no tokens. Rules decide the category and the project of each message. */
export const MAIL_CATEGORIES = ["urgente", "reuniones", "facturas", "desarrollo", "seguridad", "newsletters", "personal"] as const;
export type MailCategory = (typeof MAIL_CATEGORIES)[number];

export const MAIL_CATEGORY_LABEL: Record<MailCategory, string> = {
  urgente: "Urgente",
  reuniones: "Reuniones",
  facturas: "Facturas y pagos",
  desarrollo: "Desarrollo",
  seguridad: "Seguridad y códigos",
  newsletters: "Newsletters",
  personal: "Personal y otros",
};

export interface MailLike {
  fromName: string;
  fromAddress: string;
  subject: string;
  snippet: string;
  listUnsubscribe: boolean;
  unread: boolean;
}

const DEV_DOMAINS = /(^|\.)(github\.com|gitlab\.com|bitbucket\.org|atlassian\.(net|com)|sentry\.io|vercel\.com|netlify\.com|circleci\.com|linear\.app|npmjs\.com|docker\.com|render\.com|railway\.app|heroku\.com|slack\.com|jira\.com)$/i;
const URGENT = /\b(urgente|urgent|asap|importante|important|inmediato|immediately|action required|acci[oó]n requerida|deadline|vence hoy|cuanto antes)\b/i;
const MEETING = /\b(invitaci[oó]n|invitation|meeting|reuni[oó]n|calendar|calendario|zoom|google meet|teams|webinar|cita|appointment|agenda)\b/i;
const MONEY = /\b(factura|invoice|recibo|receipt|pago|payment|cobro|billing|suscripci[oó]n|subscription|pedido|order|renovaci[oó]n|renewal)\b/i;
const SECURITY = /\b(c[oó]digo de verificaci[oó]n|verification code|one[- ]time|otp|2fa|restablecer|reset your password|contrase[ñn]a|password|alerta de seguridad|security alert|inicio de sesi[oó]n|sign[- ]in|nuevo dispositivo|new device|login)\b/i;
const BULK_SENDER = /^(no-?reply|noreply|newsletter|news|marketing|promo|offers?|hello|info|notifications?|updates?|digest)@/i;

export function categorize(m: MailLike): { category: MailCategory; urgent: boolean; reason: string } {
  const text = `${m.subject} ${m.snippet}`;
  const domain = m.fromAddress.split("@")[1] ?? "";
  const urgent = m.unread && URGENT.test(m.subject);
  const done = (category: MailCategory, reason: string) => ({ category: urgent ? "urgente" : category, urgent, reason: urgent ? `Marcado urgente · ${reason}` : reason });

  if (SECURITY.test(m.subject)) return done("seguridad", "Código o aviso de seguridad");
  if (DEV_DOMAINS.test(domain)) return done("desarrollo", `Notificación de ${domain}`);
  if (MEETING.test(m.subject)) return done("reuniones", "Invitación o reunión");
  if (MONEY.test(m.subject)) return done("facturas", "Factura, pago o pedido");
  if (m.listUnsubscribe || BULK_SENDER.test(m.fromAddress)) return done("newsletters", m.listUnsubscribe ? "Lista de correo (con baja)" : "Envío automático");
  if (URGENT.test(m.subject) || (MEETING.test(text) && m.unread)) return done(MEETING.test(text) ? "reuniones" : "personal", "Por el contenido");
  return done("personal", "Sin reglas que coincidan");
}

export interface ProjectRef {
  path: string;
  name: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Words that identify a project: its name and its folder name (>= 3 letters, not generic). */
export function projectTerms(p: ProjectRef): string[] {
  const generic = new Set(["app", "web", "api", "src", "main", "test", "demo", "docs", "code", "project", "proyecto"]);
  const base = p.path.replace(/\/+$/, "").split("/").pop() ?? "";
  return [...new Set([p.name, base].map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 3 && !generic.has(s)))];
}

/**
 * Which project a message belongs to. A rule learnt from you (same sender) wins; otherwise the project whose
 * name appears in the subject (strong) or the preview (weak). Ties are left unassigned rather than guessed.
 */
export function matchProject(m: MailLike, projects: ProjectRef[], senderRules: Record<string, string>): { path: string; reason: string } | null {
  const learnt = senderRules[m.fromAddress.toLowerCase()];
  if (learnt && projects.some((p) => p.path === learnt)) return { path: learnt, reason: "Regla aprendida de este remitente" };
  const subject = m.subject.toLowerCase();
  const body = m.snippet.toLowerCase();
  let best: { path: string; score: number; term: string } | null = null;
  let tie = false;
  for (const p of projects) {
    let score = 0;
    let term = "";
    for (const t of projectTerms(p)) {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escape(t)}($|[^\\p{L}\\p{N}])`, "u");
      const s = (re.test(subject) ? 3 : 0) + (re.test(body) ? 1 : 0);
      if (s > score) {
        score = s;
        term = t;
      }
    }
    if (!score) continue;
    if (!best || score > best.score) {
      best = { path: p.path, score, term };
      tie = false;
    } else if (score === best.score) tie = true;
  }
  return best && !tie ? { path: best.path, reason: `Menciona «${best.term}»` } : null;
}
