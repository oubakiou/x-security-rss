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
  message: string;
  checked_at: string;
  dropped_unverified?: number;
}
