import { describe, expect, it } from "vitest";
import { sectorLeaderStrategy } from "@/lib/strategies/sectorLeaderStrategy";
import { baseSector, buildCtx } from "./helpers";

describe("sectorLeaderStrategy", () => {
  it("emits BREAKOUT for top-ranked sector + strong close above MA10", () => {
    const ctx = buildCtx(
      {
        symbol: "SL001",
        name: "TopLeader",
        basePrice: 25,
        baseVolume: 10_000_000,
        baseTurnoverRate: 4,
        boardType: "MAIN",
        seed: 7,
        drift: 0.002,
        volatility: 0.008,
        events: [
          { kind: "drift", t: 78, pct: 0.02 },
          { kind: "breakout", t: 79, pct: 0.04, amountMultiple: 1.5, turnoverMultiple: 1.4 },
        ],
      },
      {
        sector: baseSector({
          strengthRank: 1,
          momentumScore: 85,
          topStocks: ["SL001"],
          limitUpCount: 5,
          pctChange: 3.4,
        }),
      },
    );
    const r = sectorLeaderStrategy(ctx);
    expect(r).not.toBeNull();
    expect(r!.signalType).toBe("BREAKOUT");
  });

  it("returns null when sector is weak", () => {
    const ctx = buildCtx(
      {
        symbol: "SL002",
        name: "WeakSector",
        basePrice: 25,
        baseVolume: 10_000_000,
        baseTurnoverRate: 4,
        boardType: "MAIN",
        seed: 8,
        drift: 0,
        volatility: 0.008,
        events: [],
      },
      {
        sector: baseSector({
          strengthRank: 20,
          momentumScore: 30,
          pctChange: -1.5,
          limitUpCount: 0,
        }),
      },
    );
    expect(sectorLeaderStrategy(ctx)).toBeNull();
  });

  it("emits WATCH_ONLY when sector strong but technical confirmation weak", () => {
    const ctx = buildCtx(
      {
        symbol: "SL003",
        name: "SoftClose",
        basePrice: 25,
        baseVolume: 10_000_000,
        baseTurnoverRate: 4,
        boardType: "MAIN",
        seed: 9,
        drift: 0,
        volatility: 0.005,
        events: [{ kind: "drift", t: 79, pct: 0.003 }],
      },
      {
        sector: baseSector({
          strengthRank: 2,
          momentumScore: 80,
          topStocks: ["SL003"],
        }),
      },
    );
    const r = sectorLeaderStrategy(ctx);
    expect(r).not.toBeNull();
    expect(r!.signalType).toBe("WATCH_ONLY");
  });
});
