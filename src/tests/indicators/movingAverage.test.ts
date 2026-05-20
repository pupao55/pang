import { describe, expect, it } from "vitest";
import { calculateMA } from "@/lib/indicators/movingAverage";

describe("calculateMA", () => {
  it("returns NaN for warm-up indices", () => {
    const ma = calculateMA([1, 2, 3, 4, 5], 3);
    expect(Number.isNaN(ma[0])).toBe(true);
    expect(Number.isNaN(ma[1])).toBe(true);
    expect(ma[2]).toBeCloseTo(2);
    expect(ma[3]).toBeCloseTo(3);
    expect(ma[4]).toBeCloseTo(4);
  });

  it("handles arrays shorter than period", () => {
    const ma = calculateMA([1, 2], 5);
    expect(ma.every((v) => Number.isNaN(v))).toBe(true);
  });

  it("computes rolling mean correctly", () => {
    const ma = calculateMA([10, 20, 30, 40, 50, 60], 2);
    expect(ma[1]).toBe(15);
    expect(ma[5]).toBe(55);
  });

  it("throws on non-positive period", () => {
    expect(() => calculateMA([1, 2, 3], 0)).toThrow();
  });
});
