import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");

/** Directory uploaded to GitHub Pages as a whole. */
export const SITE_DIR = join(ROOT, "site");
/** Finalized days, committed to git and never rewritten. */
export const ARCHIVE_DIR = join(ROOT, "archive");
export const WORK_DIR = join(ROOT, ".work");
export const PREV_MANIFEST = join(WORK_DIR, "prev-manifest.json");
/** Archive files produced by this run, committed by a separate job that holds write access. */
export const PENDING_ARCHIVE_DIR = join(WORK_DIR, "archive-pending");
export const DEBUG_DIR = join(WORK_DIR, "debug");

export function siteUrl(): string {
  return (process.env.SITE_URL || "https://oubakiou.github.io/x-security-rss/").replace(/\/?$/, "/");
}
