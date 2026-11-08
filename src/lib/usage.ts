/**
 * Machine-readable cost summary of one run, printed as a single log line so an agent can
 * collect it from Actions logs. Only numeric fields are copied out of the API's usage object,
 * so nothing else from the response can reach the log through this line.
 */
export const COST_SUMMARY_PREFIX = "cost-summary ";

/** xAI reports cost in ticks of 1e-10 USD. */
const USD_PER_TICK = 1e-10;

/** Token and search figures come from the last attempt only; earlier retried attempts are not included. */
export interface SearchCost {
  outcome: "ok" | "failed";
  attempts: number;
  kept: number | null;
  dropped: number | null;
  x_search_calls: number | null;
  x_posts_fetched: number | null;
  input_tokens: number | null;
  cached_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  cost_usd: number | null;
}

export interface SearchOutcome {
  usage: unknown;
  attempts: number;
  kept?: number;
  dropped?: number;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function field(obj: unknown, ...path: string[]): unknown {
  let cur = obj;
  for (const key of path) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const roundUsd = (usd: number) => Math.round(usd * 1e6) / 1e6;

export function searchCost(o: SearchOutcome): SearchCost {
  const ticks = num(field(o.usage, "cost_in_usd_ticks"));
  return {
    outcome: o.kept === undefined ? "failed" : "ok",
    attempts: o.attempts,
    kept: o.kept ?? null,
    dropped: o.dropped ?? null,
    x_search_calls: num(field(o.usage, "server_side_tool_usage_details", "x_search_calls")),
    x_posts_fetched: num(field(o.usage, "server_side_tool_usage_details", "x_posts_fetched")),
    input_tokens: num(field(o.usage, "input_tokens")),
    cached_tokens: num(field(o.usage, "input_tokens_details", "cached_tokens")),
    output_tokens: num(field(o.usage, "output_tokens")),
    reasoning_tokens: num(field(o.usage, "output_tokens_details", "reasoning_tokens")),
    cost_usd: ticks === null ? null : roundUsd(ticks * USD_PER_TICK),
  };
}

export function costSummary(
  meta: { snapshot: string; model: string; maxTurns: number },
  outcomes: Record<string, SearchOutcome>,
) {
  const searches = Object.fromEntries(Object.entries(outcomes).map(([k, o]) => [k, searchCost(o)]));
  const sum = (key: "cost_usd" | "x_search_calls" | "x_posts_fetched" | "kept") =>
    Object.values(searches).reduce((acc, s) => acc + (s[key] ?? 0), 0);
  return {
    version: 1,
    ...meta,
    searches,
    total: {
      cost_usd: roundUsd(sum("cost_usd")),
      x_search_calls: sum("x_search_calls"),
      x_posts_fetched: sum("x_posts_fetched"),
      kept: sum("kept"),
    },
  };
}

export function costSummaryLine(summary: ReturnType<typeof costSummary>): string {
  return COST_SUMMARY_PREFIX + JSON.stringify(summary);
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  const usage = {
    input_tokens: 25802,
    input_tokens_details: { cached_tokens: 6144 },
    output_tokens: 10722,
    output_tokens_details: { reasoning_tokens: 9139 },
    cost_in_usd_ticks: 2423308000,
    server_side_tool_usage_details: { x_search_calls: 4, x_posts_fetched: 40 },
  };

  describe("searchCost", () => {
    it("copies only numeric usage fields and converts ticks to USD", () => {
      expect(searchCost({ usage, attempts: 1, kept: 8, dropped: 0 })).toEqual({
        outcome: "ok",
        attempts: 1,
        kept: 8,
        dropped: 0,
        x_search_calls: 4,
        x_posts_fetched: 40,
        input_tokens: 25802,
        cached_tokens: 6144,
        output_tokens: 10722,
        reasoning_tokens: 9139,
        cost_usd: 0.242331,
      });
    });

    it("yields nulls for missing or non-numeric fields and marks failures", () => {
      const c = searchCost({
        usage: { input_tokens: "1", cost_in_usd_ticks: -5, output_tokens: Number.NaN },
        attempts: 3,
      });
      expect(c.outcome).toBe("failed");
      expect(c.kept).toBeNull();
      expect(c.input_tokens).toBeNull();
      expect(c.output_tokens).toBeNull();
      expect(c.cost_usd).toBeNull();
      expect(searchCost({ usage: null, attempts: 1 }).x_search_calls).toBeNull();
    });
  });

  describe("costSummary", () => {
    it("totals the searches into one parseable line", () => {
      const s = costSummary(
        { snapshot: "2026-11-08-04.json", model: "grok-build-0.1", maxTurns: 3 },
        {
          trusted: { usage: { ...usage, cost_in_usd_ticks: 1557670000 }, attempts: 1, kept: 6, dropped: 0 },
          general: { usage, attempts: 1, kept: 8, dropped: 0 },
        },
      );
      expect(s.total).toEqual({ cost_usd: 0.398098, x_search_calls: 8, x_posts_fetched: 80, kept: 14 });
      const line = costSummaryLine(s);
      expect(line.startsWith(COST_SUMMARY_PREFIX)).toBe(true);
      expect(JSON.parse(line.slice(COST_SUMMARY_PREFIX.length))).toEqual(s);
      expect(line.length).toBeLessThan(2000);
    });
  });
}
