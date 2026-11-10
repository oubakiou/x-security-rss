const JST_OFFSET_MS = 9 * 3_600_000;

function jstDay(ms: number): string {
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);
}

interface FetchRecord {
  fetched_at?: unknown;
  status?: { ok?: unknown };
}

/**
 * Scheduled runs are booked twice a day so one dropped by GitHub is covered by
 * the other; the later one must not pay for a second collection. Only a
 * successful run counts, so a failed first run is retried by the second.
 */
export function fetchedOnSameJstDay(records: Iterable<FetchRecord>, now: Date): string | undefined {
  const today = jstDay(now.getTime());
  for (const r of records) {
    if (r.status?.ok !== true || typeof r.fetched_at !== "string") continue;
    const ms = Date.parse(r.fetched_at);
    if (!Number.isNaN(ms) && ms <= now.getTime() && jstDay(ms) === today) return r.fetched_at;
  }
  return undefined;
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  describe("fetchedOnSameJstDay", () => {
    const ok = (fetched_at: string) => ({ fetched_at, status: { ok: true } });
    // 2026-11-10 13:00 JST
    const now = new Date("2026-11-10T04:00:00Z");

    it("finds a successful run earlier on the same JST day, across the UTC date boundary", () => {
      // 2026-11-10 08:00 JST is still 2026-11-09 in UTC
      expect(fetchedOnSameJstDay([ok("2026-11-09T23:00:00Z")], now)).toBe("2026-11-09T23:00:00Z");
    });

    it("ignores runs from the previous JST day", () => {
      // 2026-11-09 23:59 JST
      expect(fetchedOnSameJstDay([ok("2026-11-09T14:59:00Z")], now)).toBeUndefined();
    });

    it("ignores failed runs and malformed records", () => {
      expect(
        fetchedOnSameJstDay(
          [
            { fetched_at: "2026-11-10T01:00:00Z", status: { ok: false } },
            { fetched_at: "2026-11-10T01:00:00Z" },
            { fetched_at: "not a date", status: { ok: true } },
            { fetched_at: 1, status: { ok: true } },
          ],
          now,
        ),
      ).toBeUndefined();
    });

    it("ignores records dated in the future", () => {
      expect(fetchedOnSameJstDay([ok("2026-11-10T10:00:00Z")], now)).toBeUndefined();
    });
  });
}
