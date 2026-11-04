import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { linkify } from "@/components/app/linkify";

const html = (t: string) => renderToStaticMarkup(React.createElement(React.Fragment, null, ...linkify(t)));

describe("linkify", () => {
  it("turns Claude artifact URLs into a clickable button that opens in a new tab", () => {
    const out = html("Aquí lo tienes: https://claude.ai/artifact/PHSm9eeQijUzXhzrN3yyV8");
    expect(out).toContain('href="https://claude.ai/artifact/PHSm9eeQijUzXhzrN3yyV8"');
    expect(out).toContain("Abrir artifact");
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(html("https://claude.ai/code/artifact/abc-123_x")).toContain("Abrir artifact");
  });

  it("links other http(s) URLs, leaving trailing punctuation outside", () => {
    const out = html("Mira (https://example.com/a?b=1). Y https://github.com/x/y, gracias");
    expect(out).toContain('href="https://example.com/a?b=1"');
    expect(out).toContain('href="https://github.com/x/y"');
    expect(out).toContain("). Y ");
    expect(out).not.toContain("Abrir artifact");
  });

  it("never links other schemes and escapes HTML", () => {
    expect(html("javascript:alert(1) y file:///etc/passwd")).not.toContain("<a ");
    const out = html('<script>alert(1)</script> https://example.com/<b>');
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });
});
