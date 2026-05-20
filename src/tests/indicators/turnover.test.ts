import { describe, expect, it } from "vitest";
import { calculateTurnoverLevels, findMaxTurnoverBar } from "@/lib/indicators/turnover";
import type { StockDailyBar } from "@/lib/types/stock";

function mk(turn: number, i: number, override: Partial<StockDailyBar> = {}): StockDailyBar {
  return {
    symbol: "X",
    name: "X",
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    volume: 1000,
    amount: 11000,
    turnoverRate: turn,
    pctChange: 0,
    ...override,
  };
}

describe("findMaxTurnoverBar", () => {
  it("returns null on empty input", () => {
    expect(findMaxTurnoverBar([], 10)).toBeNull();
  });

  it("returns the bar with the highest turnover rate inside lookback", () => {
    const bars = [mk(2, 0), mk(8, 1), mk(3, 2), mk(15, 3), mk(5, 4)];
    expect(findMaxTurnoverBar(bars, 5)?.turnoverRate).toBe(15);
  });

  it("respects lookback window", () => {
    const bars = [mk(20, 0), mk(2, 1), mk(3, 2)];
    expect(findMaxTurnoverBar(bars, 2)?.turnoverRate).toBe(3);
  });
});

describe("calculateTurnoverLevels", () => {
  it("returns body high/low from open and close", () => {
    const b = mk(5, 0, { open: 10, close: 12, high: 13, low: 9 });
    expect(calculateTurnoverLevels(b)).toEqual({
      high: 13,
      low: 9,
      bodyHigh: 12,
      bodyLow: 10,
    });
  });
});
