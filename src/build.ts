import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_TRUSTED_HANDLES, parseHandles } from "./lib/config.ts";
import { intEnv, logSafe } from "./lib/env.ts";
import { toStatus } from "./lib/failure.ts";
import { mergeTopics } from "./lib/items.ts";
import { PENDING_ARCHIVE_DIR, PREV_MANIFEST, PUBLIC_DIR, SITE_DIR, siteUrl } from "./lib/paths.ts";
import { renderHtml, renderJsonFeed, renderRss, type FeedMeta } from "./lib/rss.ts";
import {
  buildArchive,
  compareSnapshotNamesDesc,
  parseManifest,
  pendingDates,
  sha256,
  verifyAgainstPrevious,
  type Manifest,
  type Snapshot,
} from "./lib/snapshot.ts";
import { archivedShas, loadArchives, readSiteSnapshots } from "./lib/store.ts";

const site = siteUrl();
const limit = intEnv("FEED_LIMIT", 100, 1, 500);
const meta: FeedMeta = {
  title: "X Security Topics",
  description:
    "X (旧Twitter) から毎日収集したサイバーセキュリティの話題。Grok (x_search) による自動収集・自動要約で、投稿者名を含め内容は未検証です。必ず元の投稿と一次情報を確認してください。",
  siteUrl: site,
  feedUrl: `${site}feed.xml`,
  jsonFeedUrl: `${site}feed.json`,
  sourceUrl: "https://github.com/oubakiou/x-security-rss",
  trustedHandles: new Set(
    parseHandles(process.env.TRUSTED_HANDLES, DEFAULT_TRUSTED_HANDLES).map((h) => h.toLowerCase()),
  ),
};

async function readPrevManifest(): Promise<Manifest | undefined> {
  const text = await readFile(PREV_MANIFEST, "utf8").catch(() => undefined);
  return text === undefined ? undefined : parseManifest(JSON.parse(text));
}

const archives = await loadArchives();
const siteFiles = await readSiteSnapshots();
const today = new Date().toISOString().slice(0, 10);

const pending = pendingDates(
  siteFiles.map((f) => f.name),
  new Set(archives.keys()),
  today,
);
await mkdir(PENDING_ARCHIVE_DIR, { recursive: true });
for (const date of pending) {
  const archive = buildArchive(date, siteFiles);
  await writeFile(join(PENDING_ARCHIVE_DIR, `${date}.json`), JSON.stringify(archive, null, 2) + "\n");
  logSafe(`pending archive ${date}: ${archive.snapshots.length} snapshots`);
}

const byName = new Map<string, Snapshot>();
for (const a of archives.values()) for (const e of a.snapshots) byName.set(e.name, e.snapshot);
for (const f of siteFiles) if (!byName.has(f.name)) byName.set(f.name, JSON.parse(f.text) as Snapshot);
const ordered = [...byName.keys()].sort(compareSnapshotNamesDesc).map((n) => byName.get(n)!);

const topics = mergeTopics(
  ordered.map((s) => (Array.isArray(s.items) ? s.items : [])),
  limit,
);
const status = toStatus(ordered[0]?.status);

const manifest: Manifest = {
  version: 1,
  generated_at: new Date().toISOString().slice(0, 19) + "Z",
  snapshots: siteFiles.map((f) => ({
    name: f.name,
    sha256: sha256(f.text),
    items: (JSON.parse(f.text) as Snapshot).items?.length ?? 0,
  })),
};

const problems = verifyAgainstPrevious(await readPrevManifest(), manifest, archivedShas(archives.values()));
if (problems.length) {
  logSafe(`refusing to publish: ${problems.join("; ")}`);
  process.exit(1);
}

await mkdir(SITE_DIR, { recursive: true });
await cp(PUBLIC_DIR, SITE_DIR, { recursive: true });
await writeFile(join(SITE_DIR, "feed.xml"), renderRss(topics, meta, status));
await writeFile(join(SITE_DIR, "feed.json"), renderJsonFeed(topics, meta, status));
await writeFile(join(SITE_DIR, "index.html"), renderHtml(topics, meta, status));
await writeFile(
  join(SITE_DIR, "feed-state.json"),
  JSON.stringify({ version: 1, generated_at: manifest.generated_at, status, items: topics }, null, 2) + "\n",
);
await writeFile(join(SITE_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
logSafe(
  `built feed with ${topics.length} items from ${ordered.length} snapshots ` +
    `(${archives.size} archived days, ${siteFiles.length} on Pages, ${pending.length} pending archive)` +
    (status && !status.ok ? " + error notice" : ""),
);
