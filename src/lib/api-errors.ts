/** Remediation is attached only to the failures it applies to, so other failures do not suggest a key or credit problem. */
export function errorHint(status: number, detail: string): string {
  // xAI answers an invalid key with HTTP 400, so the body has to be checked too.
  if (status === 401 || status === 403 || /api key/i.test(detail)) {
    return " (APIキーが無効か失効しています。console.x.ai でキーを再発行し、リポジトリの Secrets (XAI_API_KEY) を更新してください)";
  }
  if (status === 402 || status === 429 || /credit|balance|spend/i.test(detail)) {
    return " (クレジット不足またはレート制限の可能性があります。console.x.ai で残高を確認し、必要ならチャージしてください)";
  }
  return "";
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  describe("errorHint", () => {
    it("points key failures at reissuing the key", () => {
      expect(errorHint(401, "")).toContain("キーを再発行");
      expect(errorHint(400, '{"error":"Incorrect API key provided"}')).toContain("キーを再発行");
    });
    it("points credit and rate-limit failures at the balance", () => {
      expect(errorHint(402, "")).toContain("残高を確認");
      expect(errorHint(429, "")).toContain("残高を確認");
      expect(errorHint(400, "spending limit reached")).toContain("残高を確認");
    });
    it("adds nothing for other errors", () => {
      expect(errorHint(500, "internal error")).toBe("");
      expect(errorHint(400, "bad request")).toBe("");
    });
  });
}
