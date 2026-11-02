import type { Topic } from "./types.ts";

export const LIMITS = { title: 120, summary: 600, author: 80, tags: 10, tag: 40 } as const;
const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"]);
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
/** Twitter/X snowflake epoch (ms). */
const SNOWFLAKE_EPOCH = 1288834974657n;

export interface StatusRef {
  /** handle from the URL, or undefined for /i/status/<id> */
  handle?: string;
  id: string;
}

/** Strictly parse an X status URL. Rejects other hosts, schemes and shapes. */
export function parseStatusUrl(input: unknown): StatusRef | undefined {
  if (typeof input !== "string") return undefined;
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:" || !X_HOSTS.has(u.hostname) || u.username || u.password || u.port) {
    return undefined;
  }
  const parts = u.pathname.split("/").filter(Boolean);
  // /<handle>/status/<id>  or  /i/status/<id>  or  /i/web/status/<id>
  const idx = parts.indexOf("status");
  if (idx < 1 || idx !== parts.length - 2) return undefined;
  const id = parts[idx + 1]!;
  if (!/^\d{1,20}$/.test(id)) return undefined;
  const head = parts.slice(0, idx);
  if (head.length === 1 && head[0] === "i") return { id };
  if (head.length === 2 && head[0] === "i" && head[1] === "web") return { id };
  if (head.length === 1 && HANDLE_RE.test(head[0]!)) return { handle: head[0]!, id };
  return undefined;
}

/** Posting time encoded in an X snowflake id (undefined for pre-snowflake ids). */
export function snowflakeTime(id: string): Date | undefined {
  try {
    const ms = (BigInt(id) >> 22n) + SNOWFLAKE_EPOCH;
    return ms > SNOWFLAKE_EPOCH ? new Date(Number(ms)) : undefined;
  } catch {
    return undefined;
  }
}

/** Remove characters not allowed in XML 1.0 plus bidi/zero-width controls, trim and cap length. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const cleaned = v
    // oxlint-disable-next-line no-control-regex
    .replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .trim();
  const chars = Array.from(cleaned);
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : cleaned;
}

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
 * Status refs the API itself reports as sources: the top-level `citations`
 * list and `annotations[].url` on message content. Only these structured
 * fields are read (never tool output text, the answer text or reasoning), so
 * a URL written inside a post or made up by the model cannot verify itself.
 * Returns id -> handle (undefined when the citation is /i/status/<id>).
 */
export function citedStatuses(resp: unknown): Map<string, string | undefined> {
  const r = (resp ?? {}) as { citations?: unknown; output?: unknown };
  const urls: unknown[] = Array.isArray(r.citations) ? [...(r.citations as unknown[])] : [];
  for (const o of Array.isArray(r.output) ? r.output : []) {
    const item = o as { type?: string; content?: unknown };
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const c of item.content as Array<{ annotations?: unknown }>) {
      if (!Array.isArray(c.annotations)) continue;
      for (const a of c.annotations as Array<{ url?: unknown }>) urls.push(a?.url);
    }
  }
  const out = new Map<string, string | undefined>();
  for (const u of urls) {
    const ref = parseStatusUrl(u);
    if (!ref) continue;
    if (ref.handle || !out.has(ref.id)) out.set(ref.id, ref.handle?.toLowerCase() ?? out.get(ref.id));
  }
  return out;
}

export interface NormalizeOptions {
  collectedAt: string;
  /** earliest acceptable posting time (ms) */
  notBefore: number;
  /** latest acceptable posting time (ms); defaults to collectedAt + 1h */
  notAfter?: number;
  maxItems: number;
  /** ids already taken by an earlier search (skipped, not counted as dropped) */
  exclude?: Set<string>;
}

export type RejectReason =
  | "bad_url"
  | "bad_id"
  | "not_cited"
  | "duplicate"
  | "handle_mismatch"
  | "before_window"
  | "after_window"
  | "over_limit";

export interface Rejected {
  reason: RejectReason;
  /** status id when the URL could be parsed (public X post id) */
  id?: string;
  /** posting time decoded from the id */
  posted_at?: string;
}

