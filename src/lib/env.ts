/** Parse an integer env var within [min, max]; fall back to `def` when unset or invalid. */
export function intEnv(name: string, def: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return def;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
}

/**
 * Make text safe to print in GitHub Actions logs: collapse newlines so no line
 * can start with a `::` workflow command, and break up any `::` sequences.
 */
export function sanitizeLog(s: string): string {
  return s
    .replace(/[\r\n\u2028\u2029]+/g, " ⏎ ")
    .replace(/::/g, ": :")
    .slice(0, 2000);
}

export function logSafe(s: string): void {
  console.log(sanitizeLog(s));
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  describe("intEnv", () => {
    it("validates range and falls back", () => {
      process.env.T_INT = "5";
      expect(intEnv("T_INT", 1, 1, 10)).toBe(5);
      process.env.T_INT = "abc";
      expect(intEnv("T_INT", 1, 1, 10)).toBe(1);
      process.env.T_INT = "99";
      expect(intEnv("T_INT", 1, 1, 10)).toBe(1);
      process.env.T_INT = "2.5";
      expect(intEnv("T_INT", 1, 1, 10)).toBe(1);
      delete process.env.T_INT;
      expect(intEnv("T_INT", 3, 1, 10)).toBe(3);
    });
  });

  describe("sanitizeLog", () => {
    it("neutralizes workflow commands", () => {
      const out = sanitizeLog("ok\n::add-mask::x\r\n::error::fake");
      expect(out).not.toMatch(/[\r\n]/);
      expect(out).not.toContain("::");
    });
  });
}
