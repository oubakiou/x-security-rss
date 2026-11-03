import { createHash } from "node:crypto";
import type { Status, Topic } from "./types.ts";

export const SNAPSHOT_DIR = "snapshots";
const NAME_RE = /^(\d{4}-\d{2}-\d{2})-(\d{2})(?:-(\d+))?\.json$/;
const DATE_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;

export interface Snapshot {
  version: 1;
  fetched_at: string;
  window: { from: string; to: string };
  model: string;
  status: Status;
  usage: unknown;
  items: Topic[];
  rejected: Array<{ search: string; reason: string; id?: string; posted_at?: string }>;
  errors: string[];
}

export interface ManifestEntry {
  name: string;
  /** sha256 of the exact file bytes published on Pages */
  sha256: string;
  items: number;
}

export interface Manifest {
  version: 1;
  generated_at: string;
  snapshots: ManifestEntry[];
}

export interface ArchiveEntry {
  name: string;
  /** same hash as the Pages manifest, so archived snapshots can be matched before removal */
  sha256: string;
  snapshot: Snapshot;
}

export interface ArchiveFile {
  version: 1;
  date: string;
  snapshots: ArchiveEntry[];
}

export function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function isSnapshotName(name: string): boolean {
  return NAME_RE.test(name);
}

export function snapshotDate(name: string): string {
  const m = NAME_RE.exec(name);
  if (!m) throw new Error(`invalid snapshot name: ${name}`);
  return m[1]!;
}

export function archiveDate(fileName: string): string | undefined {
  return DATE_FILE_RE.exec(fileName)?.[1];
}

export function serializeSnapshot(s: Snapshot): string {
  return JSON.stringify(s, null, 2) + "\n";
}

/**
 * Snapshots are never overwritten, so a second run in the same UTC hour gets
 * a numbered suffix instead of replacing the first run's results.
 */
