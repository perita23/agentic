import { describe, expect, it } from "vitest";
import { emailDocument, inlineCidImages, sanitizeEmailHtml } from "@/lib/server/mail-html";

describe("email HTML", () => {
  it("strips active content and makes links open outside", () => {
    const h = sanitizeEmailHtml(
      '<p onclick="x()">Hola</p><script>alert(1)</script><iframe src="https://evil"></iframe><form action="/x"><input name=a></form><meta http-equiv="refresh" content="0;url=https://evil"><base href="https://evil/"><a href="https://ok.com" target="_self">ok</a><a href="javascript:alert(1)">mal</a><img src="https://img.example.com/a.png">',
    )!;
    expect(h).not.toMatch(/<script|<iframe|<form|<input|<meta|<base|onclick|javascript:/i);
    expect(h).toContain('<a href="https://ok.com" target="_blank" rel="noopener noreferrer">');
    expect(h).toContain('<img src="https://img.example.com/a.png">'); // pictures are kept
  });
  it("drops absurdly big documents and wraps the rest in a styled page", () => {
    expect(sanitizeEmailHtml("x".repeat(900_000))).toBeUndefined();
    expect(emailDocument("<p>a</p>")).toContain("<body");
  });
  it("embeds cid: pictures as data URIs, images only", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const out = inlineCidImages('<img src="cid:logo@x"><img src="cid:doc">', [
      { cid: "<logo@x>", contentType: "image/png", content: png },
      { cid: "doc", contentType: "application/pdf", content: png },
    ]);
    expect(out).toContain("data:image/png;base64,");
    expect(out).toContain("cid:doc");
  });
});
