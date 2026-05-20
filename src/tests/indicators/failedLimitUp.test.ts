import { describe, expect, it } from "vitest";
import {
  isLimitUpBar,
  wasFailedLimitUpBar,
} from "@/lib/indicators/limitUp";
import type { StockDailyBar } from "@/lib/types/stock";

function mk(close: number, high: number, i: number): StockDailyBar {
  return {
    symbol: "X",
    name: "X",
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    open: close,
    high,
    low: Math.min(close, high) * 0.99,
    close,
    volume: 1000,
    amount: close * 1000,
    turnoverRate: 1,
    pctChange: 0,
  };
}

describe("limitUp tightening (AUDIT B-3, E-1)", () => {
  it("isLimitUpBar requires close ≈ high", () => {
    const prev = mk(10, 10, 0);
    const sealed = mk(11, 11, 1); // change +10%, close == high
    const noSeal = mk(11, 11.5, 1); // close fell back from intraday high
    expect(isLimitUpBar(sealed, prev, "MAIN")).toBe(true);
    expect(isLimitUpBar(noSeal, prev, "MAIN")).toBe(false);
  });

  it("wasFailedLimitUpBar fires only when high reached limit and close fell below", () => {
    const prev = mk(10, 10, 0);
    const failed = mk(10.6, 11.0, 1); // touched +10% intraday, closed +6%
    const sealedOnly = mk(11.0, 11.0, 1);
    const neverNear = mk(10.4, 10.5, 1);
    expect(wasFailedLimitUpBar(failed, prev, "MAIN")).toBe(true);
    expect(wasFailedLimitUpBar(sealedOnly, prev, "MAIN")).toBe(false);
    expect(wasFailedLimitUpBar(neverNear, prev, "MAIN")).toBe(false);
  });
});
