import { afterEach, describe, expect, it } from "vitest";
import { runSignalEngine } from "@/lib/engine/signalEngine";
import { STRATEGIES } from "@/lib/strategies";
import type { Strategy } from "@/lib/strategies/types";
import { MOCK_SECTORS } from "@/lib/data/mockSectors";
import { MOCK_SENTIMENT } from "@/lib/data/mockSentiment";
import { MOCK_STOCKS } from "@/lib/data/mockStocks";
import { getMockBarsBySymbol } from "@/lib/data/mockDailyBars";

function makeFixedStrategy(score: number, id: string): Strategy {
  return () => ({
    strategyId: id,
    strategyName: `mock-${id}`,
    signalType: "BREAKOUT",
    technicalScore: score,
    keySupport: 10,
    keyResistance: 12,
    stopLoss: 9,
    target1: 12,
    target2: 13,
    explanation: [],
    bullishFactors: [],
    bearishFactors: [],
  });
}

const installed: string[] = [];
function install(id: string, score: number) {
  STRATEGIES[id] = {
    id,
    name: id,
    nameCN: id,
    nameEN: id,
    fn: makeFixedStrategy(score, id),
  } as (typeof STRATEGIES)[string];
  installed.push(id);
}

describe("signalEngine merge", () => {
  afterEach(() => {
    while (installed.length) delete STRATEGIES[installed.pop()!];
  });

  it("keeps the highest-scoring strategy per symbol and records the others as corroborating", () => {
    install("__highA__", 90);
    install("__lowB__", 60);
    const out = runSignalEngine({
      metas: MOCK_STOCKS,
      barsBySymbol: getMockBarsBySymbol(),
      sectors: MOCK_SECTORS,
      sentiment: MOCK_SENTIMENT,
      strategyIds: ["__highA__", "__lowB__"],
    });
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) {
      // The strategy with the higher technical score should always be the
      // primary signal; the other should appear in corroborating.
      expect(s.strategyId).toBe("__highA__");
      expect(s.corroboratingStrategies).toContain("__lowB__");
    }
  });

  it("does not emit signals for FORBIDDEN-risk stocks (ST)", () => {
    install("__alwaysFire__", 80);
    const out = runSignalEngine({
      metas: MOCK_STOCKS,
      barsBySymbol: getMockBarsBySymbol(),
      sectors: MOCK_SECTORS,
      sentiment: MOCK_SENTIMENT,
      strategyIds: ["__alwaysFire__"],
    });
    expect(out.some((s) => s.symbol === "000707")).toBe(false);
  });

  it("respects asOfDate by truncating bars", () => {
    install("__obs__", 70);
    const past = "2026-04-01";
    const out = runSignalEngine({
      metas: MOCK_STOCKS,
      barsBySymbol: getMockBarsBySymbol(),
      sectors: MOCK_SECTORS,
      sentiment: MOCK_SENTIMENT,
      asOfDate: past,
      strategyIds: ["__obs__"],
    });
    for (const s of out) {
      expect(s.date <= past).toBe(true);
    }
  });
});
