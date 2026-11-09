import { cleanText, HANDLE_RE, LIMITS } from "./items.ts";
import type { Topic } from "./types.ts";

/**
 * x_search citations are bare /i/status/<id> links, so the handle in an item comes from the model's
 * answer. X's public oEmbed endpoint (no auth) returns the real author, which is used instead.
 */
const OEMBED_URL = "https://publish.x.com/oembed";
const X_HOSTS = new Set(["x.com", "twitter.com"]);

export interface OembedAuthor {
  handle: string;
  name: string;
  /** post text from the embed HTML, used only for comparison and never rendered */
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** First <p> of the embed's blockquote with tags removed and entities decoded. */
export function embedText(html: unknown): string {
  if (typeof html !== "string") return "";
  const p = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(html);
  if (!p) return "";
  return p[1]!
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      const code =
        e[0] === "#" ? (e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : NaN;
      if (!Number.isNaN(code)) return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      return ENTITIES[e.toLowerCase()] ?? m;
    });
}

const MIN_QUOTE = 8;

/** Letters and digits only, so spacing, punctuation, emoji and links do not decide the comparison. */
function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/(https?:\/\/|pic\.twitter\.com\/)\S+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** undefined when there is nothing to compare (no quote, or no text from X). */
export function quoteMatches(text: string, quote: string | undefined): boolean | undefined {
  const q = normalizeForMatch(quote ?? "");
  const t = normalizeForMatch(text);
  if (q.length < MIN_QUOTE || !t) return undefined;
  return t.includes(q);
}

/** Only author_url and author_name are read; the rest of the response (post HTML etc.) is ignored. */
export function parseOembedAuthor(body: unknown, id: string): OembedAuthor | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { url, author_url: authorUrl, author_name: authorName, html } = body as Record<string, unknown>;
  const author = typeof authorUrl === "string" ? URL.parse(authorUrl) : null;
  if (!author || author.protocol !== "https:" || !X_HOSTS.has(author.hostname)) return undefined;
  const parts = author.pathname.split("/").filter(Boolean);
  const handle = parts.length === 1 ? parts[0]! : "";
  if (!HANDLE_RE.test(handle)) return undefined;
  // The post URL must name the same status, so a response for another post is not attributed to this one.
  const post = typeof url === "string" ? URL.parse(url) : null;
  if (!post || !post.pathname.endsWith(`/status/${id}`)) return undefined;
  return { handle, name: cleanText(authorName, LIMITS.author), text: embedText(html) };
}

