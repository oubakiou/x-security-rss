/**
 * Pages replaces the whole site on every deploy, so all past snapshots must be
 * downloaded and re-published each run. Any download or hash mismatch aborts
 * the run: publishing an incomplete site would silently delete history.
 * A missing manifest is only accepted with BOOTSTRAP=true (first run), because
 * a transient 404 must never be mistaken for "no history yet".
 */
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { logSafe } from "./lib/env.ts";
import { isSnapshotName, parseManifest, sha256, SNAPSHOT_DIR, type Manifest } from "./lib/snapshot.ts";
import { PREV_MANIFEST, SEED_DIR, SITE_DIR, WORK_DIR, siteUrl } from "./lib/paths.ts";

const CONCURRENCY = 8;

async function get(url: string): Promise<Response> {
  // Pages is served through a CDN that caches for minutes; a stale manifest would drop the latest snapshot.
  const busted = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
  for (const attempt of [1, 2, 3]) {
    const res = await fetch(busted, { cache: "no-store", signal: AbortSignal.timeout(30_000) }).catch(
      (e: unknown) => e as Error,
    );
    if (!(res instanceof Error) && (res.ok || res.status === 404)) return res;
    logSafe(`GET ${url} attempt ${attempt} failed: ${res instanceof Error ? res.message : res.status}`);
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  throw new Error(`GET ${url} failed after retries`);
}

async function bootstrap(): Promise<void> {
  const seed = join(SEED_DIR, SNAPSHOT_DIR);
  const names = (await readdir(seed).catch(() => [] as string[])).filter(isSnapshotName);
  await cp(seed, join(SITE_DIR, SNAPSHOT_DIR), { recursive: true }).catch(() => undefined);
  logSafe(`bootstrap: no previous manifest; seeded ${names.length} snapshots from ${SEED_DIR}/`);
}

async function download(manifest: Manifest, base: string): Promise<void> {
  const queue = [...manifest.snapshots];
  const worker = async () => {
    for (const entry = queue.shift(); entry; ) {
      const res = await get(`${base}${SNAPSHOT_DIR}/${entry.name}`);
      if (!res.ok) throw new Error(`snapshot ${entry.name}: HTTP ${res.status}`);
      const body = await res.text();
      if (sha256(body) !== entry.sha256) throw new Error(`snapshot ${entry.name}: sha256 mismatch`);
      await writeFile(join(SITE_DIR, SNAPSHOT_DIR, entry.name), body);
      const next = queue.shift();
      if (!next) break;
      queue.unshift(next);
      await worker();
      break;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
}

const base = siteUrl();
await rm(SITE_DIR, { recursive: true, force: true });
await rm(WORK_DIR, { recursive: true, force: true });
await mkdir(join(SITE_DIR, SNAPSHOT_DIR), { recursive: true });
await mkdir(WORK_DIR, { recursive: true });

const res = await get(`${base}manifest.json`);
if (res.status === 404) {
  if (process.env.BOOTSTRAP !== "true") {
    logSafe("manifest.json not found. Run the workflow manually with bootstrap=true for the first run.");
    process.exit(1);
  }
  await bootstrap();
} else {
  const text = await res.text();
  const manifest = parseManifest(JSON.parse(text));
  await writeFile(PREV_MANIFEST, text);
  await download(manifest, base);
  logSafe(`restored ${manifest.snapshots.length} snapshots from ${base}`);
}
