import { describe, expect, it } from "vitest";
import {
  buildCacheMaturityReport,
  SHORT_HISTORY_THRESHOLD,
} from "@/lib/engine/cacheMaturity";
import type { StockDailyBar, StockMeta } from "@/lib/types/stock";
import type { HistoricalSignalRecord } from "@/lib/engine/scoreCalibration";
import type { RiskLevel } from "@/lib/types/signal";

function meta(symbol: string): StockMeta {
  return {
    symbol,
    name: symbol,
    exchange: "SH",
    boardType: "MAIN",
    industry: "",
    concepts: [],
    isST: false,
    marketCap: 0,
    floatMarketCap: 0,
  };
}

function bars(symbol: string, n: number, startDay = 2): StockDailyBar[] {
  return Array.from({ length: n }, (_, i) => {
    const dt = new Date("2024-01-01T00:00:00Z");
    dt.setUTCDate(dt.getUTCDate() + startDay + i);
    return {
      symbol,
      name: symbol,
      date: dt.toISOString().slice(0, 10),
      open: 10,
      high: 11,
      low: 9,
      close: 10.5,
      volume: 1000,
      amount: 10500,
      turnoverRate: 1,
      pctChange: 0,
    };
  });
}

function sig(
  symbol: string,
  date: string,
  strategyId: string,
  score: number,
  risk: RiskLevel = "LOW",
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

describe("buildCacheMaturityReport", () => {
  it("NOT_READY when < 5 symbols or < 1000 bars", () => {
    const r = buildCacheMaturityReport({
      metas: [meta("A")],
      barsBySymbol: { A: bars("A", 100) },
      signals: [],
    });
    expect(r.readinessLevel).toBe("NOT_READY");
    expect(r.readinessReasons.some((x) => /5/.test(x))).toBe(true);
  });

  it("SMOKE_TEST_ONLY when 5 ≤ symbols < 30", () => {
    const symbols = Array.from({ length: 6 }, (_, i) => `S${i}`);
    const map: Record<string, StockDailyBar[]> = {};
    for (const s of symbols) map[s] = bars(s, 200);
    const r = buildCacheMaturityReport({
      metas: symbols.map(meta),
      barsBySymbol: map,
      signals: [],
    });
    expect(r.readinessLevel).toBe("SMOKE_TEST_ONLY");
  });

  it("EARLY_RESEARCH when ≥ 30 symbols with ≥ 200 avg bars and ≥ 1 strategy with 100 signals", () => {
    const symbols = Array.from({ length: 35 }, (_, i) => `S${i}`);
    const map: Record<string, StockDailyBar[]> = {};
    for (const s of symbols) map[s] = bars(s, 220);
    const signals = Array.from({ length: 110 }, (_, i) =>
      sig("S0", map["S0"][i].date, "alpha", 70),
    );
    const r = buildCacheMaturityReport({
      metas: symbols.map(meta),
      barsBySymbol: map,
      signals,
      sectorMode: "REAL",
      sentimentMode: "GENERATED",
    });
    expect(r.readinessLevel).toBe("EARLY_RESEARCH");
    expect(r.strategiesWithEnoughSamples).toContain("alpha");
  });

  it("RESEARCH_READY when all gates pass", () => {
    const symbols = Array.from({ length: 110 }, (_, i) => `S${i}`);
    const map: Record<string, StockDailyBar[]> = {};
    for (const s of symbols) map[s] = bars(s, 260);
    const signals: HistoricalSignalRecord[] = [];
    const strategies = ["alpha", "beta", "gamma"];
    for (const strat of strategies) {
      for (let i = 0; i < 120; i++) {
        // distribute scores across buckets so 60-70 / 70-80 / 80-90 all populated
        const score = i < 40 ? 65 : i < 80 ? 75 : 85;
        signals.push(sig(`S${i % symbols.length}`, map[`S${i % symbols.length}`][i % 260].date, strat, score));
      }
    }
    // Inject one MEDIUM risk signal so hasRiskDiversity = true.
    signals.push(sig("S0", map["S0"][0].date, "alpha", 85, "MEDIUM"));
    const r = buildCacheMaturityReport({
      metas: symbols.map(meta),
      barsBySymbol: map,
      signals,
      metadataMode: "REAL",
      sectorMode: "REAL",
      sentimentMode: "REAL",
    });
    expect(r.readinessLevel).toBe("RESEARCH_READY");
    expect(r.hasScoreCompression).toBe(false);
    expect(r.hasRiskDiversity).toBe(true);
  });

  it("detects score compression when 80+ buckets are empty", () => {
    const symbols = Array.from({ length: 35 }, (_, i) => `S${i}`);
    const map: Record<string, StockDailyBar[]> = {};
    for (const s of symbols) map[s] = bars(s, 220);
    const signals = Array.from({ length: 110 }, (_, i) =>
      sig("S0", map["S0"][i].date, "alpha", 65),
    );
    const r = buildCacheMaturityReport({
      metas: symbols.map(meta),
      barsBySymbol: map,
      signals,
      sectorMode: "FALLBACK",
      sentimentMode: "FALLBACK",
    });
    expect(r.hasScoreCompression).toBe(true);
  });

  it("flags symbols with very short history", () => {
    const symbols = ["A", "B", "C"];
    const map: Record<string, StockDailyBar[]> = {
      A: bars("A", SHORT_HISTORY_THRESHOLD - 1),
      B: bars("B", 200),
      C: bars("C", 200),
    };
    const r = buildCacheMaturityReport({
      metas: symbols.map(meta),
      barsBySymbol: map,
      signals: [],
    });
    expect(r.symbolsWithShortHistory).toContain("A");
  });

  it("emits the failed-only recommendation when fetchStatus.failed > 0", () => {
    const r = buildCacheMaturityReport({
      metas: [meta("A")],
      barsBySymbol: { A: bars("A", 100) },
      signals: [],
      fetchStatus: {
        source: "akshare",
        adjust: "qfq",
        startDate: "20240101",
        endDate: "20260519",
        updatedAt: "2026-05-20T00:00:00",
        totalSymbols: 5,
        succeeded: 1,
        failed: 4,
        empty: 0,
        skipped: 0,
        symbols: {},
      },
    });
    expect(r.nextActions.some((a) => /failed/.test(a))).toBe(true);
  });

  it("does not recommend `npm run build:sentiment` when sentiment is GENERATED", () => {
    const symbols = Array.from({ length: 35 }, (_, i) => `S${i}`);
    const map: Record<string, StockDailyBar[]> = {};
    for (const s of symbols) map[s] = bars(s, 220);
    const r = buildCacheMaturityReport({
      metas: symbols.map(meta),
      barsBySymbol: map,
      signals: [],
      sectorMode: "FALLBACK",
      sentimentMode: "GENERATED",
    });
    expect(r.nextActions.some((a) => /build:sentiment/.test(a))).toBe(false);
  });
});
