import { describe, expect, it } from "vitest";
import {
  buildRecommendations,
  renderReportMarkdown,
  summarizeByMonth,
  summarizeByStrategy,
} from "@/lib/reports/validationReport";
import type { HistoricalSignalRecord } from "@/lib/engine/scoreCalibration";

const resolver = {
  resolve: (_sym: string, _date: string, n: number) => (n === 5 ? 3 : n === 1 ? 1 : n === 3 ? 2 : 5),
};

function sig(date: string, strategyId: string, score = 75): HistoricalSignalRecord {
  return {
    date,
    symbol: "X",
    strategyId,
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

describe("validation report helpers", () => {
  it("summarizeByStrategy groups and averages forward returns", () => {
    const signals = [sig("2024-01-02", "A"), sig("2024-01-03", "A"), sig("2024-01-04", "B")];
    const out = summarizeByStrategy(signals, resolver);
    expect(out).toHaveLength(2);
    const a = out.find((x) => x.strategyId === "A")!;
    expect(a.signalCount).toBe(2);
    expect(a.avgR5).toBe(3);
  });

  it("summarizeByMonth groups by YYYY-MM", () => {
    const signals = [sig("2024-01-02", "A"), sig("2024-02-02", "A")];
    const out = summarizeByMonth(signals, resolver);
    expect(out.map((m) => m.month)).toEqual(["2024-01", "2024-02"]);
  });

  it("recommendations classify by performance and sample size", () => {
    const perStrategy = [
      { strategyId: "good", signalCount: 50, avgR1: 0, avgR3: 0, avgR5: 3, avgR10: 0, winRate5d: 0.6 },
      { strategyId: "bad", signalCount: 50, avgR1: 0, avgR3: 0, avgR5: -2, avgR10: 0, winRate5d: 0.3 },
      { strategyId: "weak", signalCount: 50, avgR1: 0, avgR3: 0, avgR5: 0.5, avgR10: 0, winRate5d: 0.45 },
      { strategyId: "tiny", signalCount: 3, avgR1: 0, avgR3: 0, avgR5: 5, avgR10: 0, winRate5d: 1 },
    ];
    const recs = buildRecommendations(perStrategy);
    expect(recs.find((r) => r.strategyId === "good")?.verdict).toBe("KEEP");
    expect(recs.find((r) => r.strategyId === "bad")?.verdict).toBe("DISABLE");
    expect(recs.find((r) => r.strategyId === "weak")?.verdict).toBe("MODIFY");
    expect(recs.find((r) => r.strategyId === "tiny")?.verdict).toBe("NEEDS_MORE_DATA");
  });

  it("renderReportMarkdown produces a well-structured document", () => {
    const md = renderReportMarkdown({
      dataset: {
        source: "akshareLocal",
        symbolCount: 5,
        barCount: 250,
        dateRange: { start: "2024-01-01", end: "2024-03-31" },
        signalCount: 12,
      },
      importReport: null,
      importWarnings: ["test warning"],
      perStrategy: [
        { strategyId: "trendPullback", signalCount: 12, avgR1: 1, avgR3: 2, avgR5: 3, avgR10: 4, winRate5d: 0.6 },
      ],
      perMonth: [{ month: "2024-01", signalCount: 12, avgR5: 3 }],
      perSignalType: [{ signalType: "BREAKOUT", signalCount: 12, avgR5: 3, winRate5d: 0.6 }],
      perRiskLevel: [{ signalType: "LOW", signalCount: 12, avgR5: 3, winRate5d: 0.6 }],
      calibration: {
        buckets: [
          { bucket: "90-100", signalCount: 0, avgR1: NaN, avgR3: NaN, avgR5: NaN, avgR10: NaN, winRate5d: NaN, worstR5: NaN, avgRiskLevelEncoded: NaN },
        ],
        monotonic5d: true,
        rankCorrelation5d: 1,
        verdict: "INCONCLUSIVE",
        warning: undefined,
      },
      riskValidation: {
        cohorts: [
          { cohort: "ALL", signalCount: 12, skippedCount: 0, avgR5: 3, winRate5d: 0.6, worstR5: -1, cumulativeReturnProxy: 0.42 },
        ],
        filterHelps: true,
        explanation: "test fixture",
        verdict: "INCONCLUSIVE",
      },
      best20: [],
      worst20: [],
      topFailureReasons: [],
      recommendations: [{ strategyId: "trendPullback", verdict: "KEEP", reason: "ok" }],
      generatedAt: "2024-03-31T12:00:00Z",
    });
    expect(md).toContain("# Pangzi validation report — akshareLocal");
    expect(md).toContain("## Dataset summary");
    expect(md).toContain("## Performance by strategy");
    expect(md).toContain("## Recommendations");
    expect(md).toContain("trendPullback");
    expect(md).toContain("**KEEP**");
  });
});
