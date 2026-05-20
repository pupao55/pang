import { describe, expect, it } from "vitest";
import { renderCalibrationReport } from "@/lib/reports/calibrationReport";

describe("renderCalibrationReport", () => {
  it("emits a markdown document with all required sections", () => {
    const md = renderCalibrationReport({
      source: "akshareLocal",
      generatedAt: "2024-03-31T12:00:00Z",
      signalCount: 250,
      dateRange: { start: "2024-01-01", end: "2024-03-31" },
      perStrategy: [
        {
          strategyId: "trendPullback",
          signalCount: 120,
          avg1dReturn: 1,
          avg3dReturn: 2,
          avg5dReturn: 3,
          avg10dReturn: 4,
          winRate1d: 0.6,
          winRate3d: 0.6,
          winRate5d: 0.6,
          winRate10d: 0.55,
          bestReturn: 12,
          worstReturn: -8,
          averageScore: 72,
          averageRiskPenalty: NaN,
          recommendation: "KEEP_CANDIDATE",
          sampleSizeBadge: "OK",
          reasons: ["test"],
        },
      ],
      calibration: {
        verdict: "CALIBRATED",
        buckets: [
          { bucket: "90-100", signalCount: 30, avgR1: 2, avgR3: 3, avgR5: 4, avgR10: 5, winRate5d: 0.7, worstR5: -5, avgRiskLevelEncoded: 1.2 },
          { bucket: "<60", signalCount: 30, avgR1: 0, avgR3: 1, avgR5: 1, avgR10: 1, winRate5d: 0.5, worstR5: -6, avgRiskLevelEncoded: 1.8 },
        ],
        monotonic5d: true,
        rankCorrelation5d: 0.9,
      },
      riskValidation: {
        verdict: "IMPROVES",
        filterHelps: true,
        explanation: "ok",
        cohorts: [
          { cohort: "ALL", signalCount: 250, skippedCount: 0, avgR5: 2, winRate5d: 0.55, worstR5: -8, cumulativeReturnProxy: 0.25 },
          { cohort: "LOW_MED_ONLY", signalCount: 150, skippedCount: 100, avgR5: 3, winRate5d: 0.62, worstR5: -6, cumulativeReturnProxy: 0.4 },
        ],
      },
      failureModes: {
        byStrategy: [{ key: "trendPullback", count: 10, avgLossPct: -3, worstLossPct: -8, topReasons: [{ reason: "low liquidity", count: 3 }] }],
        byRiskLevel: [],
        bySignalType: [],
        byScoreBucket: [],
        byBoardType: [],
        byMonth: [],
      },
      sweep: {
        cells: [
          { minScore: 70, maxRiskLevel: "LOW_MEDIUM", holdingWindow: 5, signalCount: 100, avgReturn: 3, winRate: 0.6, worstReturn: -8, riskAdjusted: 0.4 },
        ],
        bestOverall: { minScore: 70, maxRiskLevel: "LOW_MEDIUM", holdingWindow: 5, signalCount: 100, avgReturn: 3, winRate: 0.6, worstReturn: -8, riskAdjusted: 0.4 },
        bestConservative: undefined,
        bestHighSignalCount: undefined,
      },
    });
    expect(md).toContain("# Pangzi calibration report — akshareLocal");
    expect(md).toContain("## Executive summary");
    expect(md).toContain("## Per-strategy quality");
    expect(md).toContain("## Score calibration");
    expect(md).toContain("## Risk filter effectiveness");
    expect(md).toContain("## Top 10 failure modes");
    expect(md).toContain("## Threshold sweep");
    expect(md).toContain("## Recommended threshold changes");
    expect(md).toContain("**KEEP_CANDIDATE**");
    expect(md).toContain("**CALIBRATED**");
    expect(md).toContain("**IMPROVES**");
  });

  it("surfaces NOT_CALIBRATED and NO_IMPROVEMENT warnings in suggestions", () => {
    const md = renderCalibrationReport({
      source: "akshareLocal",
      generatedAt: "2024-03-31T12:00:00Z",
      signalCount: 250,
      dateRange: { start: "2024-01-01", end: "2024-03-31" },
      perStrategy: [],
      calibration: {
        verdict: "NOT_CALIBRATED",
        buckets: [],
        monotonic5d: false,
        rankCorrelation5d: 0.1,
        warning: "uncalibrated",
      },
      riskValidation: {
        verdict: "NO_IMPROVEMENT",
        filterHelps: false,
        explanation: "no improvement",
        cohorts: [],
        warning: "filter does not help",
      },
      failureModes: {
        byStrategy: [],
        byRiskLevel: [],
        bySignalType: [],
        byScoreBucket: [],
        byBoardType: [],
        byMonth: [],
      },
      sweep: { cells: [], bestOverall: undefined, bestConservative: undefined, bestHighSignalCount: undefined },
    });
    expect(md).toContain("Score calibration FAILED");
    expect(md).toContain("does NOT improve");
  });
});
