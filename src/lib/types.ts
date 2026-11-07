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