export interface NormalizeResult {
  items: Topic[];
  dropped: number;
  rejected: Rejected[];
}

/**
 * Validate model-produced items (fail-closed):
 * - url must be a real X status URL whose id the API reported as a source
 * - if the citation carries a handle, it must match the item's handle
 * - posting time comes from the snowflake id, not from the model
 * - text fields are cleaned and length-capped; count is capped
 */
export function normalizeItems(
  raw: unknown,
  cited: Map<string, string | undefined>,
  opts: NormalizeOptions,
): NormalizeResult {
  const list = (raw as { items?: unknown })?.items;
  if (!Array.isArray(list)) throw new Error("items 配列がありません");

  const notAfter = opts.notAfter ?? Date.parse(opts.collectedAt) + 3_600_000;
  const seen = new Set<string>();
  const items: Topic[] = [];
  const rejected: Rejected[] = [];
  for (const r of list as Array<Record<string, unknown>>) {
    const ref = parseStatusUrl(r?.url);
    if (!ref) {
      rejected.push({ reason: "bad_url" });
      continue;
    }
    if (opts.exclude?.has(ref.id)) continue;
    const time = snowflakeTime(ref.id);
    if (!time) {
      rejected.push({ reason: "bad_id", id: ref.id });
      continue;
    }
    const posted_at = time.toISOString().slice(0, 19) + "Z";
    const citedHandle = cited.get(ref.id);
    const reason: RejectReason | undefined = !cited.has(ref.id)
      ? "not_cited"
      : seen.has(ref.id)
        ? "duplicate"
        : citedHandle && citedHandle !== ref.handle?.toLowerCase()
          ? "handle_mismatch"
          : time.getTime() < opts.notBefore
            ? "before_window"
            : time.getTime() > notAfter
              ? "after_window"
              : items.length >= opts.maxItems
                ? "over_limit"
                : undefined;
    if (reason) {
      rejected.push({ reason, id: ref.id, posted_at });
      continue;
    }
    seen.add(ref.id);
    const handle = citedHandle ?? ref.handle;
    const name = cleanText(r.author, LIMITS.author).replace(/\s*\(@[^)]*\)\s*$/, "");
    items.push({
      id: ref.id,
      // /i/status/<id> redirects to the real author, so a spoofed handle can't misdirect the link
      url: `https://x.com/i/status/${ref.id}`,
      title: cleanText(r.title, LIMITS.title) || "(無題)",
      author: citedHandle
        ? `${name || citedHandle} (@${citedHandle})`
        : `${name || "不明"}${handle ? ` (@${handle})` : ""} ※投稿者未検証`,
      posted_at,
      summary: cleanText(r.summary, LIMITS.summary),
      tags: (Array.isArray(r.tags) ? r.tags : [])
        .map((t) => cleanText(t, LIMITS.tag))
        .filter(Boolean)
        .slice(0, LIMITS.tags),
      collected_at: opts.collectedAt,
    });
  }
  return { items, dropped: rejected.length, rejected };
}

/**
 * Merge days (newest first), dedupe by id, sort by posted_at desc, cap.
 * Stored data is re-sanitized (defense in depth): id must be numeric and the
 * link is rebuilt from it.
 */
export function mergeTopics(days: Topic[][], limit: number): Topic[] {
  const byId = new Map<string, Topic>();
  for (const day of days) {
    for (const t of day) {
      if (typeof t?.id !== "string" || !/^\d{1,20}$/.test(t.id) || byId.has(t.id)) continue;
      const time = snowflakeTime(t.id);
      byId.set(t.id, {
        id: t.id,
        url: `https://x.com/i/status/${t.id}`,
        title: cleanText(t.title, LIMITS.title) || "(無題)",
        author: cleanText(t.author, LIMITS.author + 20),
        posted_at: time ? time.toISOString().slice(0, 19) + "Z" : cleanText(t.posted_at, 30),
        summary: cleanText(t.summary, LIMITS.summary),
        tags: (Array.isArray(t.tags) ? t.tags : []).map((x) => cleanText(x, LIMITS.tag)).filter(Boolean),
        collected_at: cleanText(t.collected_at, 30),
      });
    }
  }
  return [...byId.values()].sort((a, b) => toTime(b.posted_at) - toTime(a.posted_at)).slice(0, limit);
}

