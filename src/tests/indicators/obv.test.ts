import { describe, expect, it } from "vitest";
import { calculateOBV } from "@/lib/indicators/obv";
import type { StockDailyBar } from "@/lib/types/stock";

function bar(close: number, volume: number, i: number): StockDailyBar {
  return {
    symbol: "X",
    name: "X",
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    open: close,
    high: close,
    low: close,
    close,
    volume,
    amount: close * volume,
    turnoverRate: 1,
    pctChange: 0,
  };
}

describe("calculateOBV", () => {
  it("starts at zero", () => {
    expect(calculateOBV([bar(10, 100, 0)])[0]).toBe(0);
  });

  it("accumulates volume on up days and subtracts on down days", () => {
    const bars = [bar(10, 100, 0), bar(11, 200, 1), bar(10, 50, 2), bar(10, 30, 3)];
    const o = calculateOBV(bars);
    expect(o[1]).toBe(200);
    expect(o[2]).toBe(150);
    expect(o[3]).toBe(150); // unchanged on flat day
  });
});
