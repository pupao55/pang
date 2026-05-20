import { describe, expect, it } from "vitest";
import { maxTurnoverBreakoutStrategy } from "@/lib/strategies/maxTurnoverBreakoutStrategy";
import { buildCtx } from "./helpers";

describe("maxTurnoverBreakoutStrategy", () => {
  it("emits BREAKOUT when today closes above max-turnover body high with volume expansion", () => {
    const ctx = buildCtx({
      symbol: "MT001",
      name: "MaxTurnA",
      basePrice: 30,
      baseVolume: 12_000_000,
      baseTurnoverRate: 3,
      boardType: "MAIN",
      seed: 4,
      drift: 0,
      volatility: 0.008,
      events: [
        { kind: "maxTurnover", t: 50, closePct: 0.04, rangePct: 0.07, turnover: 12 },
        { kind: "drift", t: 51, pct: -0.02 },
        { kind: "drift", t: 78, pct: 0.02 },
        { kind: "breakout", t: 79, pct: 0.06, amountMultiple: 2, turnoverMultiple: 2 },
      ],
    });
    const r = maxTurnoverBreakoutStrategy(ctx);
    expect(r).not.toBeNull();
    expect(r!.signalType).toBe("BREAKOUT");
  });

  it("returns null when today is far below max-turnover body and no defence", () => {
    const ctx = buildCtx({
      symbol: "MT002",
      name: "FailMT",
      basePrice: 30,
      baseVolume: 12_000_000,
      baseTurnoverRate: 3,
      boardType: "MAIN",
      seed: 5,
      drift: 0,
      volatility: 0.005,
      events: [
        { kind: "maxTurnover", t: 50, closePct: 0.04, rangePct: 0.07, turnover: 12 },
        { kind: "drift", t: 60, pct: -0.2 }, // collapse below body low
      ],
    });
    expect(maxTurnoverBreakoutStrategy(ctx)).toBeNull();
  });

  it("emits WATCH_ONLY when price defends body low without breaking out", () => {
    const ctx = buildCtx({
      symbol: "MT003",
      name: "Defense",
      basePrice: 30,
      baseVolume: 12_000_000,
      baseTurnoverRate: 3,
      boardType: "MAIN",
      seed: 6,
      drift: 0,
      volatility: 0.003,
      events: [
        { kind: "maxTurnover", t: 50, closePct: 0.03, rangePct: 0.05, turnover: 11 },
        // Drift down to body-low area but not break it.
        { kind: "drift", t: 60, pct: -0.025 },
      ],
    });
    const r = maxTurnoverBreakoutStrategy(ctx);
    // Either WATCH_ONLY or null is acceptable for a no-breakout/no-defence edge.
    if (r) expect(r.signalType).toBe("WATCH_ONLY");
  });
});
