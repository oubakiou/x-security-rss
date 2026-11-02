/**
 * Build public/feed.xml and public/index.html from data/raw/*.json and data/status.json.
 *
 * Env: SITE_URL (default: https://oubakiou.github.io/x-security-rss/), FEED_LIMIT
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { intEnv } from "./lib/env.ts";
import { mergeTopics } from "./lib/items.ts";
import { renderHtml, renderRss, type FeedMeta } from "./lib/rss.ts";
import type { RawDay, Status } from "./lib/types.ts";

const ROOT = join(import.meta.dirname, "..");
const DATA = join(ROOT, "data");
const PUBLIC = join(ROOT, "public");

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

const siteUrl = (process.env.SITE_URL || "https://oubakiou.github.io/x-security-rss/").replace(/\/?$/, "/");
const limit = intEnv("FEED_LIMIT", 100, 1, 500);
const meta: FeedMeta = {
  title: "X Security Topics",
  description:
    "X (旧Twitter) から毎日収集したサイバーセキュリティの話題。Grok (x_search) による自動収集・自動要約で、内容は未検証です。必ず元の投稿と一次情報を確認してください。",
  siteUrl,
  feedUrl: `${siteUrl}feed.xml`,
};

const rawDir = join(DATA, "raw");
const files = (await readdir(rawDir).catch(() => [] as string[]))
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .sort()
  .reverse();
const days: RawDay[] = [];
for (const f of files) {
  const d = await readJson<RawDay>(join(rawDir, f));
  if (d) days.push(d);
}
const topics = mergeTopics(
  days.map((d) => d.items),
  limit,
);
const status = await readJson<Status>(join(DATA, "status.json"));

await mkdir(PUBLIC, { recursive: true });
await writeFile(join(PUBLIC, "feed.xml"), renderRss(topics, meta, status));
await writeFile(join(PUBLIC, "index.html"), renderHtml(topics, meta, status));
console.log(`built feed with ${topics.length} items${status && !status.ok ? " + error notice" : ""}`);
