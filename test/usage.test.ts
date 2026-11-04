import { describe, expect, it } from "vitest";
import { detectJiraKey } from "@/lib/jira-key";
import { parseRateLimit, untilReset } from "@/lib/usage";

const ev = (info: object) => ({ type: "rate_limit_event", rate_limit_info: info });

describe("usage limits", () => {
  it("parses Claude Code's rate_limit_event (seconds or ms, fraction or percent)", () => {
    const a = parseRateLimit(ev({ status: "allowed_warning", resetsAt: 1_800_000_000, rateLimitType: "five_hour", utilization: 0.62 }), "2026-11-04T10:00:00Z");
    expect(a).toMatchObject({ type: "five_hour", status: "allowed_warning", resetsAt: 1_800_000_000_000, utilization: 0.62 });
    expect(parseRateLimit(ev({ resetsAt: 1_800_000_000_000, utilization: 62 }), "x")).toMatchObject({ resetsAt: 1_800_000_000_000, utilization: 0.62, type: "unknown", status: "allowed" });
    expect(parseRateLimit(ev({ status: "rejected", rateLimitType: "seven_day" }), "x")).toMatchObject({ utilization: null, resetsAt: null });
    expect(parseRateLimit({ type: "result" }, "x")).toBeNull();
    expect(parseRateLimit(null, "x")).toBeNull();
  });

  it("formats the time until the reset", () => {
    const now = 1_000_000_000_000;
    expect(untilReset(now + 14 * 60_000, now)).toBe("14 min");
    expect(untilReset(now + (2 * 60 + 5) * 60_000, now)).toBe("2 h 05 min");
    expect(untilReset(now + 72 * 3600_000, now)).toBe("3 días");
    expect(untilReset(now - 1000, now)).toBe("ahora");
  });

  it("detects the Jira key of a session", () => {
    expect(detectJiraKey("sin clave", "Resumen de INOX-2021 listo")).toBe("INOX-2021");
    expect(detectJiraKey(null, undefined, "ver SHOP-7 y ABC-12")).toBe("SHOP-7");
    expect(detectJiraKey("utf-8 y sha-256 y x-1")).toBeNull();
  });
});
