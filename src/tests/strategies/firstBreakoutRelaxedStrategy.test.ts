import { describe, expect, it } from "vitest";
import {
  firstBreakoutRelaxedStrategy,
  FIRST_BREAKOUT_RELAXED_LOOKBACK,
  FIRST_BREAKOUT_RELAXED_NEAR_RATIO,
} from "@/lib/strategies/firstBreakoutRelaxedStrategy";
import { firstBreakoutStrategy } from "@/lib/strategies/firstBreakoutStrategy";
import { STRATEGY_LIST } from "@/lib/strategies";
import {
  EXPERIMENTAL_STRATEGIES,
  experimentalStrategiesEnabled,
} from "@/lib/strategies/experimental";
import type { StockDailyBar, StockMeta } from "@/lib/types/stock";
import type { StrategyContext } from "@/lib/strategies/types";
import type { SectorSnapshot } from "@/lib/types/market";

function bar(date: string, close: number, amount = 1_000_000, turnover = 1): StockDailyBar {
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

function dateAt(i: number): string {
  // 2024-01-01 + i trading days (calendar approximation good enough for tests)
  const base = new Date("2024-01-01T00:00:00Z");
  const d = new Date(base.getTime() + i * 86400000);
  return d.toISOString().slice(0, 10);
}

const META: StockMeta = {
  symbol: "X",
  name: "X",
  exchange: "SH",
  boardType: "MAIN",
  industry: "Test",
  concepts: [],
  isST: false,
  marketCap: 10_000_000_000,
  floatMarketCap: 8_000_000_000,
};

const FRIENDLY_SECTOR: SectorSnapshot = {
  date: "2024-03-15",
  sectorName: "Test",
  pctChange: 1,
  limitUpCount: 0,
  topStocks: ["X"],
  strengthRank: 1,
  momentumScore: 70,
};

/**
 * Build a 70-bar series where the previous 30/40-day platform high is
 * `platformHigh`. The last bar's close + volume/turnover are tunable so we
 * can test "near breakout" vs "above breakout" cleanly.
 */
function makeBars({
  platformHigh,
  lastClose,
  amountMult = 2,
  turnoverMult = 2,
}: {
  platformHigh: number;
  lastClose: number;
  amountMult?: number;
  turnoverMult?: number;
}): StockDailyBar[] {
  const bars: StockDailyBar[] = [];
  // 60 flat bars at price = platformHigh * 0.95 so the 60-day rise gate passes.
  for (let i = 0; i < 60; i++) {
    bars.push(bar(dateAt(i), platformHigh * 0.95, 1_000_000, 1));
  }
  // Bars 60-69: at platformHigh, providing the high reference for the lookback.
  for (let i = 60; i < 69; i++) {
    bars.push(bar(dateAt(i), platformHigh, 1_000_000, 1));
  }
  // Last bar (index 69): close = lastClose with amount + turnover blow-out.
  bars.push(bar(dateAt(69), lastClose, 1_000_000 * amountMult, 1 * turnoverMult));
  return bars;
}

describe("firstBreakoutRelaxedStrategy", () => {
  it("fires when close is 0.99× platformHigh (relaxed) while strict does not", () => {
    const platformHigh = 10;
    // strict requires close > platformHigh; relaxed accepts >= 0.99 × platformHigh
    const lastClose = +(platformHigh * 0.995).toFixed(2);
    const bars = makeBars({ platformHigh, lastClose });
    const ctx: StrategyContext = { meta: META, bars, sector: FRIENDLY_SECTOR };

    const strict = firstBreakoutStrategy(ctx);
    const relaxed = firstBreakoutRelaxedStrategy(ctx);

    expect(strict).toBeNull();
    expect(relaxed).not.toBeNull();
    expect(relaxed!.strategyId).toBe("firstBreakoutRelaxed");
    // Tech score must respect the cap and apply the near-breakout haircut.
    expect(relaxed!.technicalScore).toBeLessThanOrEqual(90);
  });

  it("uses a 30-day lookback (relaxed) — exported constants", () => {
    expect(FIRST_BREAKOUT_RELAXED_LOOKBACK).toBe(30);
    expect(FIRST_BREAKOUT_RELAXED_NEAR_RATIO).toBe(0.99);
  });

  it("still rejects when close is below the near-breakout threshold", () => {
    const platformHigh = 10;
    const lastClose = +(platformHigh * 0.98).toFixed(2); // 0.98 < 0.99
    const bars = makeBars({ platformHigh, lastClose });
    const out = firstBreakoutRelaxedStrategy({ meta: META, bars, sector: FRIENDLY_SECTOR });
    expect(out).toBeNull();
  });

  it("does NOT appear in the default STRATEGY_LIST", () => {
    expect(STRATEGY_LIST.find((d) => d.id === "firstBreakoutRelaxed")).toBeUndefined();
  });

  it("is registered in EXPERIMENTAL_STRATEGIES", () => {
    expect(EXPERIMENTAL_STRATEGIES.firstBreakoutRelaxed).toBeDefined();
    expect(EXPERIMENTAL_STRATEGIES.firstBreakoutRelaxed.fn).toBe(firstBreakoutRelaxedStrategy);
  });

  it("experimentalStrategiesEnabled() returns false by default", () => {
    const prev = process.env.ENABLE_EXPERIMENTAL_STRATEGIES;
    delete process.env.ENABLE_EXPERIMENTAL_STRATEGIES;
    expect(experimentalStrategiesEnabled()).toBe(false);
    process.env.ENABLE_EXPERIMENTAL_STRATEGIES = "true";
    expect(experimentalStrategiesEnabled()).toBe(true);
    process.env.ENABLE_EXPERIMENTAL_STRATEGIES = "false";
    expect(experimentalStrategiesEnabled()).toBe(false);
    if (prev === undefined) delete process.env.ENABLE_EXPERIMENTAL_STRATEGIES;
    else process.env.ENABLE_EXPERIMENTAL_STRATEGIES = prev;
  });

  it("strict firstBreakout output is unchanged for a clear breakout setup", () => {
    const platformHigh = 10;
    const lastClose = +(platformHigh * 1.05).toFixed(2); // strictly above
    const bars = makeBars({ platformHigh, lastClose });
    const out = firstBreakoutStrategy({ meta: META, bars, sector: FRIENDLY_SECTOR });
    expect(out).not.toBeNull();
    expect(out!.strategyId).toBe("firstBreakout");
    // Sanity: strict score caps at 90.
    expect(out!.technicalScore).toBeLessThanOrEqual(90);
  });
});
