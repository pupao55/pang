import { describe, expect, it } from "vitest";
import {
  buildScoreDistributionHealth,
  renderScoreDistributionHealthMarkdown,
} from "@/lib/engine/scoreDistributionHealth";
import type { HistoricalSignalRecord } from "@/lib/engine/scoreCalibration";

function sig(score: number, i = 0): HistoricalSignalRecord {
  return {
    date: `2024-01-${String(i + 2).padStart(2, "0")}`,
    symbol: "X",
    strategyId: "alpha",
    score,
    riskLevel: "LOW",
    signalType: "BREAKOUT",
    suggestedAction: "WATCH",
    keySupport: 0,
    keyResistance: 0,
    stopLoss: 0,
    target1: 0,
    target2: 0,
    explanation: [],
    risks: [],
  };
}

describe("buildScoreDistributionHealth", () => {
  it("detects compression when 80+ buckets empty and n ≥ 50", () => {
    const signals = Array.from({ length: 60 }, (_, i) => sig(65, i));
    const d = buildScoreDistributionHealth({ signals });
    expect(d.compressionDetected).toBe(true);
    expect(d.bucket80to90Populated).toBe(false);
    expect(d.bucket90to100Populated).toBe(false);
  });

  it("does NOT flag compression when 80+ has signals", () => {
    const signals = [
      ...Array.from({ length: 30 }, (_, i) => sig(85, i)),
      ...Array.from({ length: 30 }, (_, i) => sig(65, i + 30)),
    ];
    const d = buildScoreDistributionHealth({ signals });
    expect(d.compressionDetected).toBe(false);
    expect(d.bucket80to90Populated).toBe(true);
  });

  it("flags severe compression when 70+ also empty", () => {
    const signals = Array.from({ length: 60 }, (_, i) => sig(55, i));
    const d = buildScoreDistributionHealth({ signals });
    expect(d.severeCompressionDetected).toBe(true);
  });

  it("emits improvementNote when 80+ goes from empty to populated", () => {
    const signals = [
      ...Array.from({ length: 30 }, (_, i) => sig(85, i)),
      ...Array.from({ length: 30 }, (_, i) => sig(65, i + 30)),
    ];
    const d = buildScoreDistributionHealth({
      signals,
      previousBucketCounts: {
        "90-100": 0,
        "80-90": 0,
        "70-80": 0,
        "60-70": 106,
        "<60": 8090,
      },
    });
    expect(d.improvementNote).toMatch(/80\+/);
    expect(d.improvementNote).toMatch(/populated/);
  });

  it("echoes mode fields to the rendered markdown", () => {
    const signals = Array.from({ length: 60 }, (_, i) => sig(65, i));
    const d = buildScoreDistributionHealth({
      signals,
      sectorMode: "GENERATED",
      sentimentMode: "GENERATED",
      metadataMode: "REAL",
    });
    const md = renderScoreDistributionHealthMarkdown(d);
    expect(md).toContain("sector=**GENERATED**");
    expect(md).toContain("metadata=**REAL**");
  });
});
