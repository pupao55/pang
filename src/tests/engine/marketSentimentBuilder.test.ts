import { describe, expect, it } from "vitest";
import {
  buildMarketSentiment,
  DEFAULT_SENTIMENT_CONFIG,
} from "@/lib/engine/marketSentimentBuilder";
import type { StockDailyBar, StockMeta } from "@/lib/types/stock";

function bar(symbol: string, date: string, close: number, prev?: number, override: Partial<StockDailyBar> = {}): StockDailyBar {
  const open = prev ? prev * 1.005 : close * 0.995;
  const high = Math.max(open, close) * 1.001;
  const low = Math.min(open, close) * 0.999;
  return {
    symbol,
    name: symbol,
    date,
    open,
    high,
    low,
    close,
    volume: 1000,
    amount: close * 1000,
    turnoverRate: 1,
    pctChange: prev ? +(((close - prev) / prev) * 100).toFixed(2) : 0,
    ...override,
  };
}

function meta(symbol: string, board: StockMeta["boardType"] = "MAIN"): StockMeta {
  return {
    symbol,
    name: symbol,
    exchange: "SH",
    boardType: board,
    industry: "",
    concepts: [],
    isST: false,
    marketCap: 0,
    floatMarketCap: 0,
  };
}

describe("buildMarketSentiment", () => {
  it("returns empty when no bars", () => {
    expect(buildMarketSentiment({ metas: [], barsBySymbol: {} })).toEqual([]);
  });

  it("counts limit-up closes per board threshold", () => {
    // MAIN 10cm. Two symbols, both rally +10% on day 2.
    const barsA = [
      bar("A.SH", "2024-01-02", 10),
      bar("A.SH", "2024-01-03", 11, 10), // +10% — LU
    ];
    const barsB = [
      bar("B.SH", "2024-01-02", 20),
      bar("B.SH", "2024-01-03", 22.1, 20), // +10.5% — LU
    ];
    const out = buildMarketSentiment({
      metas: [meta("A.SH"), meta("B.SH")],
      barsBySymbol: { "A.SH": barsA, "B.SH": barsB },
    });
    const d2 = out.find((s) => s.date === "2024-01-03")!;
    expect(d2.limitUpCount).toBe(2);
    expect(d2.limitDownCount).toBe(0);
  });

  it("classifies WEAK when limit-up count is low", () => {
    // 5 symbols, only 1 LU → below the default WEAK threshold of 15.
    const symbols = ["A", "B", "C", "D", "E"];
    const barsBySymbol: Record<string, StockDailyBar[]> = {};
    for (const s of symbols) {
      barsBySymbol[`${s}.SH`] = [
        bar(`${s}.SH`, "2024-01-02", 10),
        bar(`${s}.SH`, "2024-01-03", 10.05, 10), // flat
      ];
    }
    // Make A.SH a limit-up.
    barsBySymbol["A.SH"][1] = bar("A.SH", "2024-01-03", 11, 10);
    const out = buildMarketSentiment({
      metas: symbols.map((s) => meta(`${s}.SH`)),
      barsBySymbol,
    });
    expect(out[1].marketRegime).toBe("WEAK");
  });

  it("classifies PANIC when median return is sharply negative and limit-down count high", () => {
    // Construct cfg with low panic thresholds so test stays small.
    const symbols = Array.from({ length: 35 }, (_, i) => `S${i}.SH`);
    const barsBySymbol: Record<string, StockDailyBar[]> = {};
    for (const s of symbols) {
      barsBySymbol[s] = [
        bar(s, "2024-01-02", 100),
        bar(s, "2024-01-03", 90, 100), // -10% — limit-down
      ];
    }
    const out = buildMarketSentiment({
      metas: symbols.map((s) => meta(s)),
      barsBySymbol,
      config: {
        regimeThresholds: {
          ...DEFAULT_SENTIMENT_CONFIG.regimeThresholds,
          panicMedianReturnPct: -3,
          panicLimitDownCount: 20,
        },
      },
    });
    expect(out[1].marketRegime).toBe("PANIC");
  });

  it("derives indexTrend from universe median", () => {
    const barsBySymbol = {
      "A.SH": [bar("A.SH", "2024-01-02", 10), bar("A.SH", "2024-01-03", 10.5, 10)],
      "B.SH": [bar("B.SH", "2024-01-02", 10), bar("B.SH", "2024-01-03", 10.4, 10)],
    };
    const out = buildMarketSentiment({
      metas: [meta("A.SH"), meta("B.SH")],
      barsBySymbol,
    });
    expect(out[1].indexTrend).toBe("UP");
  });

  it("computes yesterdayLimitUpPerformance from the prior cohort", () => {
    // Day 2: A LU. Day 3: A rallies further +5%. Day 3 sentiment.yPerf should be +5%.
    const barsA = [
      bar("A.SH", "2024-01-02", 10),
      bar("A.SH", "2024-01-03", 11, 10), // +10% LU
      bar("A.SH", "2024-01-04", 11.55, 11), // +5%
    ];
    const out = buildMarketSentiment({
      metas: [meta("A.SH")],
      barsBySymbol: { "A.SH": barsA },
    });
    const d3 = out.find((s) => s.date === "2024-01-04")!;
    expect(d3.yesterdayLimitUpPerformance).toBeCloseTo(5, 1);
  });
});
