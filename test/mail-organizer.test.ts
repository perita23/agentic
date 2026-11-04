import { describe, expect, it } from "vitest";
import { decodeEntities } from "@/lib/server/mail-imap";
import { categorize, matchProject, type MailLike } from "@/lib/mail";

const mail = (o: Partial<MailLike>): MailLike => ({ fromName: "X", fromAddress: "x@example.com", subject: "", snippet: "", listUnsubscribe: false, unread: true, ...o });

describe("mail categories", () => {
  it("sorts by what the message is", () => {
    expect(categorize(mail({ fromAddress: "noreply@github.com", subject: "[acme/api] PR #4 merged" })).category).toBe("desarrollo");
    expect(categorize(mail({ subject: "Factura de octubre" })).category).toBe("facturas");
    expect(categorize(mail({ subject: "Invitación: Daily a las 10" })).category).toBe("reuniones");
    expect(categorize(mail({ subject: "Tu código de verificación es 123456" })).category).toBe("seguridad");
    expect(categorize(mail({ fromAddress: "hello@shop.com", listUnsubscribe: true, subject: "Ofertas" })).category).toBe("newsletters");
    expect(categorize(mail({ subject: "Hola, ¿comemos?" })).category).toBe("personal");
  });
  it("flags unread urgent mail on top of its category", () => {
    const r = categorize(mail({ subject: "URGENTE: factura vencida" }));
    expect(r).toMatchObject({ category: "urgente", urgent: true });
    expect(categorize(mail({ subject: "URGENTE: factura vencida", unread: false })).urgent).toBe(false);
  });
});

describe("mail → project", () => {
  const projects = [
    { path: "/w/acme-shop", name: "Acme Shop" },
    { path: "/w/zeta", name: "Zeta" },
    { path: "/w/app", name: "app" },
  ];
  it("matches the project named in the subject or preview", () => {
    expect(matchProject(mail({ subject: "Bug en Acme Shop checkout" }), projects, {})?.path).toBe("/w/acme-shop");
    expect(matchProject(mail({ subject: "Novedades", snippet: "el repo acme-shop falla" }), projects, {})?.path).toBe("/w/acme-shop");
  });
  it("ignores generic names, partial words and ties", () => {
    expect(matchProject(mail({ subject: "Nueva app disponible" }), projects, {})).toBeNull();
    expect(matchProject(mail({ subject: "Zetas y más" }), projects, {})).toBeNull();
    expect(matchProject(mail({ subject: "Zeta vs Acme Shop" }), projects, {})).toBeNull();
  });
  it("a rule learnt from the sender wins, if the project still exists", () => {
    expect(matchProject(mail({ fromAddress: "Boss@x.com", subject: "Hola" }), projects, { "boss@x.com": "/w/zeta" })?.path).toBe("/w/zeta");
    expect(matchProject(mail({ fromAddress: "boss@x.com", subject: "Hola" }), projects, { "boss@x.com": "/gone" })).toBeNull();
  });
});

describe("decodeEntities", () => {
  it("decodes numeric and common named entities, leaves unknown ones", () => {
    expect(decodeEntities("Tareas por hacer&#x2192; &amp; m&aacute;s &#8594; &nbsp;fin")).toBe("Tareas por hacer→ & m&aacute;s →  fin");
  });
});
