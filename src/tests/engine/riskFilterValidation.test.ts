import { describe, expect, it } from "vitest";
import { validateRiskFilter } from "@/lib/engine/riskFilterValidation";
import {
  makeBarBasedResolver,
  type HistoricalSignalRecord,
} from "@/lib/engine/scoreCalibration";
import type { StockDailyBar } from "@/lib/types/stock";
import type { RiskLevel } from "@/lib/types/signal";

function ramp(prices: number[], symbol: string): StockDailyBar[] {
  return prices.map((p, i) => ({
    symbol,
    name: symbol,
    date: `2024-01-${String(i + 1).padStart(2, "0")}`,
    open: p,
    high: p,
    low: p,
    close: p,
    volume: 1,
    amount: p,
    turnoverRate: 1,
    pctChange: 0,
  }));
}

function rec(symbol: string, risk: RiskLevel): HistoricalSignalRecord {
  return {
    date: "2024-01-01",
    symbol,
    strategyId: "s",
    score: 70,
    riskLevel: risk,
    signalType: "BREAKOUT",
    suggestedAction: "WATCH",
    keySupport: 0,
    keyResistance: 0,
    stopLoss: 0,
    target1: 0,
    target2: 0,
    explanation: [],
    risks: [],
  };
}

describe("validateRiskFilter", () => {
  it("filter helps when higher-risk signals under-perform", () => {
    // LOW symbol rallies; HIGH symbol drops.
    const lowSyms = ramp([10, 10.5, 11.0, 11.5, 12.0, 12.5, 13.0, 13.5], "LOW1");
    const highSyms = ramp([10, 9.6, 9.2, 8.8, 8.4, 8.0, 7.6, 7.2], "HIGH1");
    const r = makeBarBasedResolver({ LOW1: lowSyms, HIGH1: highSyms });
    const signals = [rec("LOW1", "LOW"), rec("HIGH1", "HIGH")];
    const v = validateRiskFilter(signals, r);
    const all = v.cohorts.find((c) => c.cohort === "ALL")!;
    const lowMed = v.cohorts.find((c) => c.cohort === "LOW_MED_ONLY")!;
    expect(lowMed.avgR5).toBeGreaterThan(all.avgR5);
    expect(v.filterHelps).toBe(true);
    // Verdict is INCONCLUSIVE because cohort sizes are below 30; the cohort
    // math is still right. See calibrationVerdict.test.ts for the verdict
    // path with adequate samples.
    expect(v.verdict).toBe("INCONCLUSIVE");
  });

  it("filter does not help when HIGH signals over-perform", () => {
    const lowSyms = ramp([10, 9.6, 9.2, 8.8, 8.4, 8.0, 7.6, 7.2], "LOW1");
    const highSyms = ramp([10, 10.5, 11.0, 11.5, 12.0, 12.5, 13.0, 13.5], "HIGH1");
    const r = makeBarBasedResolver({ LOW1: lowSyms, HIGH1: highSyms });
    const signals = [rec("LOW1", "LOW"), rec("HIGH1", "HIGH")];
    const v = validateRiskFilter(signals, r);
    expect(v.filterHelps).toBe(false);
    expect(v.warning).toBeDefined();
  });

  it("LOW_MED_ONLY cohort drops FORBIDDEN and HIGH from the count", () => {
    const flat = ramp([10, 10, 10, 10, 10, 10, 10, 10], "X");
    const r = makeBarBasedResolver({ X: flat });
    const signals = [
      { ...rec("X", "LOW") },
      { ...rec("X", "MEDIUM") },
      { ...rec("X", "HIGH") },
      { ...rec("X", "FORBIDDEN") },
    ];
    const v = validateRiskFilter(signals, r);
    const lowMed = v.cohorts.find((c) => c.cohort === "LOW_MED_ONLY")!;
    expect(lowMed.signalCount).toBe(2);
  });
});
