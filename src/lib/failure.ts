import { cleanText } from "./items.ts";
import type { Status } from "./types.ts";

/** Ordered by priority: when searches fail for different reasons, the first one needs action most. */
export const FAILURE_KINDS = [
  "no_key",
  "auth",
  "credit",
  "bad_response",
  "tool_outage",
  "api_error",
  "no_results",
  "unknown",
] as const;

export type FailureKind = (typeof FAILURE_KINDS)[number];

export function isFailureKind(v: unknown): v is FailureKind {
  return typeof v === "string" && (FAILURE_KINDS as readonly string[]).includes(v);
}

export function httpFailureKind(status: number, detail: string): FailureKind {
  // xAI answers an invalid key with HTTP 400, so the body has to be checked too.
  if (status === 401 || status === 403 || /api key/i.test(detail)) return "auth";
  if (status === 402 || status === 429 || /credit|balance|spend/i.test(detail)) return "credit";
  return "api_error";
}

/**
 * Error bodies can carry account details or part of the key, and Actions logs of a public
 * repository are public, so only a short identifier such as "invalid_api_key" is ever logged.
 */
export function errorCode(body: string): string | undefined {
  const parsed = (() => {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return undefined;
    }
  })();
  const o = (parsed ?? {}) as { code?: unknown; type?: unknown; error?: unknown };
  const e = (typeof o.error === "object" && o.error !== null ? o.error : {}) as {
    code?: unknown;
    type?: unknown;
  };
  return [e.code, e.type, o.code, o.type, o.error].find(
    (v): v is string => typeof v === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(v),
  );
}

export function pickFailure(kinds: readonly FailureKind[]): FailureKind {
  return FAILURE_KINDS.find((k) => kinds.includes(k)) ?? "unknown";
}

const NOTICES: Record<FailureKind, { title: string; body: string }> = {
  no_key: {
    title: "API キーが設定されていません",
    body: "リポジトリの Secrets に XAI_API_KEY を登録してください。",
  },
  auth: {
    title: "xAI API キーが無効です",
    body: "APIキーが無効か失効しています。console.x.ai でキーを再発行し、リポジトリの Secrets (XAI_API_KEY) を更新してください。",
  },
  credit: {
    title: "xAI のクレジット不足またはレート制限です",
    body: "console.x.ai で残高を確認し、必要ならチャージしてください。レート制限の場合は次回の実行で回復します。",
  },
  bad_response: {
    title: "xAI の応答を解析できませんでした",
    body: "応答の形式が変わった可能性があります。Actions の実行ログを確認してください。",
  },
  tool_outage: {
    title: "X 検索ツールが利用できませんでした",
    body: "xAI 側の一時的な障害の可能性があります。次回の実行で自動的に再試行します。",
  },
  api_error: {
    title: "xAI API でエラーが発生しました",
    body: "一時的な障害の可能性があります。次回の実行で再試行します。続く場合は Actions の実行ログを確認してください。",
  },
  no_results: {
    title: "条件に合う投稿がありませんでした",
    body: "検索は正常に行われましたが、出典を確認できた投稿が 0 件でした。続く場合は Actions の実行ログを確認してください。",
  },
  unknown: {
    title: "収集に失敗しました",
    body: "原因を特定できませんでした。Actions の実行ログを確認してください。",
  },
};

/**
 * The published notice is built only from fixed text and validated numbers, never from
 * API responses or free-form messages, so it cannot leak account details or carry injected text.
 */
export function failureNotice(status: Status): { title: string; body: string } {
  const kind = status.kind ?? "unknown";
  const notice = NOTICES[kind];
  const facts = [
    status.http_status !== undefined ? `HTTP ${status.http_status}` : "",
    status.failed_calls !== undefined ? `ツール呼び出し ${status.failed_calls} 回がすべて失敗` : "",
  ].filter(Boolean);
  return {
    title: status.partial ? `一部の検索に失敗しました: ${notice.title}` : notice.title,
    body: facts.length ? `${notice.body} (${facts.join("、")})` : notice.body,
  };
}

