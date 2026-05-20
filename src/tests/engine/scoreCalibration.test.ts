import { describe, expect, it } from "vitest";
import {
  calibrateScores,
  makeBarBasedResolver,
  type HistoricalSignalRecord,
} from "@/lib/engine/scoreCalibration";
import type { StockDailyBar } from "@/lib/types/stock";

function bars(prices: number[]): StockDailyBar[] {
  return prices.map((p, i) => ({
    symbol: "X",
    name: "X",
    date: `2024-01-${String(i + 1).padStart(2, "0")}`,
    open: p,
    high: p,
    low: p,
    close: p,
    volume: 1,
    amount: p,
    turnoverRate: 1,
    pctChange: 0,
  }));
}

function signal(date: string, score: number, risk: "LOW" | "HIGH"): HistoricalSignalRecord {
  return {
    date,
    symbol: "X",
    strategyId: "s",
    score,
    riskLevel: risk,
    signalType: "BREAKOUT",
    suggestedAction: "WATCH",
    keySupport: 0,
    keyResistance: 0,
    stopLoss: 0,
    target1: 0,
    target2: 0,
    explanation: [],
    risks: [],
  };
}

describe("calibrateScores", () => {
  it("higher-score buckets outperform when data supports it", () => {
    // Two signals on the same series; high score on a day that rallies more.
    const seriesUp = bars([
      10, 10.1, 10.2, 10.3, 10.4, 10.6, 10.9, 11.3, 11.7, 12.0, 12.4, 12.8, 13.2, 13.6, 14.0,
    ]);
    const seriesFlat = bars([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
    const r = makeBarBasedResolver({ X: seriesUp, Y: seriesFlat });
    const high = signal("2024-01-01", 95, "LOW");
    high.symbol = "X";
    const low = signal("2024-01-01", 55, "LOW");
    low.symbol = "Y";
    const res = calibrateScores([high, low], r);
    const top = res.buckets.find((b) => b.bucket === "90-100")!;
    const bottom = res.buckets.find((b) => b.bucket === "<60")!;
    expect(top.avgR5).toBeGreaterThan(bottom.avgR5);
    // Verdict is INCONCLUSIVE with so few samples per bucket (gated at 30+);
    // bucket comparison itself is still valid. See calibrationVerdict.test.ts
    // for the verdict logic with adequate sample sizes.
    expect(res.verdict).toBe("INCONCLUSIVE");
  });

  it("buckets the math correctly even when high scores under-perform", () => {
    // Invert: high score on flat series, low score on rallying series.
    const seriesUp = bars([10, 10.5, 11.0, 11.5, 12.0, 12.5, 13.0, 13.5]);
    const seriesFlat = bars([10, 10, 10, 10, 10, 10, 10, 10]);
    const r = makeBarBasedResolver({ HI: seriesFlat, LO: seriesUp });
    const high = signal("2024-01-01", 95, "LOW");
    high.symbol = "HI";
    const low = signal("2024-01-01", 55, "LOW");
    low.symbol = "LO";
    const res = calibrateScores([high, low], r);
    // With only 1 signal per bucket the verdict gating fires INCONCLUSIVE
    // before the monotonicity warning. The bucket numbers should still show
    // the inversion.
    expect(res.verdict).toBe("INCONCLUSIVE");
    expect(res.warning).toBeDefined();
    const top = res.buckets.find((b) => b.bucket === "90-100")!;
    const bottom = res.buckets.find((b) => b.bucket === "<60")!;
    expect(top.avgR5).toBeLessThan(bottom.avgR5);
  });
});
