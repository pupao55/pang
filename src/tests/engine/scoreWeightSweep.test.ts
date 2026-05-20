import { describe, expect, it } from "vitest";
import {
  enumerateWeightSets,
  runScoreWeightSweep,
} from "@/lib/engine/scoreWeightSweep";
import {
  makeBarBasedResolver,
  type HistoricalSignalRecord,
} from "@/lib/engine/scoreCalibration";
import type { StockDailyBar } from "@/lib/types/stock";

describe("enumerateWeightSets", () => {
  it("every weight set sums to 1.0", () => {
    const sets = enumerateWeightSets();
    expect(sets.length).toBeGreaterThan(0);
    for (const w of sets) {
      const sum =
        w.technical + w.sector + w.sentiment + w.liquidity + w.fundamentalSafety;
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    }
  });

  it("returns nothing when the grid cannot sum to 1", () => {
    const empty = enumerateWeightSets({
      technical: [0.9],
      sector: [0.9],
      sentiment: [0.9],
      liquidity: [0.9],
      fundamentalSafety: [0.9],
    });
    expect(empty.length).toBe(0);
  });
});

function bars(prices: number[], symbol = "T"): StockDailyBar[] {
  return prices.map((p, i) => ({
    symbol,
    name: symbol,
    date: `2024-02-${String(i + 1).padStart(2, "0")}`,
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

function rec(
  date: string,
  score: { tech: number; sec: number; sen: number; liq: number; fund: number },
  penalty = 0,
): HistoricalSignalRecord {
  return {
    date,
    symbol: "T",
    strategyId: "demo",
    score: 0, // recomputed by sweep
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
    technicalScore: score.tech,
    sectorScore: score.sec,
    sentimentScore: score.sen,
    liquidityScore: score.liq,
    fundamentalSafetyScore: score.fund,
    riskPenalty: penalty,
  };
}

describe("runScoreWeightSweep", () => {
  it("warns when no records carry component scores", () => {
    const resolver = makeBarBasedResolver({});
    const out = runScoreWeightSweep(
      [
        {
          date: "2024-01-01",
          symbol: "T",
          strategyId: "demo",
          score: 80,
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
        },
      ],
      resolver,
    );
    expect(out.evaluated).toBe(0);
    expect(out.warning).toContain("component scores");
  });

  it("ranks weight sets by composite calibrationScore", () => {
    // Build a synthetic up-trend; every signal has positive forward returns.
    // High-tech-score records get high tech, low everything else; the sweep
    // should prefer technical-heavy weights for the top bucket.
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i);
    const resolver = makeBarBasedResolver({ T: bars(prices) });
    const records: HistoricalSignalRecord[] = [];
    for (let i = 0; i < 60; i++) {
      const date = `2024-02-${String((i % 25) + 1).padStart(2, "0")}`;
      const techVal = i < 30 ? 90 : 50;
      records.push(
        rec(date, { tech: techVal, sec: 50, sen: 50, liq: 50, fund: 50 }),
      );
    }
    const out = runScoreWeightSweep(records, resolver);
    expect(out.best5dWeights).toBeDefined();
    // Best 5d set should have technical >= sector since technical separates buckets.
    expect(out.best5dWeights!.weights.technical).toBeGreaterThanOrEqual(
      out.best5dWeights!.weights.sector,
    );
    expect(out.best5dWeights!.calibrationScore).toBeGreaterThan(0);
  });
});
