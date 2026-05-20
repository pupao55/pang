import { describe, expect, it } from "vitest";
import { compareBars, renderCompareReport } from "@/lib/data/providers/compare";
import type { StockDailyBar } from "@/lib/types/stock";

function bar(date: string, close: number, override: Partial<StockDailyBar> = {}): StockDailyBar {
  return {
    symbol: "300750.SZ",
    name: "x",
    date,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 1000,
    amount: close * 1000,
    turnoverRate: 1,
    pctChange: 0,
    ...override,
  };
}

describe("compareBars", () => {
  it("detects missing dates in either provider", () => {
    const a = [bar("2024-01-02", 10), bar("2024-01-03", 10.5), bar("2024-01-04", 10.7)];
    const b = [bar("2024-01-02", 10), bar("2024-01-04", 10.7)];
    const r = compareBars("X.SH", "providerA", a, "providerB", b);
    expect(r.onlyInA).toEqual(["2024-01-03"]);
    expect(r.onlyInB).toEqual([]);
    expect(r.overlapCount).toBe(2);
  });

  it("computes close diff in percent on overlap", () => {
    const a = [bar("2024-01-02", 100)];
    const b = [bar("2024-01-02", 102)];
    const r = compareBars("X.SH", "providerA", a, "providerB", b);
    expect(Math.abs(r.meanAbsCloseDiffPct - 1.98)).toBeLessThan(0.05);
  });

  it("flags likely adjustment mismatch when mean close diff > 2%", () => {
    const a = [bar("2024-01-02", 100), bar("2024-01-03", 105)];
    const b = [bar("2024-01-02", 75), bar("2024-01-03", 79)];
    const r = compareBars("X.SH", "providerA", a, "providerB", b);
    expect(r.likelyAdjustmentMismatch).toBe(true);
  });

  it("does not flag when close prices match within tolerance", () => {
    const a = [bar("2024-01-02", 100), bar("2024-01-03", 105)];
    const b = [bar("2024-01-02", 100.1), bar("2024-01-03", 105.05)];
    const r = compareBars("X.SH", "providerA", a, "providerB", b);
    expect(r.likelyAdjustmentMismatch).toBe(false);
  });

  it("renders markdown with summary + top-diff table", () => {
    const a = [bar("2024-01-02", 100), bar("2024-01-03", 105)];
    const b = [bar("2024-01-02", 100), bar("2024-01-03", 107)];
    const r = compareBars("X.SH", "providerA", a, "providerB", b);
    const md = renderCompareReport(r);
    expect(md).toContain("# Pangzi provider comparison — X.SH");
    expect(md).toContain("## Summary");
    expect(md).toContain("Top divergences");
    expect(md).toContain("providerA");
    expect(md).toContain("providerB");
  });
});
