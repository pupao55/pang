import { describe, expect, it } from "vitest";
import { runBacktest } from "@/lib/engine/backtestEngine";
import { ZERO_COSTS } from "@/lib/config/costs";
import type { BacktestParams } from "@/lib/types/backtest";
import { MOCK_SECTORS } from "@/lib/data/mockSectors";
import { MOCK_SENTIMENT } from "@/lib/data/mockSentiment";
import { MOCK_STOCKS } from "@/lib/data/mockStocks";
import { getMockBarsBySymbol } from "@/lib/data/mockDailyBars";

const evalDate = MOCK_SENTIMENT.date;
const sectorsByDate = { [evalDate]: MOCK_SECTORS };
const sentimentByDate = { [evalDate]: MOCK_SENTIMENT };

function base(overrides: Partial<BacktestParams> = {}): BacktestParams {
  return {
    strategyId: "trendPullback",
    startDate: "2026-02-01",
    endDate: "2026-05-19",
    buyRule: "NEXT_OPEN",
    sellRule: "STOP_LOSS_TAKE_PROFIT",
    maxHoldingDays: 5,
    stopLossPct: 6,
    takeProfitPct: 12,
    portfolio: {
      startingCapital: 1_000_000,
      allowConcurrentPositions: true,
      maxConcurrentPositions: 5,
      maxPositionsPerSector: 2,
      allowSameSymbolOverlap: false,
      minScore: 0,
    },
    costs: ZERO_COSTS,
    ...overrides,
  };
}

describe("backtestEngine — portfolio caps", () => {
  it("never holds more than maxConcurrentPositions", () => {
    const r = runBacktest({
      ...base({ portfolio: { ...base().portfolio!, maxConcurrentPositions: 2 } }),
      metas: MOCK_STOCKS,
      barsBySymbol: getMockBarsBySymbol(),
      sectorsByDate,
      sentimentByDate,
    });
    for (const p of r.equityCurve) {
      expect(p.positionCount ?? 0).toBeLessThanOrEqual(2);
    }
  });

  it("never holds more than maxPositionsPerSector per sector", () => {
    const r = runBacktest({
      ...base({
        portfolio: { ...base().portfolio!, maxPositionsPerSector: 1, maxConcurrentPositions: 5 },
      }),
      metas: MOCK_STOCKS,
      barsBySymbol: getMockBarsBySymbol(),
      sectorsByDate,
      sentimentByDate,
    });
    // Reconstruct concurrent sector counts from trade entry/exit pairs.
    const events: { date: string; sector: string; delta: number }[] = [];
    for (const t of r.trades) {
      events.push({ date: t.entryDate, sector: t.sector ?? "unknown", delta: +1 });
      events.push({ date: t.exitDate, sector: t.sector ?? "unknown", delta: -1 });
    }
    events.sort((a, b) => a.date.localeCompare(b.date));
    const sectorCounts = new Map<string, number>();
    for (const e of events) {
      sectorCounts.set(e.sector, (sectorCounts.get(e.sector) ?? 0) + e.delta);
      expect(sectorCounts.get(e.sector)).toBeLessThanOrEqual(1);
    }
  });

  it("does not overlap same symbol when allowSameSymbolOverlap=false", () => {
    const r = runBacktest({
      ...base(),
      metas: MOCK_STOCKS,
      barsBySymbol: getMockBarsBySymbol(),
      sectorsByDate,
      sentimentByDate,
    });
    const bySymbol = new Map<string, { entry: string; exit: string }[]>();
    for (const t of r.trades) {
      (bySymbol.get(t.symbol) ?? bySymbol.set(t.symbol, []).get(t.symbol)!).push({
        entry: t.entryDate,
        exit: t.exitDate,
      });
    }
    for (const [, list] of bySymbol) {
      list.sort((a, b) => a.entry.localeCompare(b.entry));
      for (let i = 1; i < list.length; i++) {
        // entry of next must be strictly after exit of prior (no overlap).
        expect(list[i].entry > list[i - 1].exit).toBe(true);
      }
    }
  });

  it("excludes FORBIDDEN-risk symbols from trades", () => {
    const r = runBacktest({
      ...base({ strategyId: "limitUpSecondBuy" }),
      metas: MOCK_STOCKS,
      barsBySymbol: getMockBarsBySymbol(),
      sectorsByDate,
      sentimentByDate,
    });
    expect(r.trades.some((t) => t.symbol === "000707")).toBe(false);
  });
});