function toTime(s: string): number {
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  const AT = "2026-11-02T18:00:00Z";
  // snowflake ids posted 2026-11-02 (from real X ids)
  const ID1 = "2117225955919815042"; // 2026-11-02T12:02:58Z
  const ID2 = "2117239507263132056"; // 2026-11-02T12:56:49Z
  const OLD = "1000000000000000000"; // 2018
  const opts = { collectedAt: AT, notBefore: Date.parse("2026-11-01T00:00:00Z"), maxItems: 15 };
  const base = {
    title: "t",
    author: "Name (@foo)",
    posted_at: "2099-01-01T00:00:00Z",
    summary: "s",
    tags: ["x"],
  };

  describe("parseStatusUrl", () => {
    it("accepts canonical forms", () => {
      expect(parseStatusUrl("https://x.com/foo/status/123")).toEqual({ handle: "foo", id: "123" });
      expect(parseStatusUrl("https://twitter.com/foo/status/123?s=20")).toEqual({ handle: "foo", id: "123" });
      expect(parseStatusUrl("https://x.com/i/status/123")).toEqual({ id: "123" });
      expect(parseStatusUrl("https://x.com/i/web/status/123")).toEqual({ id: "123" });
    });
    it("rejects other hosts, schemes and lookalikes", () => {
      for (const u of [
        "http://x.com/foo/status/1",
        "https://evilx.com/foo/status/1",
        "https://x.com.evil.com/foo/status/1",
        "https://x.com@evil.com/foo/status/1",
        "https://user@x.com/foo/status/1",
        "javascript:alert(1)//x.com/foo/status/1",
        "https://x.com/foo/status/1/photo/1",
        "https://x.com/foo/bar/status/1",
        "https://x.com/foo/status/abc",
        42,
      ]) {
        expect(parseStatusUrl(u), String(u)).toBeUndefined();
      }
    });
  });

  describe("snowflakeTime", () => {
    it("decodes posting time", () => {
      expect(snowflakeTime(ID1)?.toISOString().slice(0, 19)).toBe("2026-11-02T12:02:58");
      expect(snowflakeTime("20")).toBeUndefined();
    });
  });

  describe("cleanText", () => {
    it("strips XML-invalid and bidi controls and caps length", () => {
      expect(cleanText("a\u0001b\u202Ec\u0007 ", 10)).toBe("abc");
      expect(cleanText("あいうえおかきくけこ", 5)).toBe("あいうえ…");
      expect(cleanText(123, 5)).toBe("");
    });
  });

  describe("citedStatuses", () => {
    it("reads only structured citation fields", () => {
      const resp = {
        citations: [`https://x.com/i/status/${ID1}`, "https://x.ai/news", 7],
        output: [
          { type: "reasoning", summary: "https://x.com/r/status/9" },
          { type: "custom_tool_call", output: "see https://x.com/b/status/2" },
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "https://x.com/fake/status/999",
                annotations: [{ url: `https://x.com/Foo/status/${ID2}` }],
              },
            ],
          },
        ],
      };
      expect([...citedStatuses(resp)]).toEqual([
        [ID1, undefined],
        [ID2, "foo"],
      ]);
    });
  });

  describe("normalizeItems", () => {
    it("fails closed when nothing was cited", () => {
      const r = normalizeItems(
        { items: [{ ...base, url: `https://x.com/foo/status/${ID1}` }] },
        new Map(),
        opts,
      );
      expect(r.items).toEqual([]);
      expect(r.rejected).toEqual([{ reason: "not_cited", id: ID1, posted_at: "2026-11-02T12:02:58Z" }]);
    });

    it("keeps cited items, rebuilds url, takes time from the id and marks unverified authors", () => {
      const { items, dropped } = normalizeItems(
        { items: [{ ...base, url: `https://twitter.com/foo/status/${ID1}?s=20` }] },
        new Map([[ID1, undefined]]),
        opts,
      );
      expect(dropped).toBe(0);
      expect(items[0]).toMatchObject({
        id: ID1,
        url: `https://x.com/i/status/${ID1}`,
        posted_at: "2026-11-02T12:02:58Z",
        author: "Name (@foo) ※投稿者未検証",
      });
    });

    it("uses the cited handle and rejects a mismatching one", () => {
      const cited = new Map<string, string | undefined>([
        [ID1, "realacct"],
        [ID2, "foo"],
      ]);
      const { items, dropped } = normalizeItems(
        {
          items: [
            { ...base, author: "CISA (@CISAgov)", url: `https://x.com/CISAgov/status/${ID1}` },
            { ...base, url: `https://x.com/FOO/status/${ID2}` },
          ],
        },
        cited,
        opts,
      );
      expect(dropped).toBe(1);
      expect(items.map((i) => [i.id, i.author])).toEqual([[ID2, "Name (@foo)"]]);
    });

    it("drops non-status, uncited, duplicate, out-of-range and over-limit items", () => {
      const cited = new Map<string, string | undefined>([
        [ID1, undefined],
        [ID2, undefined],
        [OLD, undefined],
      ]);
      const { items, dropped, rejected } = normalizeItems(
        {
          items: [
            { ...base, url: "https://example.com/post" },
            { ...base, url: "https://x.com/foo/status/2117225955919815999" },
            { ...base, url: `https://x.com/foo/status/${OLD}` },
            { ...base, url: `https://x.com/foo/status/${ID1}` },
            { ...base, url: `https://x.com/bar/status/${ID1}` },
            { ...base, url: `https://x.com/foo/status/${ID2}` },
          ],
        },
        cited,
        { ...opts, maxItems: 1 },
      );
      expect(items.map((i) => i.id)).toEqual([ID1]);
      expect(dropped).toBe(5);
      expect(rejected.map((r) => r.reason)).toEqual([
        "bad_url",
        "not_cited",
        "before_window",
        "duplicate",
        "over_limit",
      ]);
    });

    it("enforces notAfter and skips excluded ids without counting them", () => {
      const cited = new Map<string, string | undefined>([
        [ID1, undefined],
        [ID2, undefined],
      ]);
      const { items, dropped } = normalizeItems(
        {
          items: [
            { ...base, url: `https://x.com/foo/status/${ID1}` },
            { ...base, url: `https://x.com/foo/status/${ID2}` },
          ],
        },
        cited,
        { ...opts, notAfter: Date.parse("2026-11-02T12:30:00Z"), exclude: new Set([ID1]) },
      );
      expect(items).toEqual([]);
      expect(dropped).toBe(1);
    });

    it("caps field sizes", () => {
      const { items } = normalizeItems(
        {
          items: [
            {
              ...base,
              title: "x".repeat(500),
              summary: "y".repeat(5000),
              tags: Array.from({ length: 50 }, () => "z".repeat(100)),
              url: `https://x.com/foo/status/${ID1}`,
            },
          ],
        },
        new Map([[ID1, undefined]]),
        opts,
      );
      expect(Array.from(items[0]!.title).length).toBe(LIMITS.title);
      expect(Array.from(items[0]!.summary).length).toBe(LIMITS.summary);
      expect(items[0]!.tags).toHaveLength(LIMITS.tags);
    });

    it("throws when items is missing", () => {
      expect(() => normalizeItems({}, new Map(), opts)).toThrow();
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
    const t = (id: string): Topic => ({
      id,
      posted_at: "2099-01-01T00:00:00Z",
      title: id,
      url: "javascript:alert(1)",
      author: "u",
      summary: "",
      tags: [],
      collected_at: AT,
    });
    it("dedupes (first wins), sorts by snowflake time, rebuilds links, drops bad ids and caps", () => {
      const merged = mergeTopics(
        [
          [t(ID1), t("../etc")],
          [{ ...t(ID1), title: "old" }, t(ID2), t(OLD)],
        ],
        2,
      );
      expect(merged.map((m) => [m.id, m.title, m.url])).toEqual([
        [ID2, ID2, `https://x.com/i/status/${ID2}`],
        [ID1, ID1, `https://x.com/i/status/${ID1}`],
      ]);
    });
  });
}
