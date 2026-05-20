import { describe, expect, it } from "vitest";
import { classifySectorLeaderRecommendation } from "@/lib/engine/sectorLeaderTuning";

describe("classifySectorLeaderRecommendation", () => {
  it("returns TOO_SPARSE when n < 50", () => {
    expect(
      classifySectorLeaderRecommendation({
        signalCount: 30,
        avgReturn1d: 2,
        avgReturn3d: 2,
        avgReturn5d: 2,
        winRate1d: 0.6,
        winRate3d: 0.6,
        winRate5d: 0.6,
      }),
    ).toBe("TOO_SPARSE");
  });

  it("returns TOO_BROAD when n > 8000", () => {
    expect(
      classifySectorLeaderRecommendation({
        signalCount: 12000,
        avgReturn1d: 0.5,
        avgReturn3d: 0.5,
        avgReturn5d: 0.5,
        winRate1d: 0.55,
        winRate3d: 0.55,
        winRate5d: 0.55,
      }),
    ).toBe("TOO_BROAD");
  });

  it("returns KEEP_VARIANT when 5d edge meets the bar", () => {
    expect(
      classifySectorLeaderRecommendation({
        signalCount: 500,
        avgReturn1d: 0.4,
        avgReturn3d: 0.6,
        avgReturn5d: 1.2,
        winRate1d: 0.51,
        winRate3d: 0.53,
        winRate5d: 0.55,
      }),
    ).toBe("KEEP_VARIANT");
  });

  it("returns NO_EDGE when avg + win never clear the bar", () => {
    expect(
      classifySectorLeaderRecommendation({
        signalCount: 500,
        avgReturn1d: 0.1,
        avgReturn3d: -0.2,
        avgReturn5d: -0.4,
        winRate1d: 0.48,
        winRate3d: 0.47,
        winRate5d: 0.45,
      }),
    ).toBe("NO_EDGE");
  });
});
