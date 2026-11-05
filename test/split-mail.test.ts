import { describe, expect, it } from "vitest";
import { splitMail } from "@/components/app/markdown";

const MAIL = `**Subject:** Request for a subdomain

Hi,

Could you please create a subdomain?

Thanks in advance.

Best regards,
Hugo

Esta versión sigue tu texto original.`;

describe("splitMail", () => {
  it("boxes an email from its Subject line to the signature", () => {
    const r = splitMail(MAIL)!;
    expect(r.mail.startsWith("**Subject:**")).toBe(true);
    expect(r.mail.endsWith("Hugo")).toBe(true);
    expect(r.after.trim()).toBe("Esta versión sigue tu texto original.");
    expect(r.before).toBe("");
  });
  it("keeps the text before it", () => {
    expect(splitMail(`Aquí tienes:\n\nAsunto: Hola\n\nHola,\n\nUn saludo\nAna`)!.before.trim()).toBe("Aquí tienes:");
  });
  it("leaves ordinary answers and code fences alone", () => {
    expect(splitMail("Solo texto normal")).toBeNull();
    expect(splitMail("```\nSubject: x\n\nhola\n\nmás\n```")).toBeNull();
  });
});
