import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { AVATAR_IDS, AVATAR_PRESETS } from "@/lib/avatars";
import { ProfileService } from "@/lib/server/profile";
import { JsonStore } from "@/lib/server/store";
import { findUpload, saveUpload } from "@/lib/server/uploads";
import { tmpDir } from "./helpers";

// A 1×1 PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function svc() {
  const dir = tmpDir();
  return { p: new ProfileService(new JsonStore(dir), dir), dir };
}

describe("profile", () => {
  it("starts empty and keeps a trimmed name", () => {
    const { p } = svc();
    expect(p.get()).toEqual({ name: "", avatar: null, createdAt: "" });
    const r = p.set({ name: "  Hugo  " });
    expect(r.name).toBe("Hugo");
    expect(r.createdAt).not.toBe("");
  });

  it("rejects an over-long name and keeps the rest when only one field is sent", () => {
    const { p } = svc();
    p.set({ name: "Hugo", avatar: { kind: "preset", id: "aurora" } });
    expect(() => p.set({ name: "x".repeat(61) })).toThrow();
    expect(p.set({ name: "Hugo G." })).toMatchObject({ name: "Hugo G.", avatar: { kind: "preset", id: "aurora" } });
  });

  it("only accepts the predefined avatars that exist", () => {
    const { p } = svc();
    expect(AVATAR_PRESETS).toHaveLength(12);
    expect(new Set(AVATAR_IDS).size).toBe(12);
    expect(p.set({ avatar: { kind: "preset", id: "ember" } }).avatar).toEqual({ kind: "preset", id: "ember" });
    expect(() => p.set({ avatar: { kind: "preset", id: "no-existe" } })).toThrow(/no válido/);
    expect(() => p.set({ avatar: { kind: "otro", id: "x" } })).toThrow();
  });

  it("a photo must have been uploaded, and a replaced one is deleted from disk", () => {
    const { p, dir } = svc();
    expect(() => p.set({ avatar: { kind: "photo", id: "00000000-0000-4000-8000-000000000000" } })).toThrow(/ya no existe/);
    const a = saveUpload(dir, { mime: "image/png", data: PNG });
    const b = saveUpload(dir, { mime: "image/png", data: PNG });
    p.set({ avatar: { kind: "photo", id: a.id } });
    expect(findUpload(dir, a.id)).not.toBeNull();
    p.set({ avatar: { kind: "photo", id: b.id } });
    expect(findUpload(dir, a.id)).toBeNull(); // the old photo does not stay on disk
    p.set({ avatar: { kind: "preset", id: "slate" } });
    expect(findUpload(dir, b.id)).toBeNull();
    p.set({ avatar: null });
    expect(p.get().avatar).toBeNull();
    expect(fs.readdirSync(`${dir}/uploads`)).toEqual([]);
  });
});
