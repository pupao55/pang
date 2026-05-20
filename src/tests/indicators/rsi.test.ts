import { describe, expect, it } from "vitest";
import { calculateRSI } from "@/lib/indicators/rsi";

describe("calculateRSI", () => {
  it("returns NaN before warm-up completes", () => {
    const r = calculateRSI([1, 2, 3, 4], 5);
    expect(r.every((v) => Number.isNaN(v))).toBe(true);
  });

  it("returns 100 when there are no losses", () => {
    const r = calculateRSI([1, 2, 3, 4, 5, 6, 7, 8], 3);
    expect(r[r.length - 1]).toBe(100);
  });

  it("returns a value between 0 and 100 for mixed series", () => {
    const r = calculateRSI([10, 11, 10.5, 12, 11.5, 13, 12.5, 14, 13, 15], 5);
    const last = r[r.length - 1];
    expect(last).toBeGreaterThan(0);
    expect(last).toBeLessThan(100);
  });
});
