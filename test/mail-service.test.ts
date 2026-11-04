import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MailService, MAIL_STORES, type RawMail } from "@/lib/server/mail";
import { JsonStore } from "@/lib/server/store";

const raw = (uid: number, o: Partial<RawMail> = {}): RawMail => ({ uid, fromName: "Ana", fromAddress: "ana@client.com", subject: "Hola", snippet: "", date: new Date(2026, 10, uid).toISOString(), unread: true, listUnsubscribe: false, ...o });

function setup(messages: RawMail[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-mail-"));
  const store = new JsonStore(dir, new Set(MAIL_STORES));
  const projects = [{ path: "/w/acme-shop", name: "Acme Shop" }, { path: "/w/zeta", name: "Zeta" }];
  const svc = new MailService(store, () => projects, async () => messages, async (a) => { if (a.password === "bad") throw new Error("auth"); });
  return { dir, svc, messages };
}
const acct = { host: "imap.example.com", port: 993, user: "me@example.com", password: "s3cret-app-pass" };

describe("MailService", () => {
  it("connects an account without ever exposing or storing the password in clear", async () => {
    const { dir, svc } = setup([]);
    const a = await svc.addAccount(acct);
    expect(JSON.stringify(a)).not.toContain("s3cret");
    expect(JSON.stringify(svc.overview())).not.toContain("s3cret");
    expect(fs.readFileSync(path.join(dir, "mail-accounts.json"), "utf8")).not.toContain("s3cret");
    await expect(svc.addAccount(acct)).rejects.toThrow(/ya está conectada/);
    await expect(svc.addAccount({ ...acct, host: "not a host", user: "x" })).rejects.toThrow(/Servidor IMAP/);
    await expect(svc.addAccount({ ...acct, user: "other@example.com", password: "bad" })).rejects.toThrow();
  });

  it("files new mail by category and project, once", async () => {
    const { svc, dir } = setup([raw(1, { subject: "Bug en Acme Shop" }), raw(2, { subject: "Factura de octubre", fromAddress: "billing@shop.com" }), raw(3, { subject: "Tu código de verificación", unread: false })]);
    await svc.addAccount(acct);
    expect((await svc.sync()).added).toBe(3);
    expect((await svc.sync()).added).toBe(0);
    const items = svc.overview().items;
    expect(items).toHaveLength(3);
    expect(items.find((m) => m.uid === 1)).toMatchObject({ projectPath: "/w/acme-shop" });
    expect(items.find((m) => m.uid === 2)?.category).toBe("facturas");
    expect(items.find((m) => m.uid === 3)?.category).toBe("seguridad");
    expect(fs.readFileSync(path.join(dir, "mail-items.json"), "utf8")).not.toContain("Factura de octubre"); // sealed at rest
  });

  it("learns from a manual assignment and applies it to the sender's next mail", async () => {
    const { svc, messages } = setup([raw(1, { subject: "Novedades", fromAddress: "boss@x.com" })]);
    await svc.addAccount(acct);
    await svc.sync();
    const id = svc.overview().items[0].id;
    svc.patchItem(id, { projectPath: "/w/zeta" });
    messages.push(raw(2, { subject: "Otra cosa", fromAddress: "boss@x.com" }));
    await svc.sync();
    expect(svc.overview().items.find((m) => m.uid === 2)?.projectPath).toBe("/w/zeta");
    expect(() => svc.patchItem(id, { projectPath: "/nope" })).toThrow(/no existe/);
    svc.patchItem(id, { done: true });
    expect(svc.overview().items.find((m) => m.id === id)).toMatchObject({ done: true, projectPath: "/w/zeta", manual: true });
  });

  it("reads on demand and remembers what you marked read, even after the next sync", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-mail-"));
    const messages = [raw(1, { subject: "Hola" })];
    const seen: [number, boolean][] = [];
    const svc = new MailService(new JsonStore(dir, new Set(MAIL_STORES)), () => [], async () => messages, async () => {}, {
      body: async (_a, uid) => ({ text: `cuerpo ${uid}`, to: "me@example.com", attachments: [], truncated: false }),
      setSeen: async (_a, uid, v) => void seen.push([uid, v]),
    });
    await svc.addAccount(acct);
    await svc.sync();
    const id = svc.overview().items[0].id;
    expect(await svc.body(id)).toMatchObject({ text: "cuerpo 1" });
    await expect(svc.body("nope")).rejects.toThrow(/no encontrado/);
    svc.patchItem(id, { read: true });
    expect(svc.overview().items[0].unread).toBe(false);
    await svc.sync(); // the server still says unread
    expect(svc.overview().items[0].unread).toBe(false);
    svc.patchItem(id, { read: false });
    expect(svc.overview().items[0].unread).toBe(true);
    expect(seen).toEqual([]); // the mailbox is untouched unless the user opts in
    svc.updateSettings({ syncSeen: true });
    svc.patchItem(id, { read: true });
    await Promise.resolve();
    expect(seen).toEqual([[1, true]]);
  });

  it("removing an account removes its messages; sync errors are reported, not thrown", async () => {
    const { svc } = setup([raw(1)]);
    const a = await svc.addAccount(acct);
    await svc.sync();
    svc.removeAccount(a.id);
    expect(svc.overview().items).toHaveLength(0);
    const bad = new MailService(new JsonStore(fs.mkdtempSync(path.join(os.tmpdir(), "agentic-mail-")), new Set(MAIL_STORES)), () => [], async () => { throw new Error("boom"); }, async () => {});
    await bad.addAccount(acct);
    const r = await bad.sync();
    expect(r.errors[0]).toMatch(/boom/);
    expect(bad.overview().accounts[0].lastError).toBe("boom");
  });
});
