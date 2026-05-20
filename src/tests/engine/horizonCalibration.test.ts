import { describe, expect, it } from "vitest";
import {
  calibrateHorizons,
  classifyHorizonProfile,
  type HorizonStat,
} from "@/lib/engine/horizonCalibration";
import {
  makeBarBasedResolver,
  type HistoricalSignalRecord,
} from "@/lib/engine/scoreCalibration";
import type { StockDailyBar } from "@/lib/types/stock";

function bars(prices: number[], symbol = "TEST"): StockDailyBar[] {
  return prices.map((p, i) => ({
    symbol,
    name: symbol,
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

function baseStat(): HorizonStat {
  return {
    signalCount: 100,
    avgReturn1d: 0,
    avgReturn2d: 0,
    avgReturn3d: 0,
    avgReturn5d: 0,
    avgReturn10d: 0,
    winRate1d: 0.5,
    winRate2d: 0.5,
    winRate3d: 0.5,
    winRate5d: 0.5,
    winRate10d: 0.5,
    bestHorizon: "none",
    worstHorizon: "none",
    horizonProfile: "INCONCLUSIVE",
  };
}

describe("classifyHorizonProfile", () => {
  it("returns INCONCLUSIVE for small samples", () => {
    expect(
      classifyHorizonProfile({ ...baseStat(), signalCount: 29 }),
    ).toBe("INCONCLUSIVE");
  });

  it("flags MEAN_REVERTS_AFTER_1D when 1d strong but 5d negative", () => {
    const v = classifyHorizonProfile({
      ...baseStat(),
      avgReturn1d: 3,
      avgReturn3d: 1,
      avgReturn5d: -2,
      winRate1d: 0.62,
      winRate3d: 0.51,
      winRate5d: 0.45,
    });
    expect(v).toBe("MEAN_REVERTS_AFTER_1D");
  });

  it("flags MOMENTUM_1D when 1d strong and 5d flat", () => {
    const v = classifyHorizonProfile({
      ...baseStat(),
      avgReturn1d: 2,
      avgReturn3d: 1.2,
      avgReturn5d: 1.6,
      winRate1d: 0.62,
      winRate3d: 0.5,
      winRate5d: 0.48,
    });
    expect(v).toBe("MOMENTUM_1D");
  });

  it("flags SWING_5D when 5d edge is the strongest", () => {
    const v = classifyHorizonProfile({
      ...baseStat(),
      avgReturn1d: 0.3,
      avgReturn3d: 0.8,
      avgReturn5d: 2.2,
      winRate1d: 0.52,
      winRate3d: 0.55,
      winRate5d: 0.58,
    });
    expect(v).toBe("SWING_5D");
  });

  it("flags NO_EDGE when no horizon shows acceptable edge", () => {
    const v = classifyHorizonProfile({
      ...baseStat(),
      avgReturn1d: -0.5,
      avgReturn3d: -0.4,
      avgReturn5d: -0.2,
      winRate1d: 0.45,
      winRate3d: 0.46,
      winRate5d: 0.48,
    });
    expect(v).toBe("NO_EDGE");
  });
});

describe("calibrateHorizons", () => {
  it("computes per-strategy + per-bucket profiles", () => {
    // Build a monotonic up-trend so all forward returns are positive.
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i);
    const resolver = makeBarBasedResolver({ AAA: bars(prices, "AAA") });
    const records: HistoricalSignalRecord[] = [];
    for (let i = 0; i < 15; i++) {
      records.push({
        date: `2024-01-${String(i + 1).padStart(2, "0")}`,
        symbol: "AAA",
        strategyId: "demo",
        score: 85,
        riskLevel: "LOW",
        signalType: "BREAKOUT",
        suggestedAction: "STANDARD_POSITION",
        keySupport: 0,
        keyResistance: 0,
        stopLoss: 0,
        target1: 0,
        target2: 0,
        explanation: [],
        risks: [],
      });
    }
    const result = calibrateHorizons(records, resolver);
    expect(result.overall.signalCount).toBe(15);
    expect(result.perStrategy[0].key).toBe("demo");
    expect(result.perScoreBucket[0].key).toBe("80-90");
    // Up-trend → bestHorizon should be 10d (highest cumulative).
    expect(result.overall.bestHorizon).toBe("10d");
  });
});
