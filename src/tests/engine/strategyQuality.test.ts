import { describe, expect, it } from "vitest";
import { evaluateStrategyQuality } from "@/lib/engine/strategyQuality";
import {
  makeBarBasedResolver,
  type HistoricalSignalRecord,
} from "@/lib/engine/scoreCalibration";
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

function sig(
  date: string,
  symbol: string,
  strategyId: string,
  score = 70,
  risk: "LOW" | "HIGH" = "LOW",
): HistoricalSignalRecord {
  return {
    date,
    symbol,
    strategyId,
    score,
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

describe("evaluateStrategyQuality", () => {
  it("emits NEEDS_MORE_DATA when n < 30", () => {
    const series = bars([10, 10, 10, 10, 10, 10, 10, 10, 10, 10], "X");
    const resolver = makeBarBasedResolver({ X: series });
    const signals = Array.from({ length: 5 }, (_, i) =>
      sig(`2024-01-0${i + 1}`, "X", "small"),
    );
    const out = evaluateStrategyQuality({ signals, resolver });
    expect(out[0].recommendation).toBe("NEEDS_MORE_DATA");
    expect(out[0].sampleSizeBadge).toBe("NEEDS_MORE_DATA");
  });

  it("flags LOW_CONFIDENCE when 30 ≤ n < 100", () => {
    // Need 30+ bars so we can compute forward 5d.
    const series = bars(
      Array.from({ length: 60 }, (_, i) => 10 + i * 0.05),
      "X",
    );
    const resolver = makeBarBasedResolver({ X: series });
    const signals = Array.from({ length: 40 }, (_, i) =>
      sig(series[i].date, "X", "mid"),
    );
    const out = evaluateStrategyQuality({ signals, resolver });
    expect(out[0].sampleSizeBadge).toBe("LOW_CONFIDENCE");
    expect(out[0].recommendation).toBe("NEEDS_MORE_DATA"); // strong verdict still gated by n ≥ 100
  });

  it("issues DISABLE_CANDIDATE when n ≥ 100, avg5 < 0, win5 < 45%, worst < -12", () => {
    // Steep linear decline: each 5-bar window must yield < -12% return.
    // start 1000, step -32 per bar → return at +5d = -32*5/entry ≈ -16% at top
    // and progressively worse as entry falls. All gates triggered.
    const drop = Array.from({ length: 120 }, (_, i) =>
      Math.max(1, 1000 - i * 32),
    );
    const series = bars(drop, "DOWN");
    const resolver = makeBarBasedResolver({ DOWN: series });
    const signals = Array.from({ length: 100 }, (_, i) =>
      sig(series[i].date, "DOWN", "bad"),
    );
    const out = evaluateStrategyQuality({ signals, resolver });
    expect(out[0].recommendation).toBe("DISABLE_CANDIDATE");
    expect(out[0].sampleSizeBadge).toBe("OK");
  });

  it("issues KEEP_CANDIDATE when all gates pass and calibration OK", () => {
    // Strong, consistent +5%-ish 5-day rallies.
    const up = Array.from({ length: 120 }, (_, i) => 100 + i * 0.4);
    const series = bars(up, "UP");
    const resolver = makeBarBasedResolver({ UP: series });
    const signals = Array.from({ length: 100 }, (_, i) =>
      sig(series[i].date, "UP", "good"),
    );
    const out = evaluateStrategyQuality({
      signals,
      resolver,
      scoreCalibrationOk: true,
    });
    expect(out[0].recommendation).toBe("KEEP_CANDIDATE");
  });

  it("falls back to MODIFY_CANDIDATE when calibration is NOT_CALIBRATED", () => {
    const up = Array.from({ length: 120 }, (_, i) => 100 + i * 0.4);
    const series = bars(up, "UP");
    const resolver = makeBarBasedResolver({ UP: series });
    const signals = Array.from({ length: 100 }, (_, i) =>
      sig(series[i].date, "UP", "good"),
    );
    const out = evaluateStrategyQuality({
      signals,
      resolver,
      scoreCalibrationOk: false,
    });
    expect(out[0].recommendation).toBe("MODIFY_CANDIDATE");
  });
});
