/**
 * Pages replaces the whole site on every deploy, so every snapshot that is not
 * yet archived in git must be downloaded and re-published each run. Any
 * download or hash mismatch aborts the run: publishing an incomplete site
 * would silently delete data. A missing manifest is only accepted with
 * BOOTSTRAP=true, because a transient 404 must never be mistaken for "no data yet".
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { logSafe } from "./lib/env.ts";
import { PREV_MANIFEST, SITE_DIR, WORK_DIR, siteUrl } from "./lib/paths.ts";
import {
  parseManifest,
  sha256,
  snapshotDate,
  SNAPSHOT_DIR,
  type Manifest,
  type ManifestEntry,
} from "./lib/snapshot.ts";
import { archivedShas, loadArchives } from "./lib/store.ts";

const CONCURRENCY = 8;

async function get(url: string): Promise<Response> {
  // The Pages CDN caches for minutes; a stale manifest would drop the latest snapshot.
  const busted = `${url}?t=${Date.now()}`;
  for (const attempt of [1, 2, 3]) {
    const res = await fetch(busted, { cache: "no-store", signal: AbortSignal.timeout(30_000) }).catch(
      (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
    );
    if (!(res instanceof Error) && (res.ok || res.status === 404)) return res;
    logSafe(`GET ${url} attempt ${attempt} failed: ${res instanceof Error ? res.message : res.status}`);
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  throw new Error(`GET ${url} failed after retries`);
}

async function downloadOne(base: string, entry: ManifestEntry): Promise<void> {
  const res = await get(`${base}${SNAPSHOT_DIR}/${entry.name}`);
  if (!res.ok) throw new Error(`snapshot ${entry.name}: HTTP ${res.status}`);
  const body = await res.text();
  if (sha256(body) !== entry.sha256) throw new Error(`snapshot ${entry.name}: sha256 mismatch`);
  await writeFile(join(SITE_DIR, SNAPSHOT_DIR, entry.name), body);
}

async function downloadAll(base: string, entries: ManifestEntry[]): Promise<void> {
  const queue = [...entries];
  const worker = async (): Promise<void> => {
    const entry = queue.shift();
    if (!entry) return;
    await downloadOne(base, entry);
    return worker();
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

/** Snapshots already archived in git (same hash) are not re-published; any mismatch is fatal. */
async function dropArchived(manifest: Manifest): Promise<number> {
  const archives = await loadArchives();
  const shas = archivedShas(archives.values());
  const archived = manifest.snapshots.filter((e) => archives.has(snapshotDate(e.name)));
  for (const e of archived) {
    if (shas.get(e.name) !== e.sha256) {
      throw new Error(
        `archive/${snapshotDate(e.name)}.json does not contain ${e.name} with the published hash`,
      );
    }
    await rm(join(SITE_DIR, SNAPSHOT_DIR, e.name));
  }
  return archived.length;
}

const base = siteUrl();
await rm(SITE_DIR, { recursive: true, force: true });
await rm(WORK_DIR, { recursive: true, force: true });
await mkdir(join(SITE_DIR, SNAPSHOT_DIR), { recursive: true });
await mkdir(WORK_DIR, { recursive: true });

const res = await get(`${base}manifest.json`);
if (res.status === 404) {
  if (process.env.BOOTSTRAP !== "true") {
    logSafe(
      "manifest.json not found on Pages. Run the workflow manually with bootstrap=true for the first run.",
    );
    process.exit(1);
  }
  logSafe("bootstrap: no manifest on Pages; starting with no unarchived snapshots");
} else {
  const text = await res.text();
  const manifest = parseManifest(JSON.parse(text));
  await writeFile(PREV_MANIFEST, text);
  await downloadAll(base, manifest.snapshots);
  const dropped = await dropArchived(manifest);
  logSafe(`restored ${manifest.snapshots.length} snapshots from Pages (${dropped} already archived in git)`);
}
