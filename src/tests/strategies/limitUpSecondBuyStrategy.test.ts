import { describe, expect, it } from "vitest";
import { limitUpSecondBuyStrategy } from "@/lib/strategies/limitUpSecondBuyStrategy";
import { buildCtx } from "./helpers";

describe("limitUpSecondBuyStrategy", () => {
  it("generates a SECOND_BUY/PULLBACK signal for a valid second-buy setup", () => {
    const ctx = buildCtx({
      symbol: "LU001",
      name: "LimitUpStock",
      basePrice: 20,
      baseVolume: 10_000_000,
      baseTurnoverRate: 4,
      // CHINEXT 20cm gives a wider limit-up body, leaving room for a healthy
      // pullback that does not break the key body-low support.
      boardType: "CHINEXT",
      seed: 1,
      drift: 0.0005,
      volatility: 0.006,
      events: [
        { kind: "drift", t: 50, pct: 0.02 },
        { kind: "limitUp", t: 51 },
        { kind: "drift", t: 52, pct: -0.02 },
        { kind: "drift", t: 53, pct: -0.015 },
        { kind: "drift", t: 54, pct: -0.01 },
        { kind: "drift", t: 78, pct: 0.02 },
        { kind: "breakout", t: 79, pct: 0.05, amountMultiple: 1.5, turnoverMultiple: 1.5 },
      ],
    });
    const r = limitUpSecondBuyStrategy(ctx);
    expect(r).not.toBeNull();
    expect(["SECOND_BUY", "PULLBACK"]).toContain(r!.signalType);
    expect(r!.technicalScore).toBeGreaterThan(50);
  });

  it("returns null when no limit-up occurred in the lookback window", () => {
    const ctx = buildCtx({
      symbol: "NL001",
      name: "NoLU",
      basePrice: 20,
      baseVolume: 10_000_000,
      baseTurnoverRate: 3,
      boardType: "MAIN",
      seed: 2,
      drift: 0,
      volatility: 0.008,
      events: [],
    });
    expect(limitUpSecondBuyStrategy(ctx)).toBeNull();
  });

  it("returns null when key support is broken after the limit-up", () => {
    const ctx = buildCtx({
      symbol: "BREAK001",
      name: "BrokeSupport",
      basePrice: 20,
      baseVolume: 10_000_000,
      baseTurnoverRate: 3,
      boardType: "MAIN",
      seed: 3,
      drift: 0,
      volatility: 0.008,
      events: [
        { kind: "limitUp", t: 50 },
        // Crash hard — break body low.
        { kind: "drift", t: 60, pct: -0.18 },
        { kind: "drift", t: 79, pct: 0.02 },
      ],
    });
    expect(limitUpSecondBuyStrategy(ctx)).toBeNull();
  });
});
