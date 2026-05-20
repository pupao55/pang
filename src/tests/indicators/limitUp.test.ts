import { describe, expect, it } from "vitest";
import {
  getLimitUpThreshold,
  isLimitUpBar,
  isNearLimitUpBar,
} from "@/lib/indicators/limitUp";
import type { StockDailyBar } from "@/lib/types/stock";

function mk(close: number, high: number, i: number): StockDailyBar {
  return {
    symbol: "X",
    name: "X",
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    open: close,
    high,
    low: close,
    close,
    volume: 1000,
    amount: close * 1000,
    turnoverRate: 1,
    pctChange: 0,
  };
}

describe("limitUp indicators", () => {
  it("returns correct thresholds per board type", () => {
    expect(getLimitUpThreshold("MAIN")).toBeCloseTo(0.0995, 4);
    expect(getLimitUpThreshold("CHINEXT")).toBeCloseTo(0.1995, 4);
    expect(getLimitUpThreshold("STAR")).toBeCloseTo(0.1995, 4);
  });

  it("isLimitUpBar true for ≥10% MAIN, false otherwise", () => {
    const prev = mk(10, 10, 0);
    const lu = mk(11.0, 11.0, 1);
    const not = mk(10.9, 11.0, 1);
    expect(isLimitUpBar(lu, prev, "MAIN")).toBe(true);
    expect(isLimitUpBar(not, prev, "MAIN")).toBe(false);
  });

  it("isLimitUpBar true for ≥20% CHINEXT", () => {
    const prev = mk(10, 10, 0);
    const lu = mk(12.0, 12.0, 1);
    expect(isLimitUpBar(lu, prev, "CHINEXT")).toBe(true);
  });

  it("isNearLimitUpBar true even if close falls back from intraday high", () => {
    const prev = mk(10, 10, 0);
    const near = mk(10.7, 11.0, 1); // close +7%, high +10%
    expect(isNearLimitUpBar(near, prev, "MAIN")).toBe(true);
  });
});
