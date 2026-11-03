import { createHash } from "node:crypto";
import type { Status, Topic } from "./types.ts";

export const SNAPSHOT_DIR = "snapshots";
const NAME_RE = /^(\d{4}-\d{2}-\d{2}-\d{2})(?:-(\d+))?\.json$/;

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
  sha256: string;
  items: number;
}

export interface Manifest {
  version: 1;
  generated_at: string;
  snapshots: ManifestEntry[];
}

export function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function isSnapshotName(name: string): boolean {
  return NAME_RE.test(name);
}

/**
 * Snapshots are never overwritten, so a second run in the same UTC hour gets
 * a numbered suffix instead of replacing the first run's results.
 */
export function snapshotName(at: Date, existing: Iterable<string>): string {
  const base = at.toISOString().slice(0, 13).replace("T", "-");
  const taken = new Set(existing);
  if (!taken.has(`${base}.json`)) return `${base}.json`;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}-${n}.json`)) return `${base}-${n}.json`;
  }
}

/** Newest first; a numbered rerun sorts after the run it follows within the same hour. */
export function compareSnapshotNamesDesc(a: string, b: string): number {
  const [, ha = "", na = "1"] = NAME_RE.exec(a) ?? [];
  const [, hb = "", nb = "1"] = NAME_RE.exec(b) ?? [];
  return hb.localeCompare(ha) || Number(nb) - Number(na);
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

/**
 * Guard against publishing a site that lost history: every snapshot from the
 * previous manifest must still be present with identical content.
 */
export function verifyAgainstPrevious(prev: Manifest | undefined, next: Manifest): string[] {
  if (!prev) return [];
  const nextByName = new Map(next.snapshots.map((e) => [e.name, e]));
  const problems: string[] = [];
  for (const e of prev.snapshots) {
    const n = nextByName.get(e.name);
    if (!n) problems.push(`missing ${e.name}`);
    else if (n.sha256 !== e.sha256) problems.push(`changed ${e.name}`);
  }
  if (next.snapshots.length < prev.snapshots.length) {
    problems.push(`snapshot count decreased ${prev.snapshots.length} -> ${next.snapshots.length}`);
  }
  return problems;
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  describe("snapshotName", () => {
    it("uses the UTC hour and adds a suffix instead of overwriting", () => {
      const at = new Date("2026-11-03T00:05:00Z");
      expect(snapshotName(at, [])).toBe("2026-11-03-00.json");
      expect(snapshotName(at, ["2026-11-03-00.json"])).toBe("2026-11-03-00-2.json");
      expect(snapshotName(at, ["2026-11-03-00.json", "2026-11-03-00-2.json"])).toBe("2026-11-03-00-3.json");
    });
  });

  describe("compareSnapshotNamesDesc", () => {
    it("orders newest first, reruns after the original within an hour", () => {
      const names = ["2026-11-02-17.json", "2026-11-03-00.json", "2026-11-03-00-2.json", "2026-11-02-18.json"];
      expect(names.sort(compareSnapshotNamesDesc)).toEqual([
        "2026-11-03-00-2.json",
        "2026-11-03-00.json",
        "2026-11-02-18.json",
        "2026-11-02-17.json",
      ]);
    });
  });

  describe("parseManifest", () => {
    const ok = { name: "2026-11-03-00.json", sha256: "a".repeat(64), items: 1 };
    it("accepts a valid manifest", () => {
      expect(parseManifest({ version: 1, generated_at: "x", snapshots: [ok] }).snapshots).toHaveLength(1);
    });
    it("rejects bad shapes, names and hashes", () => {
      expect(() => parseManifest({})).toThrow();
      expect(() => parseManifest({ version: 1, snapshots: [{ ...ok, name: "../x.json" }] })).toThrow();
      expect(() => parseManifest({ version: 1, snapshots: [{ ...ok, sha256: "zz" }] })).toThrow();
    });
  });

  describe("verifyAgainstPrevious", () => {
    const e = (name: string, sha256 = "a".repeat(64)): ManifestEntry => ({ name, sha256, items: 1 });
    const m = (...s: ManifestEntry[]): Manifest => ({ version: 1, generated_at: "x", snapshots: s });
    it("passes when history is preserved and grows", () => {
      expect(verifyAgainstPrevious(m(e("2026-11-02-00.json")), m(e("2026-11-02-00.json"), e("2026-11-03-00.json")))).toEqual([]);
      expect(verifyAgainstPrevious(undefined, m())).toEqual([]);
    });
    it("reports missing or changed snapshots", () => {
      const prev = m(e("2026-11-02-00.json"), e("2026-11-02-01.json"));
      const next = m(e("2026-11-02-00.json", "b".repeat(64)));
      expect(verifyAgainstPrevious(prev, next)).toEqual([
        "changed 2026-11-02-00.json",
        "missing 2026-11-02-01.json",
        "snapshot count decreased 2 -> 1",
      ]);
    });
  });
}
