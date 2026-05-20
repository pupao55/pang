import { describe, expect, it } from "vitest";
import { renderHorizonReport } from "@/lib/reports/horizonCalibrationReport";

describe("renderHorizonReport", () => {
  it("emits the canonical sections + does not promise constants will change", () => {
    const md = renderHorizonReport({
      source: "baostockLocal",
      totalSignals: 1000,
      signalsWithComponents: 1000,
      horizon: {
        overall: {
          signalCount: 1000,
          avgReturn1d: 0.8,
          avgReturn2d: 0.7,
          avgReturn3d: 0.5,
          avgReturn5d: 0.2,
          avgReturn10d: 0,
          winRate1d: 0.58,
          winRate2d: 0.55,
          winRate3d: 0.52,
          winRate5d: 0.5,
          winRate10d: 0.5,
          bestHorizon: "1d",
          worstHorizon: "10d",
          horizonProfile: "MOMENTUM_1D",
        },
        perStrategy: [],
        perScoreBucket: [
          {
            key: "80-90",
            stat: {
              signalCount: 60,
              avgReturn1d: 2,
              avgReturn2d: 1.5,
              avgReturn3d: 1.0,
              avgReturn5d: 0.3,
              avgReturn10d: 0.0,
              winRate1d: 0.65,
              winRate2d: 0.6,
              winRate3d: 0.55,
              winRate5d: 0.5,
              winRate10d: 0.48,
              bestHorizon: "1d",
              worstHorizon: "10d",
              horizonProfile: "MOMENTUM_1D",
            },
          },
        ],
      },
      sweep: {
        totalCombinations: 100,
        evaluated: 100,
        best5dWeights: {
          horizon: "5d",
          weights: {
            technical: 0.3,
            sector: 0.25,
            sentiment: 0.2,
            liquidity: 0.15,
            fundamentalSafety: 0.1,
          },
          monotonic: true,
          topBucketSamples: 60,
          topBucketAvg: 1.2,
          topBucketWinRate: 0.6,
          calibrationScore: 80,
        },
      },
      sectorLeader: {
        baseline: {
          variant: {
            minSectorRankPercentile: 100,
            minStockRankWithinSectorPercentile: 100,
            minMemberCount: 0,
            allowSyntheticGroups: true,
            sectorTypeAllowed: "ALL",
          },
          signalCount: 18800,
          avgReturn1d: 0.5,
          avgReturn3d: 0.2,
          avgReturn5d: -0.1,
          winRate1d: 0.52,
          winRate3d: 0.49,
          winRate5d: 0.46,
          worstReturn5d: -25,
          bestHorizon: "1d",
          recommendedAction: "TOO_BROAD",
        },
        variants: [],
      },
      firstBreakout: {
        counts: {
          entered: {
            minHistory: 1000,
            sixtyDayRiseCap: 900,
            platformBreakout: 800,
            volumeExpansion: 200,
            turnoverExpansion: 50,
            sectorStrength: 30,
            totalCandidates: 1000,
          },
          rejected: {
            minHistory: 100,
            sixtyDayRiseCap: 100,
            platformBreakout: 600,
            volumeExpansion: 150,
            turnoverExpansion: 20,
            sectorStrength: 10,
            totalCandidates: 0,
          },
          passed: 20,
        },
        rejectionRate: {
          minHistory: 0.1,
          sixtyDayRiseCap: 0.11,
          platformBreakout: 0.75,
          volumeExpansion: 0.75,
          turnoverExpansion: 0.4,
          sectorStrength: 0.33,
          totalCandidates: 0,
        },
        weakestGate: "platformBreakout",
        likelyTooStrict: true,
        suggestedRelaxation: "Widen lookback or accept near-breakout.",
      },
    });
    expect(md).toContain("# Horizon Calibration Report");
    expect(md).toContain("## Executive Summary");
    expect(md).toContain("## 4. Score weight sweep");
    expect(md).toContain("## 5. SectorLeader tightening sweep");
    expect(md).toContain("## 6. FirstBreakout gate review");
    // Should not promise auto-edit of constants.
    expect(md).toContain("not modified");
  });
});