/** Snapshots restored from Pages are only as trustworthy as past runs, so the status is re-validated. */
export function toStatus(raw: unknown): Status | undefined {
  const s = raw as Partial<Record<keyof Status, unknown>> | undefined;
  if (typeof s?.ok !== "boolean" || typeof s.checked_at !== "string") return undefined;
  const count = (v: unknown, min: number, max: number) =>
    Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : undefined;
  const httpStatus = count(s.http_status, 100, 599);
  const failedCalls = count(s.failed_calls, 1, 1000);
  return {
    ok: s.ok,
    message: cleanText(s.message, 1000),
    checked_at: cleanText(s.checked_at, 30),
    ...(isFailureKind(s.kind) ? { kind: s.kind } : {}),
    ...(s.partial === true ? { partial: true } : {}),
    ...(httpStatus !== undefined ? { http_status: httpStatus } : {}),
    ...(failedCalls !== undefined ? { failed_calls: failedCalls } : {}),
  };
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;
  const at = "2026-11-07T01:32:09Z";

  describe("httpFailureKind", () => {
    it("classifies key, credit and other errors", () => {
      expect(httpFailureKind(401, "")).toBe("auth");
      expect(httpFailureKind(400, '{"error":"Incorrect API key provided"}')).toBe("auth");
      expect(httpFailureKind(402, "")).toBe("credit");
      expect(httpFailureKind(429, "")).toBe("credit");
      expect(httpFailureKind(400, "spending limit reached")).toBe("credit");
      expect(httpFailureKind(502, "bad gateway")).toBe("api_error");
    });
  });

  describe("errorCode", () => {
    it("returns only a short identifier from the body", () => {
      expect(
        errorCode(
          '{"error":{"code":"invalid_api_key","message":"Incorrect API key provided: xai-****abcd"}}',
        ),
      ).toBe("invalid_api_key");
      expect(errorCode('{"code":"rate_limited","error":"Too many requests for team 1234"}')).toBe(
        "rate_limited",
      );
      expect(errorCode('{"error":"Incorrect API key provided: xai-****abcd"}')).toBeUndefined();
      expect(errorCode("<html>Bad Gateway</html>")).toBeUndefined();
      expect(errorCode('{"error":{"code":"a b <c>"}}')).toBeUndefined();
    });
  });

  describe("pickFailure", () => {
    it("prefers the failure that needs action", () => {
      expect(pickFailure(["tool_outage", "credit"])).toBe("credit");
      expect(pickFailure(["api_error", "bad_response"])).toBe("bad_response");
      expect(pickFailure([])).toBe("unknown");
    });
  });

  describe("toStatus", () => {
    it("keeps only valid fields from stored data", () => {
      expect(
        toStatus({
          ok: false,
          message: "m",
          checked_at: at,
          kind: "auth",
          partial: true,
          http_status: 401,
          failed_calls: 3,
        }),
      ).toEqual({
        ok: false,
        message: "m",
        checked_at: at,
        kind: "auth",
        partial: true,
        http_status: 401,
        failed_calls: 3,
      });
      expect(
        toStatus({
          ok: false,
          message: "m",
          checked_at: at,
          kind: "bogus",
          partial: "yes",
          http_status: 7,
          failed_calls: 1.5,
        }),
      ).toEqual({ ok: false, message: "m", checked_at: at });
      expect(toStatus({ ok: "no", checked_at: at })).toBeUndefined();
    });
  });

  describe("failureNotice", () => {
    it("uses fixed text per kind with validated facts", () => {
      expect(
        failureNotice({ ok: false, message: "", checked_at: at, kind: "tool_outage", failed_calls: 8 }),
      ).toEqual({
        title: "X 検索ツールが利用できませんでした",
        body: "xAI 側の一時的な障害の可能性があります。次回の実行で自動的に再試行します。 (ツール呼び出し 8 回がすべて失敗)",
      });
      const auth = failureNotice({ ok: false, message: "", checked_at: at, kind: "auth", http_status: 401 });
      expect(auth.body).toContain("キーを再発行");
      expect(auth.body).toContain("(HTTP 401)");
    });
    it("marks partial failures and never repeats the free-form message", () => {
      const n = failureNotice({
        ok: false,
        message: "secret detail <script>",
        checked_at: at,
        kind: "credit",
        partial: true,
      });
      expect(n.title).toBe("一部の検索に失敗しました: xAI のクレジット不足またはレート制限です");
      expect(JSON.stringify(n)).not.toContain("secret detail");
    });
    it("falls back to the generic notice without a kind", () => {
      expect(failureNotice({ ok: false, message: "old", checked_at: at })).toEqual({
        title: "収集に失敗しました",
        body: "原因を特定できませんでした。Actions の実行ログを確認してください。",
      });
      expect(isFailureKind("auth")).toBe(true);
      expect(isFailureKind("bogus")).toBe(false);
    });
  });
}
