import { describe, expect, it } from "vitest";
import { SCORE_WEIGHTS } from "@/lib/config/constants";

describe("SCORE_WEIGHTS invariant", () => {
  it("sums to 1.0", () => {
    const sum = Object.values(SCORE_WEIGHTS).reduce((s, v) => s + v, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });
});
