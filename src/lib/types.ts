import type { FailureKind } from "./failure.ts";

export interface Topic {
  /** X status id (also used as RSS guid) */
  id: string;
  title: string;
  url: string;
  author: string;
  posted_at: string;
  summary: string;
  tags: string[];
  collected_at: string;
  /** ids of other posts merged into this topic (same CVE) */
  related?: string[];
  category?: Category;
  /** lowercase handle confirmed by the API's citation; absent when only the model's URL named it */
  author_handle?: string;
  /** excerpt the model claims to have copied from the post; kept in snapshots only, not in the feed */
  quote?: string;
  /** whether quote was found in the post text returned by X (snapshots only) */
  quote_match?: boolean;
}

export const CATEGORIES = ["vulnerability", "incident", "campaign", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

/** The model picks the category, so stored or returned values are accepted only from the fixed list. */
export function toCategory(v: unknown): Category | undefined {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v) ? (v as Category) : undefined;
}

export interface Status {
  ok: boolean;
  /** For the Actions log; the published notice is built from `kind` and the numbers below. */
  message: string;
  checked_at: string;
  dropped_unverified?: number;
  kind?: FailureKind;
  /** Some searches succeeded. */
  partial?: boolean;
  http_status?: number;
  failed_calls?: number;
}
