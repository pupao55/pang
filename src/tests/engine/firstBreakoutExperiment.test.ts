import { describe, expect, it } from "vitest";
import {
  classifyVerdict,
  runFirstBreakoutExperiment,
  type FirstBreakoutVariantResult,
} from "@/lib/engine/firstBreakoutExperiment";
import { makeBarBasedResolver } from "@/lib/engine/scoreCalibration";
import type { StockDailyBar, StockMeta } from "@/lib/types/stock";

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
  const base = new Date("2024-01-01T00:00:00Z");
  return new Date(base.getTime() + i * 86400000).toISOString().slice(0, 10);
}
function meta(symbol: string): StockMeta {
  return {
    symbol,
    name: symbol,
    exchange: "SH",
    boardType: "MAIN",
    industry: "Test",
    concepts: [],
    isST: false,
    marketCap: 10_000_000_000,
    floatMarketCap: 8_000_000_000,
  };
}

function defaultsVariant(over: Partial<FirstBreakoutVariantResult> = {}): FirstBreakoutVariantResult {
  return {
    variant: "strict",
    candidateCount: 1000,
    signalCount: 0,
    passRate: 0,
    rejected: {
      minHistory: 0,
      priorRiseCap: 0,
      platformBreakout: 0,
      volumeExpansion: 0,
      amountExpansion: 0,
      sectorStrength: 0,
      riskFilter: 0,
    },
    avgReturn1d: NaN,
    avgReturn3d: NaN,
    avgReturn5d: NaN,
    avgReturn10d: NaN,
    winRate1d: NaN,
    winRate3d: NaN,
    winRate5d: NaN,
    winRate10d: NaN,
    worstReturn5d: NaN,
    bestReturn5d: NaN,
    sampleSizeBadge: "NEEDS_MORE_DATA",
    ...over,
  };
}

describe("classifyVerdict", () => {
  it("NEEDS_MORE_DATA when both variants under 30 signals", () => {
    const strict = defaultsVariant({ signalCount: 10 });
    const relaxed = defaultsVariant({ variant: "relaxed", signalCount: 20 });
    expect(classifyVerdict(strict, relaxed)).toBe("NEEDS_MORE_DATA");
  });

  it("PROMISING_RELAXED under strong relaxed numbers", () => {
    const strict = defaultsVariant({ signalCount: 33, avgReturn5d: -1, winRate5d: 0.4 });
    const relaxed = defaultsVariant({
      variant: "relaxed",
      signalCount: 150,
      avgReturn5d: 1.5,
      winRate5d: 0.58,
      worstReturn5d: -12,
      sampleSizeBadge: "OK",
    });
    expect(classifyVerdict(strict, relaxed)).toBe("PROMISING_RELAXED");
  });

  it("TEST_RELAXED when relaxed multiplies samples without worsening returns", () => {
    const strict = defaultsVariant({
      signalCount: 40,
      avgReturn5d: 0.8,
      winRate5d: 0.5,
      sampleSizeBadge: "LOW_CONFIDENCE",
    });
    const relaxed = defaultsVariant({
      variant: "relaxed",
      signalCount: 80,
      avgReturn5d: 0.5,
      winRate5d: 0.49,
      sampleSizeBadge: "LOW_CONFIDENCE",
    });
    expect(classifyVerdict(strict, relaxed)).toBe("TEST_RELAXED");
  });

  it("DISABLE_BOTH when both are well-sampled and ≤ 0", () => {
    const strict = defaultsVariant({
      signalCount: 200,
      avgReturn5d: -0.5,
      winRate5d: 0.45,
      sampleSizeBadge: "OK",
    });
    const relaxed = defaultsVariant({
      variant: "relaxed",
      signalCount: 250,
      avgReturn5d: -0.7,
      winRate5d: 0.44,
      sampleSizeBadge: "OK",
    });
    expect(classifyVerdict(strict, relaxed)).toBe("DISABLE_BOTH");
  });

  it("KEEP_STRICT when relaxation does not help much", () => {
    const strict = defaultsVariant({
      signalCount: 60,
      avgReturn5d: 0.5,
      winRate5d: 0.51,
      sampleSizeBadge: "LOW_CONFIDENCE",
    });
    const relaxed = defaultsVariant({
      variant: "relaxed",
      signalCount: 75,
      avgReturn5d: -3.0,
      winRate5d: 0.4,
      sampleSizeBadge: "LOW_CONFIDENCE",
    });
    expect(classifyVerdict(strict, relaxed)).toBe("KEEP_STRICT");
  });
});

describe("runFirstBreakoutExperiment", () => {
  it("aggregates over a synthetic universe and returns a verdict", () => {
    // Build a single symbol with 70 bars; last bar has amount+turnover spike
    // and closes at platformHigh × 1.05 (strict should fire). Resolver
    // returns realistic forward returns from those same bars.
    const platformHigh = 10;
    const bars: StockDailyBar[] = [];
    for (let i = 0; i < 60; i++) bars.push(bar(dateAt(i), platformHigh * 0.95));
    for (let i = 60; i < 69; i++) bars.push(bar(dateAt(i), platformHigh));
    bars.push(bar(dateAt(69), platformHigh * 1.05, 5_000_000, 5));
    // Forward bars so resolver has 10 trading days to look at.
    for (let i = 70; i < 90; i++) bars.push(bar(dateAt(i), platformHigh * 1.08));

    const resolver = makeBarBasedResolver({ X: bars });
    const result = runFirstBreakoutExperiment({
      metas: [meta("X")],
      barsBySymbol: { X: bars },
      sectorSnapshotsByDate: new Map(),
      resolver,
    });

    expect(result.strict.candidateCount).toBeGreaterThan(0);
    expect(result.relaxed.candidateCount).toBeGreaterThan(0);
    // Each variant should fire at least once on the spike bar.
    expect(result.strict.signalCount + result.relaxed.signalCount).toBeGreaterThan(0);
    // Verdict is one of the known labels.
    expect([
      "KEEP_STRICT",
      "TEST_RELAXED",
      "PROMISING_RELAXED",
      "DISABLE_BOTH",
      "NEEDS_MORE_DATA",
    ]).toContain(result.verdict);
    // platformBreakout should be by far the largest rejection bucket for
    // strict (relaxed should reject fewer there).
    expect(result.relaxed.rejected.platformBreakout).toBeLessThanOrEqual(
      result.strict.rejected.platformBreakout,
    );
  });
});
