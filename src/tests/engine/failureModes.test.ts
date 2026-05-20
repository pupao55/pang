import { describe, expect, it } from "vitest";
import { buildFailureModes } from "@/lib/engine/failureModes";
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
  strategyId: string,
  risk: "LOW" | "HIGH" = "LOW",
  risks: string[] = ["低流动性"],
  score = 75,
): HistoricalSignalRecord {
  return {
    date,
    symbol,
    strategyId,
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
    risks,
  };
}

describe("buildFailureModes", () => {
  // 5d drop: start 100, end 95 -> -5%
  const down = bars(
    Array.from({ length: 30 }, (_, i) => 100 - i * 1),
    "300750.SZ",
  );
  const resolver = makeBarBasedResolver({ "300750.SZ": down });

  it("only groups losing signals (forward 5d < 0)", () => {
    const signals = [
      rec(down[0].date, "300750.SZ", "alpha"),
      rec(down[1].date, "300750.SZ", "alpha"),
    ];
    const fm = buildFailureModes(signals, resolver);
    expect(fm.byStrategy[0].key).toBe("alpha");
    expect(fm.byStrategy[0].count).toBe(2);
    expect(fm.byStrategy[0].worstLossPct).toBeLessThan(0);
  });

  it("aggregates top risk reasons across losing signals", () => {
    const signals = [
      rec(down[0].date, "300750.SZ", "alpha", "LOW", ["低流动性", "市场退潮"]),
      rec(down[1].date, "300750.SZ", "alpha", "LOW", ["低流动性"]),
    ];
    const fm = buildFailureModes(signals, resolver);
    expect(fm.byStrategy[0].topReasons[0]).toEqual({
      reason: "低流动性",
      count: 2,
    });
  });

  it("infers boardType from symbol prefix", () => {
    const signals = [
      rec(down[0].date, "300750.SZ", "alpha"), // CHINEXT
      rec(down[1].date, "300750.SZ", "alpha"),
    ];
    const fm = buildFailureModes(signals, resolver);
    expect(fm.byBoardType[0].key).toBe("CHINEXT");
  });

  it("buckets by score correctly", () => {
    const signals = [
      rec(down[0].date, "300750.SZ", "a", "LOW", [], 95),
      rec(down[1].date, "300750.SZ", "a", "LOW", [], 65),
    ];
    const fm = buildFailureModes(signals, resolver);
    const keys = fm.byScoreBucket.map((g) => g.key);
    expect(keys).toContain("90-100");
    expect(keys).toContain("60-70");
  });
});
