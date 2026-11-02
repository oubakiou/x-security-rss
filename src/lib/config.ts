const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

/**
 * Accounts searched separately with `allowed_x_handles` so primary sources are
 * always considered. Max 20 (API limit). Override with the TRUSTED_HANDLES
 * Actions variable (comma separated, without @).
 */
export const DEFAULT_TRUSTED_HANDLES = [
  // Government / CERT
  "CISAgov",
  "CISACyber",
  "NCSC",
  "CERT_CC",
  "jpcert",
  // Vendor threat intel / vulnerability research
  "MsftSecIntel",
  "msftsecresponse",
  "Mandiant",
  "TalosSecurity",
  "Unit42_Intel",
  "thezdi",
  "Shadowserver",
  // Security news
  "BleepinComputer",
  "TheHackersNews",
  "SecurityWeek",
  "DarkReading",
] as const;

export function parseHandles(raw: string | undefined, fallback: readonly string[]): string[] {
  if (!raw?.trim()) return [...fallback];
  const handles = raw
    .split(/[\s,]+/)
    .map((h) => h.replace(/^@/, ""))
    .filter((h) => HANDLE_RE.test(h));
  const unique = [...new Set(handles)].slice(0, 20);
  return unique.length ? unique : [...fallback];
}

/** Previous full UTC day: [from 00:00, to 00:00). */
export function previousUtcDay(now: Date): { from: string; to: string } {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(today - 86_400_000), to: iso(today) };
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  describe("parseHandles", () => {
    it("uses the fallback when unset or invalid", () => {
      expect(parseHandles(undefined, ["a"])).toEqual(["a"]);
      expect(parseHandles("  ", ["a"])).toEqual(["a"]);
      expect(parseHandles("bad-handle, way_too_long_handle_name", ["a"])).toEqual(["a"]);
    });
    it("parses, strips @, dedupes and caps at 20", () => {
      expect(parseHandles("@CISAgov, jpcert jpcert", [])).toEqual(["CISAgov", "jpcert"]);
      const many = Array.from({ length: 30 }, (_, i) => `h${i}`).join(",");
      expect(parseHandles(many, [])).toHaveLength(20);
    });
    it("default list fits the API limit", () => {
      expect(DEFAULT_TRUSTED_HANDLES.length).toBeLessThanOrEqual(20);
      for (const h of DEFAULT_TRUSTED_HANDLES) expect(HANDLE_RE.test(h), h).toBe(true);
    });
  });

  describe("previousUtcDay", () => {
    it("returns the previous full UTC day", () => {
      expect(previousUtcDay(new Date("2026-11-03T00:00:05Z"))).toEqual({
        from: "2026-11-02",
        to: "2026-11-03",
      });
      expect(previousUtcDay(new Date("2026-01-01T17:00:00Z"))).toEqual({
        from: "2025-12-31",
        to: "2026-01-01",
      });
    });
  });
}
