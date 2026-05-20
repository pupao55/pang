import { describe, expect, it } from "vitest";
import { evaluateRisk } from "@/lib/engine/riskFilter";
import { baseMeta, baseSentiment, buildCtx } from "../strategies/helpers";

describe("riskFilter", () => {
  it("excludes ST stocks outright", () => {
    const ctx = buildCtx({
      symbol: "ST001",
      name: "STCo",
      basePrice: 5,
      baseVolume: 1_000_000,
      baseTurnoverRate: 2,
      boardType: "MAIN",
      seed: 20,
      events: [],
    });
    const r = evaluateRisk({ meta: baseMeta({ isST: true }), bars: ctx.bars });
    expect(r.excluded).toBe(true);
    expect(r.riskLevel).toBe("FORBIDDEN");
  });

  it("excludes delisting-risk stocks outright", () => {
    const ctx = buildCtx({
      symbol: "DEL",
      name: "DelistCo",
      basePrice: 4,
      baseVolume: 1_000_000,
      baseTurnoverRate: 2,
      boardType: "MAIN",
      seed: 21,
      events: [],
    });
    const r = evaluateRisk({ meta: baseMeta({ hasDelistingRisk: true }), bars: ctx.bars });
    expect(r.excluded).toBe(true);
  });

  it("penalizes regulatory warning + recent reduction without excluding", () => {
    const ctx = buildCtx({
      symbol: "PEN",
      name: "PenCo",
      basePrice: 10,
      baseVolume: 8_000_000,
      baseTurnoverRate: 3,
      boardType: "MAIN",
      seed: 22,
      events: [],
    });
    const r = evaluateRisk({
      meta: baseMeta({ hasRegulatoryWarning: true, hasRecentReduction: true }),
      bars: ctx.bars,
    });
    expect(r.excluded).toBe(false);
    expect(r.riskPenalty).toBeGreaterThan(20);
    expect(r.riskLevel === "MEDIUM" || r.riskLevel === "HIGH").toBe(true);
  });

  it("applies a panic-market penalty", () => {
    const ctx = buildCtx({
      symbol: "PAN",
      name: "PanCo",
      basePrice: 10,
      baseVolume: 8_000_000,
      baseTurnoverRate: 3,
      boardType: "MAIN",
      seed: 23,
      events: [],
    });
    const r = evaluateRisk({
      meta: baseMeta(),
      bars: ctx.bars,
      sentiment: baseSentiment({ marketRegime: "PANIC" }),
    });
    expect(r.reasons.some((x) => x.includes("情绪冰点"))).toBe(true);
    expect(r.riskPenalty).toBeGreaterThan(10);
  });
});
