import { describe, expect, it } from "vitest";
import { scoreCandidate } from "@/lib/engine/scoreEngine";
import { baseMeta, baseSector, baseSentiment, buildCtx } from "../strategies/helpers";
import type { StrategyCandidate } from "@/lib/strategies/types";

const candidate: StrategyCandidate = {
  strategyId: "x",
  strategyName: "Test",
  signalType: "BREAKOUT",
  technicalScore: 80,
  keySupport: 10,
  keyResistance: 12,
  stopLoss: 9.5,
  target1: 12,
  target2: 13,
  explanation: [],
  bullishFactors: ["bull"],
  bearishFactors: [],
};

describe("scoreEngine", () => {
  it("applies all five weighted components", () => {
    const ctx = buildCtx({
      symbol: "S1",
      name: "S1",
      basePrice: 20,
      baseVolume: 30_000_000,
      baseTurnoverRate: 5,
      boardType: "MAIN",
      seed: 30,
      events: [],
    });
    const r = scoreCandidate({
      candidate,
      meta: baseMeta(),
      bars: ctx.bars,
      sector: baseSector({ strengthRank: 1, momentumScore: 80, topStocks: ["TST001"] }),
      sentiment: baseSentiment(),
      riskPenalty: 0,
    });
    expect(r.score).toBeGreaterThan(60);
    expect(r.technicalScore).toBe(80);
    expect(r.suggestedAction).not.toBe("AVOID");
  });

  it("subtracts the risk penalty from the final score", () => {
    const ctx = buildCtx({
      symbol: "S2",
      name: "S2",
      basePrice: 20,
      baseVolume: 30_000_000,
      baseTurnoverRate: 5,
      boardType: "MAIN",
      seed: 31,
      events: [],
    });
    const noPen = scoreCandidate({
      candidate,
      meta: baseMeta(),
      bars: ctx.bars,
      sector: baseSector(),
      sentiment: baseSentiment(),
      riskPenalty: 0,
    });
    const pen = scoreCandidate({
      candidate,
      meta: baseMeta(),
      bars: ctx.bars,
      sector: baseSector(),
      sentiment: baseSentiment(),
      riskPenalty: 30,
    });
    expect(pen.score).toBeCloseTo(noPen.score - 30, 1);
  });

  it("downgrades to AVOID when fundamentals collapse (ST)", () => {
    const ctx = buildCtx({
      symbol: "S3",
      name: "S3",
      basePrice: 20,
      baseVolume: 30_000_000,
      baseTurnoverRate: 5,
      boardType: "MAIN",
      seed: 32,
      events: [],
    });
    const r = scoreCandidate({
      candidate,
      meta: baseMeta({ isST: true }),
      bars: ctx.bars,
      sector: baseSector(),
      sentiment: baseSentiment(),
      riskPenalty: 0,
    });
    expect(r.suggestedAction).toBe("AVOID");
  });
});
