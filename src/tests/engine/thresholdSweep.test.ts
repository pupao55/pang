import { describe, expect, it } from "vitest";
import { runThresholdSweep } from "@/lib/engine/thresholdSweep";
import {
  makeBarBasedResolver,
  type HistoricalSignalRecord,
} from "@/lib/engine/scoreCalibration";
import type { StockDailyBar } from "@/lib/types/stock";

function bars(prices: number[], symbol: string): StockDailyBar[] {
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

function rec(
  date: string,
  symbol: string,
  score: number,
  risk: "LOW" | "MEDIUM" | "HIGH",
): HistoricalSignalRecord {
  return {
    date,
    symbol,
    strategyId: "x",
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

describe("runThresholdSweep", () => {
  it("emits a cartesian product of (minScores × maxRisks × windows)", () => {
    const up = bars(Array.from({ length: 30 }, (_, i) => 100 + i), "X");
    const r = makeBarBasedResolver({ X: up });
    const signals = Array.from({ length: 10 }, (_, i) =>
      rec(up[i].date, "X", 75, "LOW"),
    );
    const out = runThresholdSweep(signals, r);
    // 7 minScores × 3 risk × 4 windows = 84 cells
    expect(out.cells.length).toBe(84);
  });

  it("respects minScore filter", () => {
    const up = bars(Array.from({ length: 30 }, (_, i) => 100 + i), "X");
    const r = makeBarBasedResolver({ X: up });
    const signals = [
      rec(up[0].date, "X", 55, "LOW"),
      rec(up[1].date, "X", 85, "LOW"),
    ];
    const out = runThresholdSweep(signals, r, {
      minScores: [60],
      maxRiskLevels: ["LOW_ONLY"],
      holdingWindows: [1],
    });
    expect(out.cells[0].signalCount).toBe(1); // only score=85 passes minScore=60
  });

  it("respects maxRiskLevel filter", () => {
    const up = bars(Array.from({ length: 30 }, (_, i) => 100 + i), "X");
    const r = makeBarBasedResolver({ X: up });
    const signals = [
      rec(up[0].date, "X", 70, "LOW"),
      rec(up[1].date, "X", 70, "MEDIUM"),
      rec(up[2].date, "X", 70, "HIGH"),
    ];
    const cells = runThresholdSweep(signals, r, {
      minScores: [50],
      maxRiskLevels: ["LOW_ONLY", "LOW_MEDIUM", "LOW_MEDIUM_HIGH"],
      holdingWindows: [1],
    }).cells;
    expect(cells.find((c) => c.maxRiskLevel === "LOW_ONLY")!.signalCount).toBe(1);
    expect(cells.find((c) => c.maxRiskLevel === "LOW_MEDIUM")!.signalCount).toBe(2);
    expect(cells.find((c) => c.maxRiskLevel === "LOW_MEDIUM_HIGH")!.signalCount).toBe(3);
  });

  it("picks bestOverall with the highest risk-adjusted score (n≥30)", () => {
    const up = bars(Array.from({ length: 100 }, (_, i) => 100 + i * 0.5), "X");
    const r = makeBarBasedResolver({ X: up });
    const signals = Array.from({ length: 60 }, (_, i) =>
      rec(up[i].date, "X", 75, "LOW"),
    );
    const out = runThresholdSweep(signals, r);
    expect(out.bestOverall).toBeDefined();
    expect(out.bestOverall!.signalCount).toBeGreaterThanOrEqual(30);
  });
});
