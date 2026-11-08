const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

/**
 * Accounts searched separately with `allowed_x_handles` so primary sources are
 * always considered. Max 20 (API limit). Override with the TRUSTED_HANDLES
 * Actions variable (comma separated, without @).
 */
export const DEFAULT_TRUSTED_HANDLES = [
  "CISACyber",
  "jpcert",
  "MsftSecIntel",
  "Mandiant",
  "Unit42_Intel",
  "BleepinComputer",
  "TheHackersNews",
  "SecurityWeek",
  "DarkReading",
  "piyokango",
  "cyber_forecast",
  "yousukezan",
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

/**
 * Accounts never to publish, from the EXCLUDED_HANDLES Actions variable only (no default list).
 * Passed to x_search as `excluded_x_handles` and also enforced on results, because posts the
 * model reaches through thread fetches are not filtered by the tool. Returned lowercase.
 */
export function parseExcludedHandles(raw: string | undefined): string[] {
  return [...new Set(parseHandles(raw, []).map((h) => h.toLowerCase()))];
}

/**
 * Rolling window ending at `now`. x_search's from_date/to_date are not
 * strictly honored (it favors the most recent posts), so the window is
 * enforced by us from snowflake times; the tool dates only hint the range.
 */
export function rollingWindow(now: Date, hours: number) {
  const end = now.getTime();
  const start = end - hours * 3_600_000;
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return {
    start,
    end,
    label: `${fmt(start)}〜${fmt(end)} UTC`,
    /** inclusive start date / exclusive end date for x_search */
    fromDate: day(start),
    toDate: day(end + 86_400_000),
  };
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

  describe("parseExcludedHandles", () => {
    it("is empty unless set, and lowercases valid handles", () => {
      expect(parseExcludedHandles(undefined)).toEqual([]);
      expect(parseExcludedHandles(" ")).toEqual([]);
      expect(parseExcludedHandles("bad-handle")).toEqual([]);
      expect(parseExcludedHandles("@SpamBot, other_Acct spambot")).toEqual(["spambot", "other_acct"]);
    });
  });

  describe("rollingWindow", () => {
    it("covers the last N hours", () => {
      const w = rollingWindow(new Date("2026-11-03T00:00:00Z"), 24);
      expect(w.start).toBe(Date.parse("2026-11-02T00:00:00Z"));
      expect(w.end).toBe(Date.parse("2026-11-03T00:00:00Z"));
      expect(w.label).toBe("2026-11-02 00:00〜2026-11-03 00:00 UTC");
      expect([w.fromDate, w.toDate]).toEqual(["2026-11-02", "2026-11-04"]);
    });
  });
}
