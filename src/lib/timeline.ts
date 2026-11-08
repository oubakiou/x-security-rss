import type { Topic } from "./types.ts";

const JST_OFFSET_MS = 9 * 3_600_000;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export interface DayGroup {
  /** "2026-11-07" in JST, or "unknown"; safe to use in ids and class names. */
  key: string;
  label: string;
  short: string;
  topics: Topic[];
}

function jstDate(iso: string): Date | undefined {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : new Date(ms + JST_OFFSET_MS);
}

/** "HH:MM" in JST for a post shown under its JST day heading. */
export function jstTime(iso: string): string {
  return jstDate(iso)?.toISOString().slice(11, 16) ?? "";
}

/** Groups topics by JST posting day, keeping their order (newest first). */
export function groupByDay(topics: Topic[]): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const t of topics) {
    const d = jstDate(t.posted_at);
    const key = d ? d.toISOString().slice(0, 10) : "unknown";
    const group =
      groups.get(key) ??
      (d
        ? {
            key,
            label: `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 (${WEEKDAYS[d.getUTCDay()]})`,
            short: `${d.getUTCMonth() + 1}/${String(d.getUTCDate()).padStart(2, "0")}`,
            topics: [],
          }
        : { key, label: "日付不明", short: "不明", topics: [] });
    group.topics.push(t);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) =>
    a.key === "unknown" ? 1 : b.key === "unknown" ? -1 : b.key.localeCompare(a.key),
  );
}

/**
 * Bars per day (oldest on the left) linking to `#d<day>`; while that fragment is the target only that
 * day's section shows. Like the category filter it is CSS only, because the page allows no scripts.
 */
export function timelineHtml(days: DayGroup[]): {
  bars: string;
  anchors: string;
  notes: string;
  css: string;
} {
  const max = Math.max(1, ...days.map((d) => d.topics.length));
  const ordered = [...days].reverse();
  const bars = ordered
    .map(
      (d) =>
        `<a href="#d${d.key}" title="${d.label} ${d.topics.length}件"><span>${d.topics.length}</span>` +
        `<span class="bar" style="height:${Math.max(4, Math.round((d.topics.length / max) * 100))}%"></span><span>${d.short}</span></a>`,
    )
    .join("");
  const css = days
    .map(
      (d) =>
        `body:has(#d${d.key}:target) .day:not(.day-${d.key}){display:none}` +
        `body:has(#d${d.key}:target) .timeline a[href="#d${d.key}"]{color:var(--fg);font-weight:bold}` +
        `body:has(#d${d.key}:target) .timeline a[href="#d${d.key}"] .bar{background:var(--bar-on)}` +
        `body:has(#d${d.key}:target) .note-${d.key}{display:block}`,
    )
    .join("\n");
  return {
    bars: days.length ? `<nav class="timeline" aria-label="日付で絞り込み">${bars}</nav>` : "",
    anchors: days.map((d) => `<span id="d${d.key}" class="anchor"></span>`).join(""),
    notes: days
      .map(
        (d) =>
          `<p class="day-note note-${d.key}">${d.label} の記事を表示中 (${d.topics.length}件) — <a href="#">すべての日付</a></p>`,
      )
      .join(""),
    css,
  };
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;
  const t = (id: string, posted_at: string): Topic => ({
    id,
    title: id,
    url: `https://x.com/i/status/${id}`,
    author: "a",
    posted_at,
    summary: "",
    tags: [],
    collected_at: posted_at,
  });

  describe("groupByDay", () => {
    it("groups by JST day, newest day first, keeping order within a day", () => {
      const days = groupByDay([
        t("1", "2026-11-07T20:00:00Z"),
        t("2", "2026-11-07T14:59:00Z"),
        t("3", "2026-11-06T16:00:00Z"),
        t("4", "2026-11-06T14:00:00Z"),
      ]);
      expect(days.map((d) => [d.key, d.topics.map((x) => x.id)])).toEqual([
        ["2026-11-08", ["1"]],
        ["2026-11-07", ["2", "3"]],
        ["2026-11-06", ["4"]],
      ]);
      expect(days[1]).toMatchObject({ label: "11月7日 (土)", short: "11/07" });
      expect(jstTime("2026-11-06T16:00:00Z")).toBe("01:00");
    });

    it("puts unparsable dates last under a fixed key", () => {
      const days = groupByDay([t("1", "garbage"), t("2", "2026-11-07T00:00:00Z")]);
      expect(days.map((d) => d.key)).toEqual(["2026-11-07", "unknown"]);
      expect(days[1]?.label).toBe("日付不明");
    });
  });

  describe("timelineHtml", () => {
    it("draws bars oldest first, scaled to the busiest day, with fragment links and CSS", () => {
      const days = groupByDay([
        t("1", "2026-11-07T01:00:00Z"),
        t("2", "2026-11-07T02:00:00Z"),
        t("3", "2026-11-05T01:00:00Z"),
      ]);
      const h = timelineHtml(days);
      expect(h.bars.indexOf("#d2026-11-05")).toBeLessThan(h.bars.indexOf("#d2026-11-07"));
      expect(h.bars).toContain(
        'href="#d2026-11-07" title="11月7日 (土) 2件"><span>2</span><span class="bar" style="height:100%">',
      );
      expect(h.bars).toContain('style="height:50%"');
      expect(h.anchors).toContain('<span id="d2026-11-05" class="anchor"></span>');
      expect(h.css).toContain("body:has(#d2026-11-07:target) .day:not(.day-2026-11-07){display:none}");
      expect(h.notes).toContain("11月5日 (木) の記事を表示中 (1件)");
      expect(timelineHtml([]).bars).toBe("");
    });
  });
}
