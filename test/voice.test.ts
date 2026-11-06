import { describe, expect, it } from "vitest";
import { LANGUAGES, resolveLang } from "@/lib/voice/engine";
import { voiceColor, VOICE_COLORS } from "@/lib/voice/palette";

describe("dictation language", () => {
  it("follows the system when asked for 'auto', as a full tag", () => {
    expect(resolveLang("auto", "es-ES")).toBe("es-ES");
    expect(resolveLang("auto", "en-US")).toBe("en-US");
    expect(resolveLang("auto", "es")).toBe("es-ES");
    expect(resolveLang("auto", "fr")).toBe("fr-FR");
    expect(resolveLang("auto", "")).toBe("es-ES");
  });
  it("keeps a language that was chosen, and never returns nonsense", () => {
    expect(resolveLang("en-GB", "es-ES")).toBe("en-GB");
    expect(resolveLang("auto", "xx")).toBe("es-ES");
    for (const l of LANGUAGES) expect(resolveLang(l.value, "es-ES")).toMatch(/^[a-z]{2,3}-[A-Za-z0-9]{2,8}$/);
  });
});

describe("dictation colours", () => {
  it("go through the orb's violet, coral and blue", () => {
    expect(VOICE_COLORS).toEqual(["#8b6cf5", "#ff8a5b", "#5aa9ff"]);
    expect(voiceColor(0)).toBe("rgb(139 108 245)");
    expect(voiceColor(0.5)).toBe("rgb(255 138 91)");
    expect(voiceColor(1)).toBe("rgb(90 169 255)");
    expect(voiceColor(-3)).toBe(voiceColor(0));
    expect(voiceColor(9)).toBe(voiceColor(1));
  });
});
