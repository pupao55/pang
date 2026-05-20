import { describe, expect, it } from "vitest";
import { firstBreakoutStrategy } from "@/lib/strategies/firstBreakoutStrategy";
import { baseSector, buildCtx } from "./helpers";

describe("firstBreakoutStrategy", () => {
  it("emits BREAKOUT when today breaks 40-day high with volume + sector confirmation", () => {
    const ctx = buildCtx(
      {
        symbol: "FB001",
        name: "FirstBO",
        basePrice: 18,
        baseVolume: 6_000_000,
        baseTurnoverRate: 3,
        boardType: "MAIN",
        seed: 13,
        drift: 0.0005,
        volatility: 0.008,
        events: [{ kind: "breakout", t: 79, pct: 0.08, amountMultiple: 2.5, turnoverMultiple: 2.2 }],
      },
      { sector: baseSector({ strengthRank: 2, momentumScore: 75 }) },
    );
    const r = firstBreakoutStrategy(ctx);
    expect(r).not.toBeNull();
    expect(r!.signalType).toBe("BREAKOUT");
  });

  it("returns null if 60-day rise is excessive (overextended)", () => {
    const ctx = buildCtx({
      symbol: "FB002",
      name: "Extended",
      basePrice: 5,
      baseVolume: 6_000_000,
      baseTurnoverRate: 3,
      boardType: "MAIN",
      seed: 14,
      drift: 0.015, // ~+150% in 60 days
      volatility: 0.005,
      events: [{ kind: "breakout", t: 79, pct: 0.08, amountMultiple: 2, turnoverMultiple: 2 }],
    });
    expect(firstBreakoutStrategy(ctx)).toBeNull();
  });

  it("returns null without amount + turnover expansion", () => {
    const ctx = buildCtx({
      symbol: "FB003",
      name: "WeakVol",
      basePrice: 18,
      baseVolume: 6_000_000,
      baseTurnoverRate: 3,
      boardType: "MAIN",
      seed: 15,
      drift: 0.0005,
      volatility: 0.005,
      events: [{ kind: "drift", t: 79, pct: 0.06 }],
    });
    expect(firstBreakoutStrategy(ctx)).toBeNull();
  });
});
