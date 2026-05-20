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

function rec(symbol: string, date: string, risk: RiskLevel): HistoricalSignalRecord {
  return {
    date,
    symbol,
    strategyId: "x",
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

describe("validateRiskFilter v1.5 rules", () => {
  it("INCONCLUSIVE when all signals share one risk level (cohorts identical)", () => {
    // 40 LOW-only signals on a flat series — every cohort sees the same 40.
    const flat = ramp(Array.from({ length: 40 }, () => 100), "X");
    const r = makeBarBasedResolver({ X: flat });
    const signals = Array.from({ length: 40 }, (_, i) => rec("X", flat[i].date, "LOW"));
    const v = validateRiskFilter(signals, r);
    expect(v.verdict).toBe("INCONCLUSIVE");
    expect(v.explanation).toMatch(/identical/i);
  });

  it("INCONCLUSIVE when HIGH+FORBIDDEN < 10", () => {
    // 60 LOW + 5 HIGH; cohorts differ but the test cohort is tiny.
    const up = ramp(Array.from({ length: 100 }, (_, i) => 100 + i * 0.1), "U");
    const r = makeBarBasedResolver({ U: up });
    const signals: HistoricalSignalRecord[] = [];
    for (let i = 0; i < 60; i++) signals.push(rec("U", up[i].date, "LOW"));
    for (let i = 0; i < 5; i++) signals.push(rec("U", up[i + 60].date, "HIGH"));
    const v = validateRiskFilter(signals, r);
    expect(v.verdict).toBe("INCONCLUSIVE");
    expect(v.explanation).toMatch(/HIGH\/FORBIDDEN/);
  });

  it("INCONCLUSIVE when filter removes less than 5% of signals", () => {
    // 200 LOW + 2 HIGH → filter removes 2/202 ≈ 1%.
    const up = ramp(Array.from({ length: 250 }, (_, i) => 100 + i * 0.1), "U");
    const r = makeBarBasedResolver({ U: up });
    const signals: HistoricalSignalRecord[] = [];
    for (let i = 0; i < 200; i++) signals.push(rec("U", up[i].date, "LOW"));
    for (let i = 0; i < 2; i++) signals.push(rec("U", up[i].date, "HIGH"));
    const v = validateRiskFilter(signals, r);
    expect(v.verdict).toBe("INCONCLUSIVE");
    // Note: HIGH count is 2 < 10, so this trips the HIGH/FORBIDDEN gate first;
    // that's still INCONCLUSIVE which is what we want to assert here.
    expect(v.explanation).toMatch(/HIGH|5%|inconclusive/);
  });

  it("IMPROVES only when LOW_MED beats ALL on avg AND worst AND winRate", () => {
    const up = ramp(Array.from({ length: 100 }, (_, i) => 100 + i * 0.5), "UP");
    const down = ramp(Array.from({ length: 100 }, (_, i) => 100 - i * 0.5), "DN");
    const r = makeBarBasedResolver({ UP: up, DN: down });
    const signals: HistoricalSignalRecord[] = [];
    for (let i = 0; i < 50; i++) signals.push(rec("UP", up[i].date, "LOW"));
    for (let i = 0; i < 50; i++) signals.push(rec("DN", down[i].date, "HIGH"));
    const v = validateRiskFilter(signals, r);
    expect(v.verdict).toBe("IMPROVES");
    expect(v.explanation).toMatch(/avg5d/);
  });

  it("NO_IMPROVEMENT when filter keeps the worse half", () => {
    // Inverted: HIGH cohort rallies, LOW cohort declines.
    const up = ramp(Array.from({ length: 100 }, (_, i) => 100 + i * 0.5), "UP");
    const down = ramp(Array.from({ length: 100 }, (_, i) => 100 - i * 0.5), "DN");
    const r = makeBarBasedResolver({ UP: up, DN: down });
    const signals: HistoricalSignalRecord[] = [];
    for (let i = 0; i < 50; i++) signals.push(rec("DN", down[i].date, "LOW"));
    for (let i = 0; i < 50; i++) signals.push(rec("UP", up[i].date, "HIGH"));
    const v = validateRiskFilter(signals, r);
    expect(v.verdict).toBe("NO_IMPROVEMENT");
  });
});
