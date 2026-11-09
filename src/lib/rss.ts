import { failureNotice } from "./failure.ts";
import { topicCves } from "./items.ts";
import { groupByDay, jstTime, timelineHtml } from "./timeline.ts";
import { CATEGORIES, type Category, type Status, type Topic } from "./types.ts";

export interface FeedMeta {
  title: string;
  description: string;
  siteUrl: string;
  feedUrl: string;
  jsonFeedUrl: string;
  sourceUrl: string;
  /** lowercase handles shown as 優先アカウント */
  trustedHandles: ReadonlySet<string>;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Opens in a new tab on the site page; the mark and hidden text tell sighted and screen-reader users before they click. */
function externalLink(href: string, text: string): string {
  return `<a href="${escapeXml(href)}" target="_blank" rel="noopener noreferrer">${escapeXml(text)}<span aria-hidden="true"> ↗</span><span class="sr">(新しいタブで開く)</span></a>`;
}

const MAX_CVE_LINKS = 10;
const MAX_CVE_IN_TITLE = 2;

/** CVE ids come from the title and tags (model output) but are matched to a fixed pattern, so they are safe to put in a URL. */
function cveIds(t: Topic): string[] {
  return [...topicCves(t)].slice(0, MAX_CVE_LINKS);
}

const SEPARATORS = "\\s,、/／・:：\\-–—";

// Removing an id that a Japanese particle attaches to ("…のCVE-x", "CVE-xを…") would break the sentence.
const KEEP_BEFORE = /の$/;
const KEEP_AFTER = /^(?:[をがはにでのもとへや等]|など)/;

// Marks where an id was removed; titles never contain it because cleanText drops control characters.
const GAP = "\u0000";

/**
 * Drops the ids already shown in the prefix (with shorthand lists such as "CVE-2026-1/2") and the
 * separators or brackets they leave behind, unless that would break the sentence around them.
 * Only the text around a removed id is tidied, so the rest of the title stays as written.
 */
function stripCves(title: string, ids: readonly string[]): string {
  if (title.includes(GAP)) return title;
  const shown = new Set(ids);
  const removed = title.replace(
    /CVE-(\d{4})-(\d{4,7})((?:\s*[/／、,]\s*\d{4,7}(?!\d))*)/gi,
    (match: string, year: string, num: string, tail: string, offset: number, whole: string) => {
      const all = [num, ...(tail.match(/\d{4,7}/g) ?? [])].map((n) => `CVE-${year}-${n}`);
      const before = whole.slice(0, offset);
      const after = whole.slice(offset + match.length);
      const keep = !all.every((id) => shown.has(id)) || KEEP_BEFORE.test(before) || KEEP_AFTER.test(after);
      return keep ? match : GAP;
    },
  );
  if (!removed.includes(GAP)) return title;
  const tidy = removed
    .replace(new RegExp(`[(（[［]\\s*${GAP}[\\s${GAP}]*[)）\\]］]`, "g"), GAP)
    .replace(
      new RegExp(`[${SEPARATORS}]*${GAP}[${SEPARATORS}${GAP}]*`, "g"),
      (run, offset: number, whole: string) => {
        if (offset === 0 || offset + run.length === whole.length) return "";
        const marks = run.replace(new RegExp(`[\\s${GAP}]`, "g"), "");
        const space = /^\s/.test(run) ? " " : "";
        // Two or more separators around a gap are where the id sat in a list; keep only the first one.
        if (marks.length >= 2) return `${space}${marks[0]} `;
        return marks ? run.replaceAll(GAP, "").replace(/\s+/g, " ") : /\s/.test(run) ? " " : "";
      },
    );
  return tidy.trim();
}

const CATEGORY_EMOJI: Record<Category, string> = {
  vulnerability: "🔓",
  incident: "🔥",
  campaign: "🕵️",
  other: "📝",
};

const CATEGORY_LABEL: Record<Category, string> = {
  vulnerability: "脆弱性",
  incident: "インシデント",
  campaign: "攻撃キャンペーン",
  other: "その他",
};

/**
 * The page allows no scripts (CSP), so filtering is CSS only: each category has an empty anchor,
 * and while it is the URL fragment (e.g. #vulnerability) other articles are hidden. The fragment
 * doubles as the permalink.
 */
export const TRUSTED_MARK = "🔖";
export const TRUSTED_LABEL = "優先アカウント";

/**
 * Uses only the handle confirmed by the API's citation, not the one shown in `author`, which falls back to
 * the model's URL when the citation is an /i/status/ link. Items stored before author_handle existed get no mark.
 */
export function isTrusted(t: Topic, meta: FeedMeta): boolean {
  return !!t.author_handle && meta.trustedHandles.has(t.author_handle);
}

/**
 * For a trusted author: the mark first, then the name with only the handle linked to the profile.
 * The link uses the oEmbed-verified author_handle; the shown handle is used only if it matches it.
 */
function authorHtml(t: Topic, meta: FeedMeta, newTab: boolean): string {
  if (!isTrusted(t, meta)) return escapeXml(t.author);
  const m = /^(.*) \(@([A-Za-z0-9_]{1,15})\)$/.exec(t.author);
  const name = m && m[2]!.toLowerCase() === t.author_handle ? m[1]! : "";
  const handle = m && name ? m[2]! : t.author_handle!;
  const href = `https://x.com/${t.author_handle}`;
  const link = newTab
    ? externalLink(href, `@${handle}`)
    : `<a href="${escapeXml(href)}" rel="noopener noreferrer">@${escapeXml(handle)}</a>`;
  const mark = newTab
    ? `<span class="trusted-mark" title="${TRUSTED_LABEL}" aria-hidden="true">${TRUSTED_MARK}</span><span class="sr">(${TRUSTED_LABEL})</span>`
    : TRUSTED_MARK;
  return `${mark}${name ? `${escapeXml(name)} ` : ""}(${link})`;
}

function filterHtml(topics: Topic[], meta: FeedMeta): { nav: string; anchors: string; css: string } {
  const count = (c: Category) => topics.filter((t) => t.category === c).length;
  const links = CATEGORIES.map(
    (c) => `<a href="#${c}">${CATEGORY_EMOJI[c]} ${CATEGORY_LABEL[c]} (${count(c)})</a>`,
  );
  const trusted = topics.filter((t) => isTrusted(t, meta)).length;
  links.push(`<a href="#trusted">${TRUSTED_MARK} ${TRUSTED_LABEL} (${trusted})</a>`);
  const css = CATEGORIES.map(
    (c) =>
      `body:has(#${c}:target) article:not(.cat-${c}){display:none}` +
      `body:has(#${c}:target) .day:not(:has(.cat-${c})){display:none}` +
      `body:has(#${c}:target) .filters a[href="#${c}"]{font-weight:bold}`,
  )
    .concat(
      "body:has(#trusted:target) article:not(.trusted){display:none}" +
        "body:has(#trusted:target) .day:not(:has(.trusted)){display:none}" +
        'body:has(#trusted:target) .filters a[href="#trusted"]{font-weight:bold}',
    )
    .join("\n");
  return {
    nav: `<nav class="filters" aria-label="カテゴリーで絞り込み"><a href="#">すべて (${topics.length})</a> ${links.join(" ")}</nav>`,
    anchors: [...CATEGORIES, "trusted"].map((c) => `<span id="${c}" class="anchor"></span>`).join(""),
    css: `body:not(:has(.anchor:target)) .filters a[href="#"]{font-weight:bold}\n${css}`,
  };
}

function displayTitle(t: Topic): string {
  const title = titleWithCves(t);
  return t.category ? `${CATEGORY_EMOJI[t.category]} ${title}` : title;
}

function titleWithCves(t: Topic): string {
  const ids = cveIds(t);
  if (!ids.length) return t.title;
  const shown = ids.slice(0, MAX_CVE_IN_TITLE);
  const rest = ids.length - shown.length;
  const prefix = `[${shown.join(", ")}${rest > 0 ? ` ほか${rest}件` : ""}]`;
  const title = stripCves(t.title, shown);
  return title ? `${prefix} ${title}` : prefix;
}

function nvdUrl(id: string): string {
  return `https://nvd.nist.gov/vuln/detail/${id}`;
}

function cveHtml(t: Topic, newTab = false): string {
  const ids = cveIds(t);
  if (!ids.length) return "";
  const links = ids
    .map((id) =>
      newTab
        ? externalLink(nvdUrl(id), id)
        : `<a href="${escapeXml(nvdUrl(id))}" rel="noopener noreferrer">${escapeXml(id)}</a>`,
    )
    .join(" / ");
  return `<p class="cves">CVE: ${links}</p>`;
}

function relatedHtml(t: Topic, newTab = false): string {
  const ids = (t.related ?? []).filter((id) => /^\d{1,20}$/.test(id));
  if (!ids.length) return "";
  const links = ids
    .map((id, i) =>
      newTab
        ? externalLink(`https://x.com/i/status/${id}`, `関連投稿${i + 1}`)
        : `<a href="https://x.com/i/status/${id}" rel="noopener noreferrer">関連投稿${i + 1}</a>`,
    )
    .join(" / ");
  return `<p>同じCVEの関連投稿: ${links}</p>`;
}

function rfc822(iso: string): string {
  const d = new Date(iso);
  return (Number.isNaN(d.getTime()) ? new Date(0) : d).toUTCString();
}

export function statusAlert(status: Status | undefined, meta: FeedMeta): Topic | undefined {
  if (!status || status.ok) return undefined;
  const day = status.checked_at.slice(0, 10);
  const notice = failureNotice(status);
  return {
    id: `status-error-${day}`,
    title: `⚠️ ${notice.title} (${day})`,
    url: `${meta.siteUrl}#status`,
    author: "x-security-rss",
    posted_at: status.checked_at,
    summary: notice.body,
    tags: ["status"],
    collected_at: status.checked_at,
  };
}

function itemHtml(t: Topic, meta: FeedMeta): string {
  return (
    cveHtml(t) +
    `<p>${escapeXml(t.summary).replace(/\n/g, "<br/>")}</p>` +
    `<p>投稿者: ${authorHtml(t, meta, false)}</p>` +
    relatedHtml(t)
  );
}

/** JSON Feed 1.1 (https://www.jsonfeed.org/version/1.1/) with the same items and notice as the RSS feed. */
export function renderJsonFeed(topics: Topic[], meta: FeedMeta, status?: Status): string {
  const alert = statusAlert(status, meta);
  const all = alert ? [alert, ...topics] : topics;
  const feed = {
    version: "https://jsonfeed.org/version/1.1",
    title: meta.title,
    home_page_url: meta.siteUrl,
    feed_url: meta.jsonFeedUrl,
    description: meta.description,
    icon: `${meta.siteUrl}icon-512.png`,
    favicon: `${meta.siteUrl}favicon.svg`,
    language: "ja",
    items: all.map((t) => ({
      id: t.id,
      url: t.url,
      title: displayTitle(t),
      content_html: itemHtml(t, meta),
      summary: t.summary,
      date_published: t.posted_at,
      authors: [{ name: t.author }],
      tags: isTrusted(t, meta) ? [...t.tags, TRUSTED_LABEL] : t.tags,
      _x_security: { trusted_author: isTrusted(t, meta) },
    })),
  };
  return JSON.stringify(feed, null, 2) + "\n";
}

export function renderRss(topics: Topic[], meta: FeedMeta, status?: Status): string {
  const alert = statusAlert(status, meta);
  const all = alert ? [alert, ...topics] : topics;
  const lastBuild = status?.checked_at ?? new Date().toISOString();

  const items = all
    .map((t) => {
      const desc = itemHtml(t, meta);
      const cats = (isTrusted(t, meta) ? [...t.tags, TRUSTED_LABEL] : t.tags)
        .map((c) => `      <category>${escapeXml(c)}</category>`)
        .join("\n");
      return [
        "    <item>",
        `      <title>${escapeXml(displayTitle(t))}</title>`,
        `      <link>${escapeXml(t.url)}</link>`,
        `      <guid isPermaLink="false">${escapeXml(t.id)}</guid>`,
        `      <pubDate>${rfc822(t.posted_at)}</pubDate>`,
        `      <dc:creator>${escapeXml(t.author)}</dc:creator>`,
        `      <description><![CDATA[${desc.replace(/]]>/g, "]]]]><![CDATA[>")}]]></description>`,
        cats,
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(meta.title)}</title>
    <link>${escapeXml(meta.siteUrl)}</link>
    <description>${escapeXml(meta.description)}</description>
    <language>ja</language>
    <lastBuildDate>${rfc822(lastBuild)}</lastBuildDate>
    <atom:link href="${escapeXml(meta.feedUrl)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}

/** Link previews are built from the site's own metadata only, never from collected posts, so post text cannot dress up a shared card. */
function ogpHtml(meta: FeedMeta): string {
  const tags: [string, string, string][] = [
    ["property", "og:type", "website"],
    ["property", "og:site_name", meta.title],
    ["property", "og:title", meta.title],
    ["property", "og:description", meta.description],
    ["property", "og:url", meta.siteUrl],
    ["property", "og:locale", "ja_JP"],
    ["property", "og:image", `${meta.siteUrl}ogp.png`],
    ["property", "og:image:width", "1200"],
    ["property", "og:image:height", "630"],
    ["property", "og:image:alt", meta.title],
    ["name", "twitter:card", "summary_large_image"],
  ];
  return tags.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeXml(value)}">`).join("\n");
}

export function renderHtml(topics: Topic[], meta: FeedMeta, status?: Status): string {
  const alert = statusAlert(status, meta);
  const filter = filterHtml(topics, meta);
  const days = groupByDay(topics);
  const timeline = timelineHtml(days);
  const article = (t: Topic) => {
    const trusted = isTrusted(t, meta);
    const cls = [t.category ? `cat-${t.category}` : "", trusted ? "trusted" : ""].filter(Boolean).join(" ");
    return `<article${cls ? ` class="${cls}"` : ""}>
  <h2>${externalLink(t.url, displayTitle(t))}</h2>
  <p class="meta">${authorHtml(t, meta, true)} · <time datetime="${escapeXml(t.posted_at)}">${escapeXml(jstTime(t.posted_at))} JST</time></p>
  ${cveHtml(t, true)}
  <p>${escapeXml(t.summary)}</p>
  ${relatedHtml(t, true)}
  ${t.tags.length ? `<p class="tags">${t.tags.map((c) => `<span>${escapeXml(c)}</span>`).join(" ")}</p>` : ""}
</article>`;
  };
  const rows = days
    .map(
      (d) => `<details class="day day-${d.key}" open>
<summary>${d.label}<small>${d.topics.length}件</small></summary>
${d.topics.map(article).join("\n")}
</details>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>${escapeXml(meta.title)}</title>
<meta name="description" content="${escapeXml(meta.description)}">
${ogpHtml(meta)}
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="icon" href="icon-512.png" type="image/png" sizes="512x512">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="alternate" type="application/rss+xml" title="${escapeXml(meta.title)}" href="${escapeXml(meta.feedUrl)}">
<link rel="alternate" type="application/feed+json" title="${escapeXml(meta.title)}" href="${escapeXml(meta.jsonFeedUrl)}">
<style>
:root{color-scheme:light dark;--fg:#1a1a1a;--muted:#666;--bg:#fff;--line:#e5e5e5;--warn:#b45309;--bar:#c7d2fe;--bar-on:#4f46e5}
@media (prefers-color-scheme:dark){:root{--fg:#eee;--muted:#aaa;--bg:#141414;--line:#333;--warn:#f59e0b;--bar:#3730a3;--bar-on:#818cf8}}
body{margin:0 auto;max-width:760px;padding:24px 16px;font:16px/1.7 system-ui,sans-serif;color:var(--fg);background:var(--bg)}
a{color:inherit}h1{font-size:1.4rem}h2{font-size:1.05rem;margin:0 0 4px}
article{border-top:1px solid var(--line);padding:16px 0}.meta{color:var(--muted);font-size:.85rem;margin:0}
.tags span{display:inline-block;border:1px solid var(--line);border-radius:4px;padding:0 6px;margin:0 4px 4px 0;font-size:.8rem}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
#status{border:1px solid var(--warn);color:var(--warn);padding:12px;border-radius:6px;white-space:pre-wrap}
.filters{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:.9rem;margin:0 0 8px}.filters a{text-decoration:none}
.timeline{display:flex;align-items:flex-end;gap:6px;height:96px;border-bottom:1px solid var(--line);margin:8px 0 12px}
.timeline a{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;text-decoration:none;color:var(--muted);font-size:.7rem;line-height:1.3}
.timeline .bar{width:100%;background:var(--bar);border-radius:4px 4px 0 0}
.day-note{display:none;font-size:.85rem;color:var(--muted);margin:0 0 8px}
details.day{border-top:1px solid var(--line)}summary{cursor:pointer;padding:10px 0;font-weight:bold}summary small{color:var(--muted);font-weight:normal;margin-left:8px}
${filter.css}
${timeline.css}
</style>
</head>
<body>
${filter.anchors}${timeline.anchors}
<h1>${escapeXml(meta.title)}</h1>
<p>${escapeXml(meta.description)} — <a href="${escapeXml(meta.feedUrl)}">RSS</a> · <a href="${escapeXml(meta.jsonFeedUrl)}">JSON Feed</a> · ${externalLink(meta.sourceUrl, "GitHub")}</p>
${alert ? `<p id="status">${escapeXml(alert.title)}\n${escapeXml(alert.summary)}</p>` : ""}
${filter.nav}
${timeline.bars}
${timeline.notes}
${rows || "<p>まだ記事がありません。</p>"}
</body>
</html>
`;
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  const meta: FeedMeta = {
    title: "T",
    description: "D",
    siteUrl: "https://example.github.io/r/",
    feedUrl: "https://example.github.io/r/feed.xml",
    jsonFeedUrl: "https://example.github.io/r/feed.json",
    sourceUrl: "https://github.com/o/r",
    trustedHandles: new Set(["trusted_a"]),
  };
  const topic: Topic = {
    id: "123",
    title: "A & B <script>",
    url: "https://x.com/u/status/123",
    author: "U (@u)",
    posted_at: "2026-11-02T12:00:00Z",
    summary: "line1\nline2 ]]> end",
    tags: ["CVE-2026-1", "Linux"],
    collected_at: "2026-11-02T13:00:00Z",
  };

  describe("escapeXml", () => {
    it("escapes the five XML entities", () => {
      expect(escapeXml(`<a href="x">'&'</a>`)).toBe(
        "&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;",
      );
    });
  });

  describe("renderRss", () => {
    it("renders a valid-looking RSS 2.0 item", () => {
      const xml = renderRss([topic], meta, { ok: true, message: "", checked_at: "2026-11-02T13:00:00Z" });
      expect(xml).toContain('<rss version="2.0"');
      expect(xml).toContain("<title>A &amp; B &lt;script&gt;</title>");
      expect(xml).toContain('<guid isPermaLink="false">123</guid>');
      expect(xml).toContain("<pubDate>Mon, 02 Nov 2026 12:00:00 GMT</pubDate>");
      expect(xml).toContain("<category>CVE-2026-1</category>");
      expect(xml).not.toContain("]]> end");
      expect(xml).not.toContain("収集に失敗");
    });

    it("prepends an alert item with the fixed notice for the failure kind", () => {
      const xml = renderRss([topic], meta, {
        ok: false,
        message: "xAI API エラー HTTP 401 raw <detail>",
        checked_at: "2026-11-03T21:00:00Z",
        kind: "auth",
        http_status: 401,
      });
      const first = xml.indexOf("<item>");
      expect(xml.slice(first, first + 200)).toContain("⚠️ xAI API キーが無効です (2026-11-03)");
      expect(xml).toContain("status-error-2026-11-03");
      expect(xml).toContain("キーを再発行");
      expect(xml).toContain("(HTTP 401)");
      expect(xml).not.toContain("raw &lt;detail&gt;");
    });

    it("does not suggest key or credit problems for other failures", () => {
      const xml = renderRss([topic], meta, {
        ok: false,
        message: "",
        checked_at: "2026-11-07T01:32:09Z",
        kind: "tool_outage",
        partial: true,
        failed_calls: 8,
      });
      expect(xml).toContain("⚠️ 一部の検索に失敗しました: X 検索ツールが利用できませんでした (2026-11-07)");
      expect(xml).toContain("ツール呼び出し 8 回がすべて失敗");
      expect(xml).not.toContain("console.x.ai");
    });
  });

  describe("trusted author mark", () => {
    const trusted = { ...topic, id: "200", author: "T (@Trusted_A)", author_handle: "trusted_a" };
    const unconfirmed = { ...topic, id: "201", author: "X (@Trusted_A)" };

    it("trusts only a citation-confirmed handle, never the author text", () => {
      expect(isTrusted(trusted, meta)).toBe(true);
      expect(isTrusted(unconfirmed, meta)).toBe(false);
      expect(isTrusted(topic, meta)).toBe(false);
    });

    it("marks the author and adds a CSS-only filter in HTML", () => {
      const html = renderHtml([trusted, topic], meta);
      expect(html).toContain('<article class="trusted">');
      expect(html).toContain(
        `<span class="trusted-mark" title="優先アカウント" aria-hidden="true">🔖</span><span class="sr">(優先アカウント)</span>T (<a href="https://x.com/trusted_a" target="_blank" rel="noopener noreferrer">@Trusted_A<span aria-hidden="true"> ↗</span><span class="sr">(新しいタブで開く)</span></a>)`,
      );
      expect(html).toContain('<a href="#trusted">🔖 優先アカウント (1)</a>');
      expect(html).toContain('<span id="trusted" class="anchor"></span>');
      expect(html).toContain("body:has(#trusted:target) article:not(.trusted){display:none}");
      expect(html.match(/trusted-mark/g)).toHaveLength(1);
    });

    it("adds the mark, a category and a flag in the feeds", () => {
      const rss = renderRss([trusted, topic], meta);
      expect(rss).toContain(
        '投稿者: 🔖T (<a href="https://x.com/trusted_a" rel="noopener noreferrer">@Trusted_A</a>)',
      );
      expect(rss).toContain("投稿者: U (@u)</p>");
      expect(rss.match(/<category>優先アカウント<\/category>/g)).toHaveLength(1);
      const feed = JSON.parse(renderJsonFeed([trusted, topic], meta));
      expect(feed.items[0].tags).toContain("優先アカウント");
      expect(feed.items[0]._x_security).toEqual({ trusted_author: true });
      expect(feed.items[1].tags).not.toContain("優先アカウント");
      expect(feed.items[1]._x_security).toEqual({ trusted_author: false });
    });
  });

  describe("renderJsonFeed", () => {
    it("emits a JSON Feed 1.1 with the same items and the failure notice first", () => {
      const json = renderJsonFeed([{ ...topic, related: ["456", "javascript:x"] }], meta, {
        ok: false,
        message: "x",
        checked_at: "2026-11-03T21:00:00Z",
      });
      const feed = JSON.parse(json);
      expect(feed.version).toBe("https://jsonfeed.org/version/1.1");
      expect(feed.feed_url).toBe("https://example.github.io/r/feed.json");
      expect(feed.home_page_url).toBe("https://example.github.io/r/");
      expect(feed.items).toHaveLength(2);
      expect(feed.items[0].id).toBe("status-error-2026-11-03");
      const item = feed.items[1];
      expect(item).toMatchObject({
        id: "123",
        url: "https://x.com/u/status/123",
        date_published: "2026-11-02T12:00:00Z",
        summary: "line1\nline2 ]]> end",
        authors: [{ name: "U (@u)" }],
        tags: ["CVE-2026-1", "Linux"],
      });
      expect(item.title).toContain("A & B <script>");
      expect(item.content_html).toContain("line1<br/>line2 ]]&gt; end");
      expect(item.content_html).toContain("https://x.com/i/status/456");
      expect(item.content_html).not.toContain("javascript:x");
    });
  });

  describe("related posts", () => {
    it("renders related links and skips non-numeric ids", () => {
      const xml = renderRss([{ ...topic, related: ["456", "javascript:x"] }], meta);
      expect(xml).toContain("https://x.com/i/status/456");
      expect(xml).not.toContain("javascript:x");
      expect(renderHtml([{ ...topic, related: ["456"] }], meta)).toContain("関連投稿1");
    });
  });

  describe("category emoji", () => {
    it("prefixes the title with the category emoji before the CVE prefix", () => {
      const vuln = {
        ...topic,
        title: "GitLab RCE CVE-2026-1111",
        tags: [],
        category: "vulnerability" as const,
      };
      expect(renderRss([vuln], meta)).toContain("<title>🔓 [CVE-2026-1111] GitLab RCE</title>");
      expect(renderHtml([{ ...topic, category: "campaign" }], meta)).toContain(
        ">🕵️ A &amp; B &lt;script&gt;<span",
      );
      expect(renderRss([{ ...topic, category: "incident" }], meta)).toContain("<title>🔥 A &amp; B");
      expect(renderRss([{ ...topic, category: "other" }], meta)).toContain("<title>📝 A &amp; B");
    });

    it("adds nothing without a category, including the failure notice", () => {
      const xml = renderRss([topic], meta, { ok: false, message: "", checked_at: "2026-11-03T21:00:00Z" });
      expect(xml).toContain("<title>A &amp; B &lt;script&gt;</title>");
      expect(xml).toContain("<title>⚠️ 収集に失敗しました (2026-11-03)</title>");
    });
  });

  describe("category filter", () => {
    it("offers fragment links per category with counts and tags articles", () => {
      const html = renderHtml(
        [
          { ...topic, id: "1", category: "vulnerability" },
          { ...topic, id: "2", category: "incident" },
          { ...topic, id: "3", category: "vulnerability" },
          { ...topic, id: "4" },
        ],
        meta,
      );
      expect(html).toContain('<a href="#">すべて (4)</a>');
      expect(html).toContain('<a href="#vulnerability">🔓 脆弱性 (2)</a>');
      expect(html).toContain('<a href="#incident">🔥 インシデント (1)</a>');
      expect(html).toContain('<a href="#campaign">🕵️ 攻撃キャンペーン (0)</a>');
      expect(html).toContain('<span id="vulnerability" class="anchor"></span>');
      expect(html.match(/<article class="cat-vulnerability">/g)).toHaveLength(2);
      expect(html).toContain("<article>\n");
      expect(html).toContain("body:has(#vulnerability:target) article:not(.cat-vulnerability){display:none}");
    });

    it("groups articles under open JST day sections with a timeline", () => {
      const html = renderHtml(
        [
          { ...topic, id: "1", posted_at: "2026-11-07T16:30:00Z", category: "incident" },
          { ...topic, id: "2", posted_at: "2026-11-07T10:00:00Z" },
        ],
        meta,
      );
      expect(html).toContain(
        '<details class="day day-2026-11-08" open>\n<summary>11月8日 (日)<small>1件</small></summary>',
      );
      expect(html).toContain('<details class="day day-2026-11-07" open>');
      expect(html).toContain(">01:30 JST</time>");
      expect(html).toContain('<nav class="timeline" aria-label="日付で絞り込み">');
      expect(html).toContain("body:has(#incident:target) .day:not(:has(.cat-incident)){display:none}");
      expect(html.indexOf('id="d2026-11-08"')).toBeLessThan(html.indexOf("<h1>"));
    });

    it("keeps the CSP free of scripts", () => {
      const html = renderHtml([{ ...topic, category: "other" }], meta);
      expect(html).toContain("default-src 'none'; style-src 'unsafe-inline'; img-src 'self';");
      expect(html).not.toMatch(/<script|onclick=|javascript:/i);
    });
  });

  describe("CVE links", () => {
    const cveTopic: Topic = {
      ...topic,
      title: "GitLab RCE cve-2026-1111",
      tags: ["CVE-2026-2222", "CVE-2026-1111"],
    };

    it("prefixes the title and links each CVE to NVD in the feed", () => {
      const xml = renderRss([cveTopic], meta);
      expect(xml).toContain("<title>[CVE-2026-1111, CVE-2026-2222] GitLab RCE</title>");
      const desc = xml.slice(xml.indexOf("<![CDATA["));
      expect(
        desc.startsWith(
          '<![CDATA[<p class="cves">CVE: <a href="https://nvd.nist.gov/vuln/detail/CVE-2026-1111"',
        ),
      ).toBe(true);
      expect(desc).toContain('href="https://nvd.nist.gov/vuln/detail/CVE-2026-2222"');
    });

    it("prefixes the title and puts NVD links before the summary on the page", () => {
      const html = renderHtml([cveTopic], meta);
      expect(html).toContain("[CVE-2026-1111, CVE-2026-2222] GitLab RCE<span");
      const article = html.slice(html.indexOf("<article>"));
      const links = article.indexOf(
        '<p class="cves">CVE: <a href="https://nvd.nist.gov/vuln/detail/CVE-2026-1111" target="_blank"',
      );
      expect(links).toBeGreaterThan(0);
      expect(links).toBeLessThan(article.indexOf("line1"));
    });

    it("does not repeat the prefixed CVE ids in the title text", () => {
      const title = (t: string, tags: string[] = []) =>
        renderRss([{ ...topic, title: t, tags }], meta).match(/<item>\s*<title>(.*?)<\/title>/)?.[1];
      expect(title("CVE-2026-109469 Microsoft Entra Device Registration権限昇格")).toBe(
        "[CVE-2026-109469] Microsoft Entra Device Registration権限昇格",
      );
      expect(title("Zyxel GS1900スイッチ CVE-2026-107441ゼロデイ悪用")).toBe(
        "[CVE-2026-107441] Zyxel GS1900スイッチ ゼロデイ悪用",
      );
      expect(title("Debian/UbuntuのAPT脆弱性CVE-2026-109518、MitMでroot権限取得可能")).toBe(
        "[CVE-2026-109518] Debian/UbuntuのAPT脆弱性、MitMでroot権限取得可能",
      );
      expect(title("Xen脱出脆弱性、11年ぶり発見（CVE-2026-102703/102704）", ["CVE-2026-102704"])).toBe(
        "[CVE-2026-102703, CVE-2026-102704] Xen脱出脆弱性、11年ぶり発見",
      );
      expect(title("GitLab KEV CVE-2026-97229/CVE-2026-110264")).toBe(
        "[CVE-2026-97229, CVE-2026-110264] GitLab KEV",
      );
      expect(title("Chrome (CVE-2026-5555) 修正")).toBe("[CVE-2026-5555] Chrome 修正");
      expect(title("CVE-2026-5555")).toBe("[CVE-2026-5555]");
      expect(title("A: CVE-2026-1001, CVE-2026-1002, CVE-2026-1003")).toBe(
        "[CVE-2026-1001, CVE-2026-1002 ほか1件] A: CVE-2026-1003",
      );
    });

    it("keeps an id that a Japanese particle attaches to, and leaves other text alone", () => {
      const title = (t: string) =>
        renderRss([{ ...topic, title: t, tags: [] }], meta).match(/<item>\s*<title>(.*?)<\/title>/)?.[1];
      expect(title("OpenSSHのCVE-2026-123158が開示数時間で悪用")).toBe(
        "[CVE-2026-123158] OpenSSHのCVE-2026-123158が開示数時間で悪用",
      );
      expect(title("Apple脆弱性CVE-2024-27834が悪用確認")).toBe(
        "[CVE-2024-27834] Apple脆弱性CVE-2024-27834が悪用確認",
      );
      expect(title("Ivanti ゼロデイ連鎖 CVE-2026-104935等")).toBe(
        "[CVE-2026-104935] Ivanti ゼロデイ連鎖 CVE-2026-104935等",
      );
      expect(title("Fortinet - CVE-2026-7777 - 修正")).toBe("[CVE-2026-7777] Fortinet - 修正");
    });

    it("leaves separators away from removed ids untouched", () => {
      const title = (t: string, tags: string[]) =>
        renderRss([{ ...topic, title: t, tags }], meta).match(/<item>\s*<title>(.*?)<\/title>/)?.[1];
      expect(title("curl --proxy の認証情報漏洩", ["CVE-2026-1234"])).toBe(
        "[CVE-2026-1234] curl --proxy の認証情報漏洩",
      );
      expect(title("https://example.org の脆弱性 CVE-2026-1234", [])).toBe(
        "[CVE-2026-1234] https://example.org の脆弱性",
      );
      expect(title("A -- B (x) CVE-2026-1234", [])).toBe("[CVE-2026-1234] A -- B (x)");
    });

    it("shortens long CVE lists in the title and leaves CVE-less topics alone", () => {
      const many = { ...topic, tags: ["CVE-2026-1001", "CVE-2026-1002", "CVE-2026-1003", "CVE-2026-1004"] };
      expect(renderRss([many], meta)).toContain(
        "<title>[CVE-2026-1001, CVE-2026-1002 ほか2件] A &amp; B &lt;script&gt;</title>",
      );
      const plain = renderRss([topic], meta);
      expect(plain).toContain("<title>A &amp; B &lt;script&gt;</title>");
      expect(plain).not.toContain("nvd.nist.gov");
    });
  });

  describe("renderHtml", () => {
    it("escapes content and links the feed", () => {
      const html = renderHtml([topic], meta);
      expect(html).toContain('type="application/rss+xml"');
      expect(html).toContain(
        '<a href="https://github.com/o/r" target="_blank" rel="noopener noreferrer">GitHub<span aria-hidden="true"> ↗</span><span class="sr">(新しいタブで開く)</span></a>',
      );
      expect(html).toContain("A &amp; B &lt;script&gt;");
      expect(html).not.toContain("<script>");
    });

    it("opens post links in a new tab with a visible and spoken notice, but not in the feed", () => {
      const t = { ...topic, related: ["456"] };
      const html = renderHtml([t], meta);
      expect(html).toContain(
        '<a href="https://x.com/u/status/123" target="_blank" rel="noopener noreferrer">A &amp; B &lt;script&gt;<span aria-hidden="true"> ↗</span><span class="sr">(新しいタブで開く)</span></a>',
      );
      expect(html).toContain(
        '<a href="https://x.com/i/status/456" target="_blank" rel="noopener noreferrer">関連投稿1',
      );
      expect(html).not.toMatch(/<a href="https:\/\/example\.github\.io\/r\/feed\.xml"[^>]*target=/);
      expect(renderRss([t], meta)).not.toContain("target=");
    });

    it("emits OGP tags from the site metadata only", () => {
      const html = renderHtml(
        [topic],
        { ...meta, title: `T "&" <x>` },
        {
          ok: false,
          message: "xAI API エラー HTTP 401",
          checked_at: "2026-11-03T21:00:00Z",
        },
      );
      expect(html).toContain('<meta property="og:title" content="T &quot;&amp;&quot; &lt;x&gt;">');
      expect(html).toContain('<meta property="og:description" content="D">');
      expect(html).toContain('<meta name="description" content="D">');
      expect(html).toContain('<meta property="og:url" content="https://example.github.io/r/">');
      expect(html).toContain('<meta property="og:type" content="website">');
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
      expect(html).toContain('<meta property="og:image" content="https://example.github.io/r/ogp.png">');
      expect(html).toContain('<link rel="icon" href="favicon.svg" type="image/svg+xml">');
      const head = html.slice(0, html.indexOf("</head>"));
      expect(head).not.toContain("A &amp; B");
      expect(head).not.toContain("HTTP 401");
    });
  });
}
