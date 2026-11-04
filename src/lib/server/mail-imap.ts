import type { MailAccount, MailFetcher, RawMail } from "./mail";
import fs from "node:fs";
import { allowInsecure } from "./integrations/http";
import { HttpError } from "./util";

/** The real IMAP side. Read only: the mailbox is opened with EXAMINE and nothing is ever stored or deleted. */
async function connect(a: Pick<MailAccount, "host" | "port" | "user" | "password">) {
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: a.host,
    port: a.port,
    secure: a.port === 993,
    doSTARTTLS: a.port !== 993 ? true : undefined,
    auth: { user: a.user, pass: a.password },
    logger: false,
    tls: { rejectUnauthorized: !/^(127\.0\.0\.1|localhost)$/.test(a.host) },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
  client.on("error", () => {}); // surfaced through the rejected promise instead of crashing the server
  try {
    await client.connect();
  } catch (e) {
    throw friendly(e);
  }
  return client;
}

function friendly(e: unknown): HttpError {
  const err = e as { authenticationFailed?: boolean; code?: string; responseText?: string; message?: string };
  if (err?.authenticationFailed) return new HttpError(400, "Usuario o contraseña incorrectos. En Gmail, iCloud o Yahoo hace falta una «contraseña de aplicación», no la de siempre.");
  if (err?.code === "ENOTFOUND" || err?.code === "EAI_AGAIN") return new HttpError(400, "No se encuentra el servidor: revisa el nombre (p. ej. imap.gmail.com).");
  if (err?.code === "ETIMEDOUT" || err?.code === "ECONNREFUSED" || err?.code === "ECONNRESET") return new HttpError(400, "No se pudo conectar con el servidor (puerto o red).");
  if (typeof err?.code === "string" && /CERT|TLS|SSL/.test(err.code)) return new HttpError(400, "El certificado del servidor no es de fiar.");
  return new HttpError(400, "No se pudo conectar con el correo.");
}

export async function verifyAccount(a: Pick<MailAccount, "host" | "port" | "user" | "password">) {
  const client = await connect(a);
  await client.logout().catch(() => {});
}

export const imapFetch: MailFetcher = async (account, { since, max }) => {
  const { simpleParser } = await import("mailparser");
  const client = await connect(account);
  const out: RawMail[] = [];
  try {
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const uids = ((await client.search({ since }, { uid: true })) || []).slice(-max);
      if (!uids.length) return out;
      for await (const msg of client.fetch(uids, { uid: true, flags: true, envelope: true, internalDate: true, headers: ["list-unsubscribe"], source: { maxLength: 16_384 } }, { uid: true })) {
        const from = msg.envelope?.from?.[0];
        let snippet = "";
        try {
          const parsed = await simpleParser(msg.source ?? Buffer.alloc(0));
          snippet = (parsed.text || String(parsed.html || "").replace(/<style[\s\S]*?<\/style>|<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 300);
        } catch {}
        out.push({
          uid: msg.uid,
          fromName: from?.name || from?.address || "",
          fromAddress: (from?.address || "").toLowerCase(),
          subject: (msg.envelope?.subject || "(sin asunto)").slice(0, 300),
          snippet,
          date: new Date(msg.envelope?.date || msg.internalDate || Date.now()).toISOString(),
          unread: !msg.flags?.has("\\Seen"),
          listUnsubscribe: !!msg.headers && /list-unsubscribe/i.test(msg.headers.toString()),
        });
      }
    } finally {
      lock.release();
    }
  } catch (e) {
    throw e instanceof HttpError ? e : friendly(e);
  } finally {
    await client.logout().catch(() => {});
  }
  return out;
};

/**
 * Test hook (only with the insecure-integrations switch used by the e2e suite): read messages from a JSON file
 * instead of a real server, so the whole flow can be exercised offline.
 */
function fixturePath() {
  return allowInsecure() ? process.env.AGENTIC_MAIL_FIXTURE : undefined;
}
export const verify: typeof verifyAccount = async (a) => {
  if (fixturePath()) {
    if (a.password === "bad") throw new HttpError(400, "Usuario o contraseña incorrectos. En Gmail, iCloud o Yahoo hace falta una «contraseña de aplicación», no la de siempre.");
    return;
  }
  return verifyAccount(a);
};
export const fetcher: MailFetcher = async (account, opts) => {
  const f = fixturePath();
  if (f) return JSON.parse(fs.readFileSync(f, "utf8")) as RawMail[];
  return imapFetch(account, opts);
};
