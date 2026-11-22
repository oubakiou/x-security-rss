import type { FetchJson } from "./oembed.ts";

export const ZERO_WIRE_FEED_URL = "https://radar.cloudflare.com/zero-wire/feed?format=json";
const ZERO_WIRE_BASE = "https://radar.cloudflare.com/zero-wire/";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CVE_RE = /^CVE-\d{4}-\d{4,7}$/i;
const MAX_BRIEFINGS = 500;
const MAX_CVES_PER_BRIEFING = 200;
const MAX_SLUG_LENGTH = 120;

/** CVE id (upper case) → slugs of the briefings that cover it, in feed order (newest first). */
export type ZeroWireIndex = ReadonlyMap<string, readonly string[]>;

/**
 * The feed is third-party data: only a slug of a fixed shape and CVE ids of a fixed shape are kept,
 * so nothing from it but those reaches a URL or the page.
 */
export function parseZeroWireFeed(raw: unknown): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const items = (raw as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(items)) throw new Error("Zero Wire feed has no items");
  for (const item of items.slice(0, MAX_BRIEFINGS)) {
    const ext = (item as { _zero_wire?: { slug?: unknown; cves?: unknown } } | undefined)?._zero_wire;
    const slug = ext?.slug;
    if (typeof slug !== "string" || slug.length > MAX_SLUG_LENGTH || !SLUG_RE.test(slug)) continue;
    if (!Array.isArray(ext?.cves)) continue;
    for (const c of ext.cves.slice(0, MAX_CVES_PER_BRIEFING)) {
      if (typeof c !== "string" || !CVE_RE.test(c)) continue;
      const id = c.toUpperCase();
      const slugs = index.get(id) ?? [];
      if (!slugs.includes(slug)) slugs.push(slug);
      index.set(id, slugs);
    }
  }
  return index;
}

export function zeroWireUrl(slug: string): string {
  return `${ZERO_WIRE_BASE}${slug}`;
}

/** Briefings for any of the given CVE ids, without duplicates, in the order the ids are given. */
export function briefingsFor(cves: Iterable<string>, index: ZeroWireIndex | undefined, max = 3): string[] {
  if (!index) return [];
  const out: string[] = [];
  for (const c of cves) {
    for (const slug of index.get(c.toUpperCase()) ?? []) {
      if (!out.includes(slug)) out.push(slug);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** Links are an extra, so a failed fetch yields an empty index instead of failing the build. */
export async function loadZeroWireIndex(
  fetchJson: FetchJson,
): Promise<{ index: Map<string, string[]>; error?: string }> {
  try {
    const res = await fetchJson(ZERO_WIRE_FEED_URL);
    if (!res.ok) return { index: new Map(), error: `HTTP ${res.status}` };
    return { index: parseZeroWireFeed(await res.json()) };
  } catch (e) {
    return { index: new Map(), error: e instanceof Error ? e.message : String(e) };
  }
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  const feed = (items: unknown[]) => ({ version: "https://jsonfeed.org/version/1.1", items });
  const brief = (slug: unknown, cves: unknown) => ({ id: "x", _zero_wire: { slug, cves } });

  describe("parseZeroWireFeed", () => {
    it("maps each CVE to the briefings that cover it, newest first", () => {
      const index = parseZeroWireFeed(
        feed([
          brief("php-november-2026-security-release-phpaftershell", ["CVE-2026-126714", "cve-2026-115560"]),
          brief("php2shell", ["CVE-2026-109618", "CVE-2026-115560"]),
        ]),
      );
      expect(index.get("CVE-2026-126714")).toEqual(["php-november-2026-security-release-phpaftershell"]);
      expect(index.get("CVE-2026-115560")).toEqual([
        "php-november-2026-security-release-phpaftershell",
        "php2shell",
      ]);
    });

    it("drops slugs and CVE ids that do not have the expected shape", () => {
      const index = parseZeroWireFeed(
        feed([
          brief("../evil", ["CVE-2026-1111"]),
          brief("https://evil.example/x", ["CVE-2026-2222"]),
          brief("Upper-Case", ["CVE-2026-3333"]),
          brief("a".repeat(121), ["CVE-2026-4444"]),
          brief("ok-slug", ["CVE-2026-5555", "CVE-2026-1", "<script>", 42, "CVE-2026-5555 x"]),
          brief("no-cves", "CVE-2026-6666"),
          { id: "no-ext" },
          null,
        ]),
      );
      expect([...index.entries()]).toEqual([["CVE-2026-5555", ["ok-slug"]]]);
    });

    it("rejects a feed without items", () => {
      expect(() => parseZeroWireFeed({})).toThrow();
      expect(() => parseZeroWireFeed(null)).toThrow();
    });
  });

  describe("briefingsFor", () => {
    const index = new Map([
      ["CVE-2026-1111", ["a", "b"]],
      ["CVE-2026-2222", ["b", "c"]],
      ["CVE-2026-3333", ["d"]],
    ]);

    it("dedupes across CVEs, keeps order and caps the count", () => {
      expect(briefingsFor(["cve-2026-1111", "CVE-2026-2222"], index)).toEqual(["a", "b", "c"]);
      expect(briefingsFor(["CVE-2026-1111", "CVE-2026-2222", "CVE-2026-3333"], index, 3)).toEqual([
        "a",
        "b",
        "c",
      ]);
      expect(briefingsFor(["CVE-2026-9999"], index)).toEqual([]);
      expect(briefingsFor(["CVE-2026-1111"], undefined)).toEqual([]);
    });
  });

  describe("loadZeroWireIndex", () => {
    it("returns an empty index with the reason when the fetch fails", async () => {
      const notFound = await loadZeroWireIndex(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      }));
      expect(notFound.index.size).toBe(0);
      expect(notFound.error).toBe("HTTP 503");
      const thrown = await loadZeroWireIndex(async () => {
        throw new Error("timeout");
      });
      expect(thrown.error).toBe("timeout");
      const bad = await loadZeroWireIndex(async () => ({ ok: true, status: 200, json: async () => "x" }));
      expect(bad.index.size).toBe(0);
      expect(bad.error).toBeDefined();
    });

    it("builds the index from a good response", async () => {
      const res = await loadZeroWireIndex(async () => ({
        ok: true,
        status: 200,
        json: async () => feed([brief("sshole", ["CVE-2026-123158"])]),
      }));
      expect(res.error).toBeUndefined();
      expect(res.index.get("CVE-2026-123158")).toEqual(["sshole"]);
      expect(zeroWireUrl("sshole")).toBe("https://radar.cloudflare.com/zero-wire/sshole");
    });
  });
}
