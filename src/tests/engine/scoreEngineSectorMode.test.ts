import { describe, expect, it } from "vitest";
import { scoreCandidate } from "@/lib/engine/scoreEngine";
import type { StrategyCandidate } from "@/lib/strategies/types";
import type { StockDailyBar, StockMeta } from "@/lib/types/stock";

const meta: StockMeta = {
  symbol: "300750.SZ",
  name: "X",
  exchange: "SZ",
  boardType: "CHINEXT",
  industry: "",
  concepts: [],
  isST: false,
  marketCap: 1e10,
  floatMarketCap: 1e10,
};

const candidate: StrategyCandidate = {
  strategyId: "x",
  strategyName: "Test",
  signalType: "BREAKOUT",
  technicalScore: 70,
  keySupport: 10,
  keyResistance: 12,
  stopLoss: 9.5,
  target1: 12,
  target2: 13,
  explanation: [],
  bullishFactors: [],
  bearishFactors: [],
};

function bars(n: number): StockDailyBar[] {
  return Array.from({ length: n }, (_, i) => ({
    symbol: meta.symbol,
    name: meta.symbol,
    date: `2024-01-${String(i + 1).padStart(2, "0")}`,
    open: 10,
    high: 11,
    low: 9,
    close: 10.5,
    volume: 1_000_000,
    amount: 1_050_000_000,
    turnoverRate: 5,
    pctChange: 0,
  }));
}

describe("scoreEngine sectorScoreMode (v1.6)", () => {
  it("MISSING mode returns neutral 50 + caveat instead of penalty", () => {
    const r = scoreCandidate({
      candidate,
      meta,
      bars: bars(15),
      sector: undefined,
      sentiment: undefined,
      riskPenalty: 0,
      sectorScoreMode: "MISSING",
    });
    expect(r.sectorScore).toBe(50);
    expect(r.sectorScoreMode).toBe("MISSING");
    expect(r.sectorScoreCaveat).toMatch(/Sector score unavailable/);
  });

  it("FALLBACK mode still scores but tags caveat", () => {
    const r = scoreCandidate({
      candidate,
      meta,
      bars: bars(15),
      sector: {
        date: "2024-01-01",
        sectorName: "AI",
        pctChange: 1,
        limitUpCount: 1,
        topStocks: [],
        strengthRank: 1,
        momentumScore: 80,
      },
      sentiment: undefined,
      riskPenalty: 0,
      sectorScoreMode: "FALLBACK",
    });
    expect(r.sectorScoreMode).toBe("FALLBACK");
    expect(r.sectorScoreCaveat).toMatch(/mock fallback/i);
    // Score still reflects the sector inputs (≥ 50 + boosts).
    expect(r.sectorScore).toBeGreaterThan(50);
  });

  it("REAL mode echoes REAL and has no caveat", () => {
    const r = scoreCandidate({
      candidate,
      meta,
      bars: bars(15),
      sector: {
        date: "2024-01-01",
        sectorName: "AI",
        pctChange: 1,
        limitUpCount: 1,
        topStocks: [],
        strengthRank: 1,
        momentumScore: 80,
      },
      sentiment: undefined,
      riskPenalty: 0,
      sectorScoreMode: "REAL",
    });
    expect(r.sectorScoreMode).toBe("REAL");
    expect(r.sectorScoreCaveat).toBeUndefined();
  });

  it("defaults to MISSING when sector is undefined and no mode passed", () => {
    const r = scoreCandidate({
      candidate,
      meta,
      bars: bars(15),
      sector: undefined,
      sentiment: undefined,
      riskPenalty: 0,
    });
    expect(r.sectorScoreMode).toBe("MISSING");
    expect(r.sectorScore).toBe(50);
  });
});
