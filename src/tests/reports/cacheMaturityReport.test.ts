import { describe, expect, it } from "vitest";
import { renderCacheMaturityReport } from "@/lib/reports/cacheMaturityReport";
import type { CacheMaturityReport } from "@/lib/engine/cacheMaturity";

function base(level: CacheMaturityReport["readinessLevel"]): CacheMaturityReport {
  return {
    symbolCount: 1,
    tradingDayCount: 1,
    totalBars: 100,
    averageBarsPerSymbol: 100,
    minBarsPerSymbol: 100,
    maxBarsPerSymbol: 100,
    latestDateCoverageRatio: 1,
    symbolsWithLatestDate: 1,
    symbolsWithShortHistory: [],
    sectorCoverageRatio: 0,
    sentimentCoverageRatio: 0,
    signalsByStrategy: {},
    strategiesWithEnoughSamples: [],
    strategiesNeedingMoreData: [],
    scoreBucketCoverage: {
      "90-100": 0,
      "80-90": 0,
      "70-80": 0,
      "60-70": 0,
      "<60": 0,
    },
    hasScoreCompression: true,
    riskLevelCoverage: { LOW: 0, MEDIUM: 0, HIGH: 0, FORBIDDEN: 0 },
    hasRiskDiversity: false,
    readinessLevel: level,
    readinessReasons: ["test reason"],
    nextActions: ["do thing"],
  };
}

describe("renderCacheMaturityReport", () => {
  it("renders the four readiness verdicts with the correct copy", () => {
    const not = renderCacheMaturityReport(base("NOT_READY"), {
      source: "akshareLocal",
      generatedAt: "now",
    });
    const smoke = renderCacheMaturityReport(base("SMOKE_TEST_ONLY"), {
      source: "akshareLocal",
      generatedAt: "now",
    });
    const early = renderCacheMaturityReport(base("EARLY_RESEARCH"), {
      source: "akshareLocal",
      generatedAt: "now",
    });
    const ready = renderCacheMaturityReport(base("RESEARCH_READY"), {
      source: "akshareLocal",
      generatedAt: "now",
    });
    expect(not).toContain("NOT_READY");
    expect(not).toContain("workflow validation only");
    expect(smoke).toContain("SMOKE_TEST_ONLY");
    expect(early).toContain("EARLY_RESEARCH");
    expect(early).toContain("preliminary strategy debugging");
    expect(ready).toContain("RESEARCH_READY");
    expect(ready).toContain("meaningful strategy comparison");
  });

  it("surfaces score compression and risk diversity warnings", () => {
    const md = renderCacheMaturityReport(base("SMOKE_TEST_ONLY"), {
      source: "akshareLocal",
      generatedAt: "now",
    });
    expect(md).toContain("Score compression detected");
    expect(md).toContain("No risk diversity");
  });

  it("emits next-action checkboxes", () => {
    const md = renderCacheMaturityReport(base("SMOKE_TEST_ONLY"), {
      source: "akshareLocal",
      generatedAt: "now",
    });
    expect(md).toContain("- [ ] do thing");
  });
});
