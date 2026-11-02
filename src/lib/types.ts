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

export interface RunRecord {
  at: string;
  model: string;
  window: { from: string; to: string };
  usage: unknown;
  kept: number;
  rejected: Array<{ search: string; reason: string; id?: string; posted_at?: string }>;
  errors: string[];
}

/** One file per run date; repeated runs on the same date append. */
export interface RawDay {
  date: string;
  items: Topic[];
  runs?: RunRecord[];
}

export interface Status {
  ok: boolean;
  message: string;
  checked_at: string;
  dropped_unverified?: number;
}
