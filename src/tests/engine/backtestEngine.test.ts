import { describe, expect, it } from "vitest";
import { runBacktest } from "@/lib/engine/backtestEngine";
import { getMockBarsBySymbol } from "@/lib/data/mockDailyBars";
import { MOCK_SECTORS } from "@/lib/data/mockSectors";
import { MOCK_STOCKS } from "@/lib/data/mockStocks";

describe("backtestEngine", () => {
  const base = {
    metas: MOCK_STOCKS,
    barsBySymbol: getMockBarsBySymbol(),
    sectors: MOCK_SECTORS,
    startDate: "2026-02-01",
    endDate: "2026-05-19",
    maxHoldingDays: 5,
    stopLossPct: 6,
    takeProfitPct: 10,
  } as const;

  it("returns a result for a known strategy with no signals as gracefully empty", () => {
    const r = runBacktest({
      ...base,
      strategyId: "trendPullback",
      buyRule: "CLOSE",
      sellRule: "STOP_LOSS_TAKE_PROFIT",
    });
    expect(r.strategyId).toBe("trendPullback");
    expect(Array.isArray(r.trades)).toBe(true);
    expect(r.equityCurve.length).toBeGreaterThan(0);
  });

  it("throws on unknown strategy id", () => {
    expect(() =>
      runBacktest({
        ...base,
        strategyId: "nope",
        buyRule: "CLOSE",
        sellRule: "FIXED_DAYS",
      }),
    ).toThrow(/Unknown strategy/);
  });

  it("respects FIXED_DAYS sell rule by closing within maxHoldingDays", () => {
    const r = runBacktest({
      ...base,
      strategyId: "trendPullback",
      buyRule: "CLOSE",
      sellRule: "FIXED_DAYS",
      maxHoldingDays: 3,
    });
    for (const t of r.trades) {
      // Allow PERIOD_END escape clause for the last open trade.
      if (t.exitReason !== "PERIOD_END") {
        expect(t.holdingDays).toBeLessThanOrEqual(3);
      }
    }
  });
});
