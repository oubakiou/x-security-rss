import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ARCHIVE_DIR, SITE_DIR } from "./paths.ts";
import {
  archiveDate,
  isSnapshotName,
  parseArchive,
  SNAPSHOT_DIR,
  type ArchiveFile,
  type Snapshot,
} from "./snapshot.ts";

export async function loadArchives(dir = ARCHIVE_DIR): Promise<Map<string, ArchiveFile>> {
  const out = new Map<string, ArchiveFile>();
  const files = await readdir(dir).catch(() => [] as string[]);
  for (const f of files.sort()) {
    const date = archiveDate(f);
    if (!date) continue;
    out.set(date, parseArchive(JSON.parse(await readFile(join(dir, f), "utf8")), date));
  }
  return out;
}

export function archivedShas(archives: Iterable<ArchiveFile>): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of archives) for (const e of a.snapshots) out.set(e.name, e.sha256);
  return out;
}

export async function readSiteSnapshots(): Promise<Array<{ name: string; text: string }>> {
  const dir = join(SITE_DIR, SNAPSHOT_DIR);
  const names = (await readdir(dir).catch(() => [] as string[])).filter(isSnapshotName).sort();
  return Promise.all(names.map(async (name) => ({ name, text: await readFile(join(dir, name), "utf8") })));
}

/** Restore drops snapshots already archived in git, so both places are read. */
export async function loadAllSnapshots(): Promise<Array<Partial<Snapshot>>> {
  const site = (await readSiteSnapshots()).map((f) => JSON.parse(f.text) as Partial<Snapshot>);
  const archived = [...(await loadArchives()).values()].flatMap((a) => a.snapshots.map((e) => e.snapshot));
  return [...site, ...archived];
}
