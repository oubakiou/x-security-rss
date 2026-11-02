import type { Topic } from "./types.ts";

const STATUS_RE = /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/;
const STATUS_ANYWHERE_RE = /(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/(\d+)/g;

/** JSON Schema passed to the Responses API (structured output). */
export const TOPICS_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "日本語の見出し (60字以内)" },
          url: { type: "string", description: "https://x.com/<handle>/status/<id>" },
          author: { type: "string", description: "表示名 (@handle)" },
          posted_at: { type: "string", description: "ISO 8601 UTC" },
          summary: { type: "string", description: "日本語の要約 (200字程度)" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["title", "url", "author", "posted_at", "summary", "tags"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

/** Find the model's final text in a Responses API result. */
export function extractOutputText(resp: unknown): string {
  const output = (resp as { output?: unknown[] })?.output ?? [];
  for (const item of output as Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type === "output_text" && typeof c.text === "string") return c.text;
    }
  }
  throw new Error("応答に output_text がありません");
}

/**
 * Status ids the API itself reports as sources: top-level citations, message
 * annotations and tool-call outputs. The model's own answer text and its
 * reasoning are excluded so a made-up URL cannot verify itself.
 */
export function citedStatusIds(resp: unknown): Set<string> {
  const r = (resp ?? {}) as { citations?: unknown; output?: unknown };
  const sources: unknown[] = [r.citations];
  for (const o of Array.isArray(r.output) ? r.output : []) {
    const item = o as { type?: string; content?: Array<{ annotations?: unknown }> };
    if (item.type === "reasoning") continue;
    if (item.type === "message") {
      for (const c of item.content ?? []) sources.push(c.annotations);
    } else {
      sources.push(item);
    }
  }
  const blob = JSON.stringify(sources);
  const ids = new Set<string>();
  for (const m of blob.matchAll(STATUS_ANYWHERE_RE)) ids.add(m[1]!);
  return ids;
}

export interface NormalizeResult {
  items: Topic[];
  dropped: number;
}

/**
 * Validate model-produced items: require a real X status URL and, when the
 * response carries citations, require that the URL was actually cited.
 */
export function normalizeItems(raw: unknown, cited: Set<string>, collectedAt: string): NormalizeResult {
  const list = (raw as { items?: unknown })?.items;
  if (!Array.isArray(list)) throw new Error("items 配列がありません");

  const seen = new Set<string>();
  const items: Topic[] = [];
  let dropped = 0;
  for (const r of list as Array<Record<string, unknown>>) {
    const m = STATUS_RE.exec(str(r.url));
    const verified = m && (cited.size === 0 || cited.has(m[2]!));
    if (!m || !verified || seen.has(m[2]!)) {
      dropped++;
      continue;
    }
    const [, handle, id] = m as unknown as [string, string, string];
    seen.add(id);
    items.push({
      id,
      url: `https://x.com/${handle}/status/${id}`,
      title: str(r.title) || "(無題)",
      author: str(r.author) || `@${handle}`,
      posted_at: str(r.posted_at) || collectedAt,
      summary: str(r.summary),
      tags: Array.isArray(r.tags) ? r.tags.map(str).filter(Boolean) : [],
      collected_at: collectedAt,
    });
  }
  return { items, dropped };
}

/** Merge days (newest first), dedupe by id, sort by posted_at desc, cap. */
export function mergeTopics(days: Topic[][], limit: number): Topic[] {
  const byId = new Map<string, Topic>();
  for (const day of days) for (const t of day) if (!byId.has(t.id)) byId.set(t.id, t);
  return [...byId.values()].sort((a, b) => toTime(b.posted_at) - toTime(a.posted_at)).slice(0, limit);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function toTime(s: string): number {
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  const AT = "2026-11-02T00:00:00Z";

  describe("normalizeItems", () => {
    const base = { title: "t", author: "a", posted_at: AT, summary: "s", tags: ["x"] };

    it("keeps valid x.com/twitter.com status URLs and canonicalizes them", () => {
      const { items, dropped } = normalizeItems(
        { items: [{ ...base, url: "https://twitter.com/foo/status/123?s=20" }] },
        new Set(),
        AT,
      );
      expect(dropped).toBe(0);
      expect(items[0]).toMatchObject({ id: "123", url: "https://x.com/foo/status/123" });
    });

    it("drops non-status URLs, uncited ids and duplicates", () => {
      const { items, dropped } = normalizeItems(
        {
          items: [
            { ...base, url: "https://example.com/post" },
            { ...base, url: "https://x.com/foo/status/1" },
            { ...base, url: "https://x.com/foo/status/2" },
            { ...base, url: "https://x.com/bar/status/2" },
          ],
        },
        new Set(["2"]),
        AT,
      );
      expect(items.map((i) => i.id)).toEqual(["2"]);
      expect(dropped).toBe(3);
    });

    it("throws when items is missing", () => {
      expect(() => normalizeItems({}, new Set(), AT)).toThrow();
    });
  });

  describe("citedStatusIds", () => {
    it("collects ids from citations, annotations and tool output but not from answer text or reasoning", () => {
      const resp = {
        citations: ["https://x.com/a/status/1"],
        output: [
          { type: "reasoning", summary: "https://x.com/r/status/9" },
          { type: "custom_tool_call", output: "see x.com/b/status/2" },
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "https://x.com/fake/status/999",
                annotations: [{ url: "https://x.com/c/status/3" }],
              },
            ],
          },
        ],
      };
      expect([...citedStatusIds(resp)].sort()).toEqual(["1", "2", "3"]);
    });
  });

  describe("extractOutputText", () => {
    it("returns the message output_text", () => {
      const resp = { output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }] };
      expect(extractOutputText(resp)).toBe("{}");
    });
    it("throws without a message", () => {
      expect(() => extractOutputText({ output: [] })).toThrow();
    });
  });

  describe("mergeTopics", () => {
    const t = (id: string, posted_at: string): Topic => ({
      id,
      posted_at,
      title: id,
      url: `https://x.com/u/status/${id}`,
      author: "u",
      summary: "",
      tags: [],
      collected_at: AT,
    });
    it("dedupes (first wins), sorts newest first and caps", () => {
      const merged = mergeTopics(
        [
          [t("1", "2026-11-02T01:00:00Z"), t("2", "2026-11-02T03:00:00Z")],
          [{ ...t("1", "2026-11-01T00:00:00Z"), title: "old" }, t("3", "2026-11-02T02:00:00Z")],
        ],
        2,
      );
      expect(merged.map((m) => m.id)).toEqual(["2", "3"]);
    });
  });
}