export type FetchJson = (
  url: string,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface VerifyResult {
  verified: number;
  corrected: number;
  failed: number;
  /** stopped early after a 429 */
  rateLimited: boolean;
  quoteMatched: number;
  /** ids whose quote was not found in the post text: the summary may describe another post */
  quoteMismatched: string[];
  quoteUnchecked: number;
}

/**
 * Sets author_handle (lowercase) and rewrites author from X's own data. Items that cannot be verified are
 * left as they are (no author_handle), so a failure only means no 🔖, never a wrong one.
 */
export async function verifyAuthors(items: Topic[], fetchJson: FetchJson): Promise<VerifyResult> {
  const result: VerifyResult = {
    verified: 0,
    corrected: 0,
    failed: 0,
    rateLimited: false,
    quoteMatched: 0,
    quoteMismatched: [],
    quoteUnchecked: 0,
  };
  for (const t of items) {
    if (result.rateLimited) {
      result.failed++;
      result.quoteUnchecked++;
      continue;
    }
    const target = `https://x.com/i/status/${t.id}`;
    try {
      const res = await fetchJson(`${OEMBED_URL}?url=${encodeURIComponent(target)}&omit_script=1`);
      if (res.status === 429) result.rateLimited = true;
      const author = res.ok ? parseOembedAuthor(await res.json(), t.id) : undefined;
      if (!author) {
        result.failed++;
        result.quoteUnchecked++;
        continue;
      }
      const shown = `${author.name || author.handle} (@${author.handle})`;
      if (shown !== t.author) result.corrected++;
      t.author = shown;
      t.author_handle = author.handle.toLowerCase();
      result.verified++;
      const match = quoteMatches(author.text, t.quote);
      if (match === undefined) result.quoteUnchecked++;
      else {
        t.quote_match = match;
        if (match) result.quoteMatched++;
        else result.quoteMismatched.push(t.id);
      }
    } catch {
      result.failed++;
      result.quoteUnchecked++;
    }
  }
  return result;
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;
  const ID = "2119581049021976723";
  const good = {
    url: `https://x.com/securityLab_jp/status/${ID}`,
    author_name: "セキュリティ対策Lab",
    author_url: "https://x.com/securityLab_jp",
    html: '<blockquote class="twitter-tweet"><p lang="ja" dir="ltr">米FBI・CISA、冷凍設備への攻撃を警告 &amp; 注意喚起<br> <a href="https://t.co/x">https://t.co/x</a></p>&mdash; セキュリティ対策Lab</blockquote>',
  };

  describe("parseOembedAuthor", () => {
    it("reads the handle from author_url and checks the status id", () => {
      expect(parseOembedAuthor(good, ID)).toEqual({
        handle: "securityLab_jp",
        name: "セキュリティ対策Lab",
        text: "米FBI・CISA、冷凍設備への攻撃を警告 & 注意喚起  https://t.co/x",
      });
      expect(
        parseOembedAuthor({ ...good, url: "https://x.com/securityLab_jp/status/1" }, ID),
      ).toBeUndefined();
    });

    it("rejects other hosts, paths and malformed values", () => {
      for (const author_url of [
        "https://evil.example/securityLab_jp",
        "http://x.com/securityLab_jp",
        "https://x.com/securityLab_jp/extra",
        "https://x.com/bad-handle",
        42,
      ]) {
        expect(parseOembedAuthor({ ...good, author_url }, ID)).toBeUndefined();
      }
      expect(parseOembedAuthor(null, ID)).toBeUndefined();
    });
  });

  describe("quoteMatches", () => {
    const text = "米FBI・CISA、冷凍設備への攻撃を警告 & 注意喚起 https://t.co/x";
    it("ignores spacing, punctuation, width and links", () => {
      expect(quoteMatches(text, "ＦＢＩ・ＣＩＳＡ 冷凍設備への攻撃を警告")).toBe(true);
      expect(quoteMatches(text, "ランサムウェアで病院のシステム停止")).toBe(false);
    });
    it("skips quotes that are too short or missing text", () => {
      expect(quoteMatches(text, "FBI")).toBeUndefined();
      expect(quoteMatches(text, undefined)).toBeUndefined();
      expect(quoteMatches("", "冷凍設備への攻撃を警告")).toBeUndefined();
    });
  });

  describe("verifyAuthors", () => {
    const topic = (id: string, author: string): Topic => ({
      id,
      title: "t",
      url: `https://x.com/i/status/${id}`,
      author,
      posted_at: "2026-11-09T00:00:00Z",
      summary: "",
      tags: [],
      collected_at: "2026-11-09T00:00:00Z",
    });
    const reply = (status: number, body?: unknown) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });

    it("corrects the author from X and records the handle", async () => {
      const items = [
        { ...topic(ID, "誤った名前 (@SomeoneElse)"), quote: "冷凍設備への攻撃を警告" },
        { ...topic(ID, "セキュリティ対策Lab (@securityLab_jp)"), quote: "まったく別の投稿の文章です" },
      ];
      const r = await verifyAuthors(items, async () => reply(200, good));
      expect(items[0]!.author).toBe("セキュリティ対策Lab (@securityLab_jp)");
      expect(items[0]!.author_handle).toBe("securitylab_jp");
      expect(items.map((t) => t.quote_match)).toEqual([true, false]);
      expect(r).toEqual({
        verified: 2,
        corrected: 1,
        failed: 0,
        rateLimited: false,
        quoteMatched: 1,
        quoteMismatched: [ID],
        quoteUnchecked: 0,
      });
    });

    it("leaves items unverified on errors and stops after a 429", async () => {
      const items = [topic("1", "a (@a)"), topic("2", "b (@b)"), topic("3", "c (@c)")];
      const calls: string[] = [];
      const r = await verifyAuthors(items, async (url) => {
        calls.push(url);
        if (url.includes("%2F1&")) return reply(404);
        if (url.includes("%2F2&")) return reply(429);
        throw new Error("network");
      });
      expect(calls).toHaveLength(2);
      expect(items.map((t) => [t.author, t.author_handle])).toEqual([
        ["a (@a)", undefined],
        ["b (@b)", undefined],
        ["c (@c)", undefined],
      ]);
      expect(r).toEqual({
        verified: 0,
        corrected: 0,
        failed: 3,
        rateLimited: true,
        quoteMatched: 0,
        quoteMismatched: [],
        quoteUnchecked: 3,
      });
    });
  });
}
