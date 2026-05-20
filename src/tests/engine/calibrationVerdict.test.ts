import { describe, expect, it } from "vitest";
import {
  calibrateScores,
  makeBarBasedResolver,
  type HistoricalSignalRecord,
} from "@/lib/engine/scoreCalibration";
import { validateRiskFilter } from "@/lib/engine/riskFilterValidation";
import type { StockDailyBar } from "@/lib/types/stock";

function bars(prices: number[], symbol: string): StockDailyBar[] {
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

function sig(date: string, symbol: string, score: number): HistoricalSignalRecord {
  return {
    date,
    symbol,
    strategyId: "x",
    score,
    riskLevel: "LOW",
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

describe("score calibration verdict", () => {
  it("returns INCONCLUSIVE when too few buckets have ≥30 samples", () => {
    const up = bars(Array.from({ length: 60 }, (_, i) => 100 + i), "UP");
    const r = makeBarBasedResolver({ UP: up });
    // 10 signals at score 90, 10 at score 60 — neither bucket reaches 30
    const signals = [
      ...Array.from({ length: 10 }, (_, i) => sig(up[i].date, "UP", 95)),
      ...Array.from({ length: 10 }, (_, i) => sig(up[i + 10].date, "UP", 65)),
    ];
    const res = calibrateScores(signals, r);
    expect(res.verdict).toBe("INCONCLUSIVE");
  });

  it("returns CALIBRATED when high scores outperform with enough samples", () => {
    const up = bars(Array.from({ length: 100 }, (_, i) => 100 + i * 0.5), "UP");
    const flat = bars(Array.from({ length: 100 }, () => 100), "FLAT");
    const r = makeBarBasedResolver({ UP: up, FLAT: flat });
    const signals: HistoricalSignalRecord[] = [];
    for (let i = 0; i < 30; i++) signals.push(sig(up[i].date, "UP", 95));
    for (let i = 0; i < 30; i++) signals.push(sig(flat[i].date, "FLAT", 65));
    const res = calibrateScores(signals, r);
    expect(res.verdict).toBe("CALIBRATED");
  });

  it("returns NOT_CALIBRATED when high scores under-perform with enough samples", () => {
    const up = bars(Array.from({ length: 100 }, (_, i) => 100 + i * 0.5), "UP");
    const flat = bars(Array.from({ length: 100 }, () => 100), "FLAT");
    const r = makeBarBasedResolver({ UP: up, FLAT: flat });
    const signals: HistoricalSignalRecord[] = [];
    // Inverted: high score on flat, low score on rally
    for (let i = 0; i < 30; i++) signals.push(sig(flat[i].date, "FLAT", 95));
    for (let i = 0; i < 30; i++) signals.push(sig(up[i].date, "UP", 65));
    const res = calibrateScores(signals, r);
    expect(res.verdict).toBe("NOT_CALIBRATED");
  });
});

describe("risk filter validation verdict", () => {
  it("returns INCONCLUSIVE with too few samples", () => {
    const flat = bars(Array.from({ length: 30 }, () => 100), "F");
    const r = makeBarBasedResolver({ F: flat });
    const signals = [
      ...Array.from({ length: 5 }, (_, i) =>
        ({ ...sig(flat[i].date, "F", 70), riskLevel: "LOW" as const }),
      ),
    ];
    const res = validateRiskFilter(signals, r);
    expect(res.verdict).toBe("INCONCLUSIVE");
  });

  it("returns IMPROVES when stricter cohorts outperform with enough samples", () => {
    const up = bars(Array.from({ length: 100 }, (_, i) => 100 + i * 0.5), "UP");
    const down = bars(Array.from({ length: 100 }, (_, i) => 100 - i * 0.5), "DN");
    const r = makeBarBasedResolver({ UP: up, DN: down });
    const signals: HistoricalSignalRecord[] = [];
    for (let i = 0; i < 50; i++)
      signals.push({ ...sig(up[i].date, "UP", 70), riskLevel: "LOW" });
    for (let i = 0; i < 50; i++)
      signals.push({ ...sig(down[i].date, "DN", 70), riskLevel: "HIGH" });
    const res = validateRiskFilter(signals, r);
    expect(res.verdict).toBe("IMPROVES");
  });
});
