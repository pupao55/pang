import { describe, expect, it } from "vitest";
import { runSignalEngine } from "@/lib/engine/signalEngine";
import { getMockBarsBySymbol } from "@/lib/data/mockDailyBars";
import { MOCK_SECTORS } from "@/lib/data/mockSectors";
import { MOCK_SENTIMENT } from "@/lib/data/mockSentiment";
import { MOCK_STOCKS } from "@/lib/data/mockStocks";

describe("signalEngine (integration with mock data)", () => {
  const signals = runSignalEngine({
    metas: MOCK_STOCKS,
    barsBySymbol: getMockBarsBySymbol(),
    sectors: MOCK_SECTORS,
    sentiment: MOCK_SENTIMENT,
  });

  it("excludes ST and delisting-risk stocks from output", () => {
    expect(signals.some((s) => s.symbol === "000707")).toBe(false);
  });

  it("sorts results by score descending", () => {
    for (let i = 1; i < signals.length; i++) {
      expect(signals[i - 1].score).toBeGreaterThanOrEqual(signals[i].score);
    }
  });

  it("emits at most one signal per stock (merge step keeps highest)", () => {
    const seen = new Set<string>();
    for (const s of signals) {
      expect(seen.has(s.symbol)).toBe(false);
      seen.add(s.symbol);
    }
  });

  it("produces at least one qualified candidate from the mock universe", () => {
    expect(signals.length).toBeGreaterThan(0);
  });
});
