import { describe, expect, it } from "vitest";
import { renderFirstBreakoutReport } from "@/lib/reports/firstBreakoutExperimentReport";
import type {
  FirstBreakoutExperimentResult,
  FirstBreakoutVariantResult,
} from "@/lib/engine/firstBreakoutExperiment";

function v(over: Partial<FirstBreakoutVariantResult>): FirstBreakoutVariantResult {
  return {
    variant: "strict",
    candidateCount: 1000,
    signalCount: 33,
    passRate: 0.033,
    rejected: {
      minHistory: 100,
      priorRiseCap: 200,
      platformBreakout: 600,
      volumeExpansion: 40,
      amountExpansion: 20,
      sectorStrength: 7,
      riskFilter: 0,
    },
    avgReturn1d: 1.23,
    avgReturn3d: -0.25,
    avgReturn5d: -1.72,
    avgReturn10d: -0.69,
    winRate1d: 0.55,
    winRate3d: 0.39,
    winRate5d: 0.33,
    winRate10d: 0.42,
    worstReturn5d: -8.5,
    bestReturn5d: 4.1,
    sampleSizeBadge: "LOW_CONFIDENCE",
    ...over,
  };
}

describe("renderFirstBreakoutReport", () => {
  it("renders required sections + does not promise production change", () => {
    const result: FirstBreakoutExperimentResult = {
      strict: v({}),
      relaxed: v({
        variant: "relaxed",
        signalCount: 200,
        avgReturn5d: 1.5,
        winRate5d: 0.56,
        sampleSizeBadge: "OK",
      }),
      verdict: "PROMISING_RELAXED",
      recommendation: "Relaxed wins.",
      note: "This experiment does not change production defaults.",
    };
    const md = renderFirstBreakoutReport(result, "baostockLocal");
    expect(md).toContain("# First-Breakout Experiment");
    expect(md).toContain("## Executive summary");
    expect(md).toContain("## 1. Strict vs relaxed comparison");
    expect(md).toContain("## 2. Gate failure breakdown");
    expect(md).toContain("## 3. Forward returns");
    expect(md).toContain("## 4. Sample-size note");
    expect(md).toContain("## 5. Verdict & recommendation");
    expect(md).toContain("does not change production defaults");
    expect(md).toContain("PROMISING_RELAXED");
  });

  it("emits a sample-size warning when n < 30", () => {
    const result: FirstBreakoutExperimentResult = {
      strict: v({ signalCount: 12, sampleSizeBadge: "NEEDS_MORE_DATA" }),
      relaxed: v({
        variant: "relaxed",
        signalCount: 25,
        sampleSizeBadge: "NEEDS_MORE_DATA",
      }),
      verdict: "NEEDS_MORE_DATA",
      recommendation: "Expand universe.",
      note: "n/a",
    };
    const md = renderFirstBreakoutReport(result, "baostockLocal");
    expect(md).toContain("Sample size warning");
  });
});
