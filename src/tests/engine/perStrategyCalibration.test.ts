import { describe, expect, it } from "vitest";
import { buildPerStrategyCalibration } from "@/lib/engine/perStrategyCalibration";
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

function sig(
  date: string,
  symbol: string,
  strategyId: string,
  score = 75,
): HistoricalSignalRecord {
  return {
    date,
    symbol,
    strategyId,
    score,
    riskLevel: "LOW",
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

describe("buildPerStrategyCalibration", () => {
  it("groups by strategyId and emits per-strategy verdicts", () => {
    const series = bars(Array.from({ length: 60 }, (_, i) => 100 + i * 0.1), "X");
    const resolver = makeBarBasedResolver({ X: series });
    const signals: HistoricalSignalRecord[] = [];
    for (let i = 0; i < 40; i++) signals.push(sig(series[i].date, "X", "alpha"));
    for (let i = 0; i < 40; i++) signals.push(sig(series[i].date, "X", "beta"));
    const out = buildPerStrategyCalibration(signals, resolver);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.strategyId).sort()).toEqual(["alpha", "beta"]);
    for (const r of out) {
      expect(r.signalCount).toBe(40);
      expect(["CALIBRATED", "NOT_CALIBRATED", "INCONCLUSIVE"]).toContain(r.calibrationVerdict);
      expect(["IMPROVES", "NO_IMPROVEMENT", "INCONCLUSIVE"]).toContain(r.riskVerdict);
    }
  });

  it("recommends NEEDS_MORE_DATA when a strategy has few signals", () => {
    const series = bars(Array.from({ length: 20 }, (_, i) => 100 + i * 0.1), "X");
    const resolver = makeBarBasedResolver({ X: series });
    const signals = Array.from({ length: 5 }, (_, i) =>
      sig(series[i].date, "X", "tiny"),
    );
    const out = buildPerStrategyCalibration(signals, resolver);
    expect(out[0].overall).toBe("NEEDS_MORE_DATA");
  });
});
