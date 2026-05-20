import { describe, expect, it } from "vitest";
import { trendPullbackStrategy } from "@/lib/strategies/trendPullbackStrategy";
import { buildCtx } from "./helpers";

describe("trendPullbackStrategy", () => {
  it("emits PULLBACK on a healthy uptrend with recent MA10 retest", () => {
    const ctx = buildCtx({
      symbol: "TP001",
      name: "PullbackCo",
      basePrice: 20,
      baseVolume: 8_000_000,
      baseTurnoverRate: 3,
      boardType: "MAIN",
      seed: 10,
      drift: 0.003,
      volatility: 0.008,
      events: [
        { kind: "drift", t: 75, pct: -0.025 },
        { kind: "drift", t: 76, pct: -0.012 },
        { kind: "drift", t: 78, pct: 0.005 },
        { kind: "breakout", t: 79, pct: 0.03, amountMultiple: 1.4, turnoverMultiple: 1.3 },
      ],
    });
    const r = trendPullbackStrategy(ctx);
    expect(r).not.toBeNull();
    expect(r!.signalType).toBe("PULLBACK");
  });

  it("returns null without an established uptrend", () => {
    const ctx = buildCtx({
      symbol: "TP002",
      name: "Sideways",
      basePrice: 20,
      baseVolume: 8_000_000,
      baseTurnoverRate: 3,
      boardType: "MAIN",
      seed: 11,
      drift: -0.001,
      volatility: 0.015,
      events: [],
    });
    expect(trendPullbackStrategy(ctx)).toBeNull();
  });

  it("returns null when there is no recent pullback to MA10/MA20", () => {
    const ctx = buildCtx({
      symbol: "TP003",
      name: "NoPullback",
      basePrice: 20,
      baseVolume: 8_000_000,
      baseTurnoverRate: 3,
      boardType: "MAIN",
      seed: 12,
      drift: 0.004,
      volatility: 0.003, // very tight — never touches MA
      events: [],
    });
    expect(trendPullbackStrategy(ctx)).toBeNull();
  });
});
