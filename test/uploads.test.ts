import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findUpload, saveUpload } from "@/lib/server/uploads";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

describe("uploads", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-up-"));
  it("stores a real image privately and finds it by id", () => {
    const r = saveUpload(dir, { mime: "image/png", data: PNG.toString("base64") });
    const f = findUpload(dir, r.id)!;
    expect(f.mime).toBe("image/png");
    expect(fs.statSync(f.path).mode & 0o777).toBe(0o600);
  });
  it("rejects fake images, wrong declared types and bad ids", () => {
    expect(() => saveUpload(dir, { mime: "image/png", data: Buffer.from("<script>alert(1)</script>").toString("base64") })).toThrow(/imagen válida/);
    expect(() => saveUpload(dir, { mime: "image/jpeg", data: PNG.toString("base64") })).toThrow(/imagen válida/);
    expect(() => saveUpload(dir, { mime: "text/html", data: "aaaaaaaaaa" })).toThrow();
    expect(findUpload(dir, "../../etc/passwd")).toBeNull();
  });
});
