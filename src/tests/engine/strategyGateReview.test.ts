import { describe, expect, it } from "vitest";
import { reviewFirstBreakoutGates } from "@/lib/engine/strategyGateReview";
import type { StockDailyBar, StockMeta } from "@/lib/types/stock";

function bar(
  date: string,
  close: number,
  amount: number,
  turnover: number,
): StockDailyBar {
  return {
    symbol: "X",
    name: "X",
    date,
    open: close,
    high: close,
    low: close,
    close,
    volume: amount,
    amount,
    turnoverRate: turnover,
    pctChange: 0,
  };
}

function meta(symbol: string): StockMeta {
  return {
    symbol,
    name: symbol,
    exchange: "SH",
    boardType: "MAIN",
    industry: "Test",
    concepts: [],
    isST: false,
    marketCap: 10_000_000_000,
    floatMarketCap: 8_000_000_000,
  };
}

function makeUniverse(): {
  metas: StockMeta[];
  barsBySymbol: Record<string, StockDailyBar[]>;
} {
  // 70 days of flat-trending bars so platform breakout, history, and the
  // 60-day cap can all kick in. Pattern: flat until day 65, big breakout day 66
  // with amount + turnover blow-out.
  const bars: StockDailyBar[] = [];
  for (let i = 0; i < 70; i++) {
    const date = `2024-${String(Math.floor(i / 30) + 1).padStart(2, "0")}-${String((i % 30) + 1).padStart(2, "0")}`;
    if (i < 65) bars.push(bar(date, 10, 1_000_000, 1));
    else bars.push(bar(date, 12, 5_000_000, 4)); // breakout w/ amount+turnover expand
  }
  return {
    metas: [meta("X")],
    barsBySymbol: { X: bars },
  };
}

describe("reviewFirstBreakoutGates", () => {
  it("counts gate rejections and finds at least one passing candidate", () => {
    const u = makeUniverse();
    const review = reviewFirstBreakoutGates({
      metas: u.metas,
      barsBySymbol: u.barsBySymbol,
      sectorSnapshotsByDate: new Map(),
    });
    expect(review.counts.entered.totalCandidates).toBeGreaterThan(0);
    // Every gate key should be present in rejectionRate.
    expect(Object.keys(review.rejectionRate)).toEqual(
      expect.arrayContaining([
        "sixtyDayRiseCap",
        "platformBreakout",
        "volumeExpansion",
        "turnoverExpansion",
        "sectorStrength",
      ]),
    );
    expect(typeof review.likelyTooStrict).toBe("boolean");
    expect(review.suggestedRelaxation.length).toBeGreaterThan(0);
  });

  it("flags likelyTooStrict when no candidate ever passes", () => {
    // Synthetic universe where platformBreakout always fails (close never > prior high).
    const bars: StockDailyBar[] = [];
    for (let i = 0; i < 70; i++) {
      const date = `2024-${String(Math.floor(i / 30) + 1).padStart(2, "0")}-${String((i % 30) + 1).padStart(2, "0")}`;
      bars.push(bar(date, 10, 1_000_000, 1));
    }
    const review = reviewFirstBreakoutGates({
      metas: [meta("Y")],
      barsBySymbol: { Y: bars },
      sectorSnapshotsByDate: new Map(),
    });
    expect(review.likelyTooStrict).toBe(true);
    expect(review.weakestGate).toBe("platformBreakout");
  });
});
