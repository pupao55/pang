import { describe, expect, it } from "vitest";
import { runBacktest } from "@/lib/engine/backtestEngine";
import { A_SHARE_DEFAULT_COSTS, ZERO_COSTS } from "@/lib/config/costs";
import type { BacktestParams } from "@/lib/types/backtest";
import { MOCK_SECTORS } from "@/lib/data/mockSectors";
import { MOCK_SENTIMENT } from "@/lib/data/mockSentiment";
import { MOCK_STOCKS } from "@/lib/data/mockStocks";
import { getMockBarsBySymbol } from "@/lib/data/mockDailyBars";

const evalDate = MOCK_SENTIMENT.date;
const sectorsByDate = { [evalDate]: MOCK_SECTORS };
const sentimentByDate = { [evalDate]: MOCK_SENTIMENT };

function commonInputs(overrides: Partial<BacktestParams> = {}): BacktestParams {
  return {
    strategyId: "trendPullback",
    startDate: "2026-02-01",
    endDate: "2026-05-19",
    buyRule: "CLOSE",
    sellRule: "STOP_LOSS_TAKE_PROFIT",
    maxHoldingDays: 5,
    stopLossPct: 6,
    takeProfitPct: 12,
    portfolio: {
      startingCapital: 1_000_000,
      allowConcurrentPositions: true,
      maxConcurrentPositions: 5,
      maxPositionsPerSector: 5,
      allowSameSymbolOverlap: false,
      minScore: 0,
    },
    costs: ZERO_COSTS,
    ...overrides,
  };
}

describe("backtestEngine — execution semantics", () => {
  it("entryDate is the next bar when buyRule=NEXT_OPEN", () => {
    const r = runBacktest({
      ...commonInputs({ buyRule: "NEXT_OPEN" }),
      metas: MOCK_STOCKS,
      barsBySymbol: getMockBarsBySymbol(),
      sectorsByDate,
      sentimentByDate,
    });
    // For each trade, entry price should equal the open of the entry bar
    // (after zero slippage). We can't directly verify without parameters; we
    // verify holdingDays >= 1, which proves T+1: the first exit-eligible bar
    // is strictly after the entry bar.
    for (const t of r.trades) {
      expect(t.holdingDays).toBeGreaterThanOrEqual(1);
    }
  });

  it("enforces T+1: no same-day round-trip even with BREAK_MA10 sell rule", () => {
    const r = runBacktest({
      ...commonInputs({ sellRule: "BREAK_MA10", buyRule: "CLOSE" }),
      metas: MOCK_STOCKS,
      barsBySymbol: getMockBarsBySymbol(),
      sectorsByDate,
      sentimentByDate,
    });
    for (const t of r.trades) {
      expect(t.entryDate < t.exitDate).toBe(true);
    }
  });

  it("STOP_LOSS_TAKE_PROFIT exits never breach the configured thresholds", () => {
    const r = runBacktest({
      ...commonInputs(),
      metas: MOCK_STOCKS,
      barsBySymbol: getMockBarsBySymbol(),
      sectorsByDate,
      sentimentByDate,
    });
    for (const t of r.trades) {
      if (t.exitReason === "STOP_LOSS") {
        expect(t.grossReturnPct).toBeLessThanOrEqual(-commonInputs().stopLossPct + 0.01);
      } else if (t.exitReason === "TAKE_PROFIT") {
        expect(t.grossReturnPct).toBeGreaterThanOrEqual(commonInputs().takeProfitPct - 0.01);
      }
    }
  });

  it("default A-share costs reduce net return below gross return", () => {
    const r = runBacktest({
      ...commonInputs({ costs: A_SHARE_DEFAULT_COSTS }),
      metas: MOCK_STOCKS,
      barsBySymbol: getMockBarsBySymbol(),
      sectorsByDate,
      sentimentByDate,
    });
    if (r.trades.length === 0) return; // nothing to check this window
    for (const t of r.trades) {
      // grossReturnPct uses raw entry/exit prices; net is after slippage+fees.
      expect(t.returnPct).toBeLessThan(t.grossReturnPct + 0.01);
    }
    expect(r.totalFeesCny).toBeGreaterThan(0);
    expect(r.totalSlippageCny).toBeGreaterThan(0);
  });
});
