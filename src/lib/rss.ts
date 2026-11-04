import type { Status, Topic } from "./types.ts";

export interface FeedMeta {
  title: string;
  description: string;
  siteUrl: string;
  feedUrl: string;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function relatedHtml(t: Topic): string {
  const ids = (t.related ?? []).filter((id) => /^\d{1,20}$/.test(id));
  if (!ids.length) return "";
  const links = ids
    .map((id, i) => `<a href="https://x.com/i/status/${id}" rel="noopener noreferrer">関連投稿${i + 1}</a>`)
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
  return {
    id: `status-error-${day}`,
    title: `⚠️ 収集に失敗しました (${day})`,
    url: `${meta.siteUrl}#status`,
    author: "x-security-rss",
    posted_at: status.checked_at,
    summary:
      `${status.message}\n\n` +
      "GitHub Actions の実行ログを確認してください。APIキーの失効やクレジット不足の場合は、" +
      "console.x.ai でキーの再発行・チャージを行い、リポジトリの Secrets (XAI_API_KEY) を更新してください。",
    tags: ["status"],
    collected_at: status.checked_at,
  };
}

export function renderRss(topics: Topic[], meta: FeedMeta, status?: Status): string {
  const alert = statusAlert(status, meta);
  const all = alert ? [alert, ...topics] : topics;
  const lastBuild = status?.checked_at ?? new Date().toISOString();

  const items = all
    .map((t) => {
      const desc =
        `<p>${escapeXml(t.summary).replace(/\n/g, "<br/>")}</p>` +
        `<p>投稿者: ${escapeXml(t.author)}</p>` +
        relatedHtml(t);
      const cats = t.tags.map((c) => `      <category>${escapeXml(c)}</category>`).join("\n");
      return [
        "    <item>",
        `      <title>${escapeXml(t.title)}</title>`,
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
    ["name", "twitter:card", "summary"],
  ];
  return tags.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeXml(value)}">`).join("\n");
}

export function renderHtml(topics: Topic[], meta: FeedMeta, status?: Status): string {
  const alert = statusAlert(status, meta);
  const rows = topics
    .map(
      (t) => `<article>
  <h2><a href="${escapeXml(t.url)}" rel="noopener noreferrer">${escapeXml(t.title)}</a></h2>
  <p class="meta">${escapeXml(t.author)} · <time datetime="${escapeXml(t.posted_at)}">${escapeXml(t.posted_at.slice(0, 16).replace("T", " "))} UTC</time></p>
  <p>${escapeXml(t.summary)}</p>
  ${relatedHtml(t)}
  ${t.tags.length ? `<p class="tags">${t.tags.map((c) => `<span>${escapeXml(c)}</span>`).join(" ")}</p>` : ""}
</article>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>${escapeXml(meta.title)}</title>
<meta name="description" content="${escapeXml(meta.description)}">
${ogpHtml(meta)}
<link rel="alternate" type="application/rss+xml" title="${escapeXml(meta.title)}" href="${escapeXml(meta.feedUrl)}">
<style>
:root{color-scheme:light dark;--fg:#1a1a1a;--muted:#666;--bg:#fff;--line:#e5e5e5;--warn:#b45309}
@media (prefers-color-scheme:dark){:root{--fg:#eee;--muted:#aaa;--bg:#141414;--line:#333;--warn:#f59e0b}}
body{margin:0 auto;max-width:760px;padding:24px 16px;font:16px/1.7 system-ui,sans-serif;color:var(--fg);background:var(--bg)}
a{color:inherit}h1{font-size:1.4rem}h2{font-size:1.05rem;margin:0 0 4px}
article{border-top:1px solid var(--line);padding:16px 0}.meta{color:var(--muted);font-size:.85rem;margin:0}
.tags span{display:inline-block;border:1px solid var(--line);border-radius:4px;padding:0 6px;margin:0 4px 4px 0;font-size:.8rem}
#status{border:1px solid var(--warn);color:var(--warn);padding:12px;border-radius:6px;white-space:pre-wrap}
</style>
</head>
<body>
<h1>${escapeXml(meta.title)}</h1>
<p>${escapeXml(meta.description)} — <a href="${escapeXml(meta.feedUrl)}">RSS</a></p>
${alert ? `<p id="status">${escapeXml(alert.title)}\n${escapeXml(alert.summary)}</p>` : ""}
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

    it("prepends an alert item when the last run failed", () => {
      const xml = renderRss([topic], meta, {
        ok: false,
        message: "xAI API エラー HTTP 401",
        checked_at: "2026-11-03T21:00:00Z",
      });
      const first = xml.indexOf("<item>");
      expect(xml.slice(first, first + 200)).toContain("⚠️ 収集に失敗しました (2026-11-03)");
      expect(xml).toContain("status-error-2026-11-03");
      expect(xml).toContain("HTTP 401");
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

  describe("renderHtml", () => {
    it("escapes content and links the feed", () => {
      const html = renderHtml([topic], meta);
      expect(html).toContain('type="application/rss+xml"');
      expect(html).toContain("A &amp; B &lt;script&gt;");
      expect(html).not.toContain("<script>");
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
      expect(html).toContain('<meta name="twitter:card" content="summary">');
      const head = html.slice(0, html.indexOf("</head>"));
      expect(head).not.toContain("A &amp; B");
      expect(head).not.toContain("HTTP 401");
    });
  });
}