export function snapshotName(at: Date, existing: Iterable<string>): string {
  const base = at.toISOString().slice(0, 13).replace("T", "-");
  const taken = new Set(existing);
  if (!taken.has(`${base}.json`)) return `${base}.json`;
  // A loop counter is the clearest way to find the first free suffix.
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}-${n}.json`)) return `${base}-${n}.json`;
  }
}

/** Newest first; a numbered rerun sorts before the run it follows within the same hour. */
export function compareSnapshotNamesDesc(a: string, b: string): number {
  const [, da = "", ha = "", na = "1"] = NAME_RE.exec(a) ?? [];
  const [, db = "", hb = "", nb = "1"] = NAME_RE.exec(b) ?? [];
  return `${db}-${hb}`.localeCompare(`${da}-${ha}`) || Number(nb) - Number(na);
}

/** Days before `today` (UTC) that still have snapshots on Pages but no archive file in git. */
export function pendingDates(names: Iterable<string>, archived: Set<string>, today: string): string[] {
  const dates = new Set<string>();
  for (const n of names) {
    const d = snapshotDate(n);
    if (d < today && !archived.has(d)) dates.add(d);
  }
  return [...dates].sort();
}

export function buildArchive(date: string, files: Array<{ name: string; text: string }>): ArchiveFile {
  const snapshots = files
    .filter((f) => snapshotDate(f.name) === date)
    .sort((a, b) => compareSnapshotNamesDesc(b.name, a.name))
    .map((f) => ({ name: f.name, sha256: sha256(f.text), snapshot: JSON.parse(f.text) as Snapshot }));
  return { version: 1, date, snapshots };
}

export function parseManifest(raw: unknown): Manifest {
  const m = raw as Partial<Manifest> | undefined;
  if (m?.version !== 1 || !Array.isArray(m.snapshots)) throw new Error("manifest.json の形式が不正です");
  for (const e of m.snapshots) {
    if (
      typeof e?.name !== "string" ||
      !isSnapshotName(e.name) ||
      typeof e.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(e.sha256)
    ) {
      throw new Error(`manifest.json に不正な項目があります: ${JSON.stringify(e).slice(0, 100)}`);
    }
  }
  return m as Manifest;
}

export function parseArchive(raw: unknown, expectedDate: string): ArchiveFile {
  const a = raw as Partial<ArchiveFile> | undefined;
  if (a?.version !== 1 || a.date !== expectedDate || !Array.isArray(a.snapshots)) {
    throw new Error(`archive/${expectedDate}.json の形式が不正です`);
  }
  for (const e of a.snapshots) {
    if (typeof e?.name !== "string" || !isSnapshotName(e.name) || snapshotDate(e.name) !== expectedDate) {
      throw new Error(`archive/${expectedDate}.json に不正な項目があります`);
    }
  }
  return a as ArchiveFile;
}

/**
 * Guard against publishing a site that lost history: every snapshot from the
 * previous manifest must still be on Pages with identical content, unless it
 * has moved into a git archive with the same hash.
 */
export function verifyAgainstPrevious(
  prev: Manifest | undefined,
  next: Manifest,
  archivedSha: Map<string, string>,
): string[] {
  if (!prev) return [];
  const nextByName = new Map(next.snapshots.map((e) => [e.name, e]));
  const problems: string[] = [];
  for (const e of prev.snapshots) {
    const n = nextByName.get(e.name);
    if (n) {
      if (n.sha256 !== e.sha256) problems.push(`changed ${e.name}`);
    } else if (archivedSha.get(e.name) !== e.sha256) {
      problems.push(`missing ${e.name} (not on Pages and not archived with the same hash)`);
    }
  }
  return problems;
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;
  const H = (c: string) => c.repeat(64);

  describe("snapshotName", () => {
    it("uses the UTC hour and adds a suffix instead of overwriting", () => {
      const at = new Date("2026-11-03T00:05:00Z");
      expect(snapshotName(at, [])).toBe("2026-11-03-00.json");
      expect(snapshotName(at, ["2026-11-03-00.json"])).toBe("2026-11-03-00-2.json");
      expect(snapshotName(at, ["2026-11-03-00.json", "2026-11-03-00-2.json"])).toBe("2026-11-03-00-3.json");
    });
  });

  describe("compareSnapshotNamesDesc", () => {
    it("orders newest first, reruns before the original within an hour", () => {
      const names = [
        "2026-11-02-17.json",
        "2026-11-03-00.json",
        "2026-11-03-00-2.json",
        "2026-11-02-18.json",
      ];
      expect(names.sort(compareSnapshotNamesDesc)).toEqual([
        "2026-11-03-00-2.json",
        "2026-11-03-00.json",
        "2026-11-02-18.json",
        "2026-11-02-17.json",
      ]);
    });
  });

  describe("pendingDates", () => {
    it("returns past, not yet archived days only", () => {
      const names = ["2026-11-01-00.json", "2026-11-02-00.json", "2026-11-02-05.json", "2026-11-03-00.json"];
      expect(pendingDates(names, new Set(["2026-11-01"]), "2026-11-03")).toEqual(["2026-11-02"]);
    });
  });

  describe("buildArchive", () => {
    it("collects one day's snapshots in time order with their published hashes", () => {
      const text = (n: string) => `{"version":1,"fetched_at":"${n}"}\n`;
      const files = ["2026-11-02-05.json", "2026-11-03-00.json", "2026-11-02-00.json"].map((name) => ({
        name,
        text: text(name),
      }));
      const a = buildArchive("2026-11-02", files);
      expect(a.snapshots.map((s) => s.name)).toEqual(["2026-11-02-00.json", "2026-11-02-05.json"]);
      expect(a.snapshots[0]!.sha256).toBe(sha256(text("2026-11-02-00.json")));
    });
  });

  describe("parseManifest / parseArchive", () => {
    const ok = { name: "2026-11-03-00.json", sha256: H("a"), items: 1 };
    it("accepts valid files", () => {
      expect(parseManifest({ version: 1, generated_at: "x", snapshots: [ok] }).snapshots).toHaveLength(1);
      expect(parseArchive({ version: 1, date: "2026-11-03", snapshots: [ok] }, "2026-11-03").date).toBe(
        "2026-11-03",
      );
    });
    it("rejects bad shapes, names, hashes and dates", () => {
      expect(() => parseManifest({})).toThrow();
      expect(() => parseManifest({ version: 1, snapshots: [{ ...ok, name: "../x.json" }] })).toThrow();
      expect(() => parseManifest({ version: 1, snapshots: [{ ...ok, sha256: "zz" }] })).toThrow();
      expect(() => parseArchive({ version: 1, date: "2026-11-04", snapshots: [] }, "2026-11-03")).toThrow();
      expect(() => parseArchive({ version: 1, date: "2026-11-02", snapshots: [ok] }, "2026-11-02")).toThrow();
    });
  });

  describe("verifyAgainstPrevious", () => {
    const e = (name: string, sha = H("a")): ManifestEntry => ({ name, sha256: sha, items: 1 });
    const m = (...s: ManifestEntry[]): Manifest => ({ version: 1, generated_at: "x", snapshots: s });
    it("passes when snapshots are kept or archived with the same hash", () => {
      const prev = m(e("2026-11-02-00.json"), e("2026-11-03-00.json"));
      const next = m(e("2026-11-03-00.json"), e("2026-11-03-01.json"));
      expect(verifyAgainstPrevious(prev, next, new Map([["2026-11-02-00.json", H("a")]]))).toEqual([]);
      expect(verifyAgainstPrevious(undefined, m(), new Map())).toEqual([]);
    });
    it("reports changed snapshots and ones dropped without a matching archive", () => {
      const prev = m(e("2026-11-02-00.json"), e("2026-11-02-01.json"), e("2026-11-03-00.json"));
      const next = m(e("2026-11-03-00.json", H("b")));
      expect(verifyAgainstPrevious(prev, next, new Map([["2026-11-02-01.json", H("c")]]))).toEqual([
        "missing 2026-11-02-00.json (not on Pages and not archived with the same hash)",
        "missing 2026-11-02-01.json (not on Pages and not archived with the same hash)",
        "changed 2026-11-03-00.json",
      ]);
    });
  });
}
