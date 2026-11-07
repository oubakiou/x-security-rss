/**
 * Runs `attempt` up to `1 + retries` times while `shouldRetry` says the error is transient,
 * waiting `delayMs` between tries. The last error is rethrown.
 */
export async function withRetry<T>(
  attempt: (n: number) => Promise<T>,
  shouldRetry: (e: unknown) => boolean,
  retries: number,
  delayMs: number,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let n = 1; ; n++) {
    try {
      return await attempt(n);
    } catch (e) {
      if (n > retries || !shouldRetry(e)) throw e;
      await sleep(delayMs);
    }
  }
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;
  const noSleep = async () => {};

  describe("withRetry", () => {
    it("retries transient errors and returns the first success", async () => {
      const seen: number[] = [];
      const result = await withRetry(
        async (n) => {
          seen.push(n);
          if (n < 3) throw new Error("transient");
          return "ok";
        },
        () => true,
        2,
        0,
        noSleep,
      );
      expect(result).toBe("ok");
      expect(seen).toEqual([1, 2, 3]);
    });

    it("gives up after the retries and rethrows the last error", async () => {
      let calls = 0;
      await expect(
        withRetry(
          async (n) => {
            calls++;
            throw new Error(`fail ${n}`);
          },
          () => true,
          2,
          0,
          noSleep,
        ),
      ).rejects.toThrow("fail 3");
      expect(calls).toBe(3);
    });

    it("does not retry errors that are not transient", async () => {
      let calls = 0;
      await expect(
        withRetry(
          async () => {
            calls++;
            throw new Error("permanent");
          },
          () => false,
          2,
          0,
          noSleep,
        ),
      ).rejects.toThrow("permanent");
      expect(calls).toBe(1);
    });
  });
}
