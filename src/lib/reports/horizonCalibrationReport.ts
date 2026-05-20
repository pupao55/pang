// Horizon-aware calibration report (v1.9).
//
// Renders a single markdown document that combines:
//   1. Horizon calibration per strategy + per score bucket
//   2. Score weight sweep recommendations
//   3. SectorLeader tightening sweep
//   4. FirstBreakout gate review
// The document is the primary deliverable — the /validation card surfaces
// only a one-line verdict and a link here.

import type {
  HorizonCalibrationResult,
  HorizonGroup,
  HorizonProfile,
  HorizonStat,
} from "@/lib/engine/horizonCalibration";
import type {
  HorizonSweepResult,
  ScoreWeights,
  WeightSweepResult,
} from "@/lib/engine/scoreWeightSweep";
import type {
  SectorLeaderTuningResult,
  SectorLeaderVariantResult,
} from "@/lib/engine/sectorLeaderTuning";
import type { FirstBreakoutGateReview } from "@/lib/engine/strategyGateReview";

export interface HorizonReportInput {
  source: string;
  totalSignals: number;
  signalsWithComponents: number;
  horizon: HorizonCalibrationResult;
  sweep: WeightSweepResult;
  sectorLeader: SectorLeaderTuningResult;
  firstBreakout: FirstBreakoutGateReview;
}

function pct(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function rate(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

function weightsRow(w: ScoreWeights): string {
  return `T ${w.technical.toFixed(2)} · Sec ${w.sector.toFixed(2)} · Sen ${w.sentiment.toFixed(2)} · Liq ${w.liquidity.toFixed(2)} · Fund ${w.fundamentalSafety.toFixed(2)}`;
}

function horizonRow(label: string, stat: HorizonStat): string {
  return `| ${label} | ${stat.signalCount} | ${pct(stat.avgReturn1d)} | ${pct(stat.avgReturn3d)} | ${pct(stat.avgReturn5d)} | ${pct(stat.avgReturn10d)} | ${rate(stat.winRate1d)} | ${rate(stat.winRate3d)} | ${rate(stat.winRate5d)} | **${stat.bestHorizon}** / ${stat.worstHorizon} | \`${stat.horizonProfile}\` |`;
}

function horizonTable(groups: HorizonGroup[]): string {
  const header =
    "| key | n | +1d | +3d | +5d | +10d | win 1d | win 3d | win 5d | best/worst | profile |\n" +
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|:---:|---|";
  return [header, ...groups.map((g) => horizonRow(g.key, g.stat))].join("\n");
}

function sweepRow(label: string, r: HorizonSweepResult | undefined): string {
  if (!r) return `| ${label} | — | — | — | — | — | — |`;
  return `| ${label} | ${weightsRow(r.weights)} | ${r.monotonic ? "✅" : "❌"} | ${r.topBucketSamples} | ${pct(r.topBucketAvg)} | ${rate(r.topBucketWinRate)} | ${r.calibrationScore.toFixed(1)} |`;
}

function variantsTable(variants: SectorLeaderVariantResult[]): string {
  const top = variants.slice(0, 10);
  const header =
    "| sec% | stock% | minMembers | synthetic | types | n | +1d | +3d | +5d | win5d | action |\n" +
    "|---:|---:|---:|:---:|---|---:|---:|---:|---:|---:|---|";
  return [
    header,
    ...top.map((r) => {
      const v = r.variant;
      return `| ${v.minSectorRankPercentile}% | ${v.minStockRankWithinSectorPercentile}% | ${v.minMemberCount} | ${v.allowSyntheticGroups ? "✓" : "✗"} | ${v.sectorTypeAllowed} | ${r.signalCount} | ${pct(r.avgReturn1d)} | ${pct(r.avgReturn3d)} | ${pct(r.avgReturn5d)} | ${rate(r.winRate5d)} | \`${r.recommendedAction}\` |`;
    }),
  ].join("\n");
}

function profileHumanRead(p: HorizonProfile): string {
  switch (p) {
    case "MOMENTUM_1D":
      return "Holds for 1 day, profits decay after — exit on close or next open.";
    case "MEAN_REVERTS_AFTER_1D":
      return "Edge collapses inside 5 days. Treat as a momentum scalp, not a swing.";
    case "SHORT_SWING_3D":
      return "Edge holds through ~3 days. Tactical swing target.";
    case "SWING_5D":
      return "Edge holds through 5 days. Suitable for the original 5-day backtest horizon.";
    case "NO_EDGE":
      return "No horizon shows positive avg return with acceptable win rate.";
    case "INCONCLUSIVE":
      return "Sample too small (< 30) to verdict.";
  }
}

export function renderHorizonReport(input: HorizonReportInput): string {
  const { horizon, sweep, sectorLeader, firstBreakout } = input;

  // Executive summary inputs
  const highScoreBucket = horizon.perScoreBucket.find(
    (b) => b.key === "80-90" || b.key === "90-100",
  );
  const highScoreProfile = highScoreBucket?.stat.horizonProfile ?? "INCONCLUSIVE";
  const sw = (r?: HorizonSweepResult) =>
    r ? weightsRow(r.weights) : "(not enough data)";
  const sectorLeaderRec = sectorLeader.bestVariant
    ? `Tighten to: sector top ${sectorLeader.bestVariant.variant.minSectorRankPercentile}%, stock top ${sectorLeader.bestVariant.variant.minStockRankWithinSectorPercentile}% of sector, ≥ ${sectorLeader.bestVariant.variant.minMemberCount} members, ${sectorLeader.bestVariant.variant.sectorTypeAllowed}, synthetic ${sectorLeader.bestVariant.variant.allowSyntheticGroups ? "allowed" : "blocked"} → ${sectorLeader.bestVariant.signalCount} signals, +5d ${pct(sectorLeader.bestVariant.avgReturn5d)}, win5d ${rate(sectorLeader.bestVariant.winRate5d)}.`
    : `No tightening variant met the KEEP threshold (avg5d > 0 and win5d > 52% with ≥ 100 signals). ${sectorLeader.warning ?? ""}`;
  const fbRec = firstBreakout.likelyTooStrict
    ? `Likely TOO STRICT — pass rate ${(
        (firstBreakout.counts.passed / Math.max(firstBreakout.counts.entered.sixtyDayRiseCap, 1)) *
        100
      ).toFixed(2)}%. Weakest gate: **${firstBreakout.weakestGate}**. ${firstBreakout.suggestedRelaxation}`
    : `Pass rate ${((firstBreakout.counts.passed / Math.max(firstBreakout.counts.entered.sixtyDayRiseCap, 1)) * 100).toFixed(2)}% — within reason. Weakest gate: ${firstBreakout.weakestGate}.`;

  const sections: string[] = [];

  sections.push(`# Horizon Calibration Report (v1.9)

> Source: \`${input.source}\` · ${input.totalSignals.toLocaleString()} historical signals (${input.signalsWithComponents.toLocaleString()} carry component scores).
>
> This report is **research output**, not a strategy change order. Constants in \`src/lib/config/constants.ts\` were not modified by the script that produced it.`);

  sections.push(`## Executive Summary

- **High-score bucket profile** (80+): \`${highScoreProfile}\` — ${profileHumanRead(highScoreProfile as HorizonProfile)}
- **Best 1d weights**: ${sw(sweep.best1dWeights)}
- **Best 5d weights**: ${sw(sweep.best5dWeights)}
- **Robust weights (best median rank across 1/3/5/10d)**: ${sw(sweep.robustWeights)}
- **Conservative weights (sample size ≥ 50)**: ${sw(sweep.conservativeWeights)}
- **SectorLeader**: ${sectorLeaderRec}
- **FirstBreakout**: ${fbRec}
${sweep.warning ? `\n> ⚠️ ${sweep.warning}` : ""}`);

  sections.push(`## 1. Overall horizon profile

${horizonTable([{ key: "overall", stat: horizon.overall }])}`);

  sections.push(`## 2. Per-strategy horizon profile

${horizonTable(horizon.perStrategy)}`);

  sections.push(`## 3. Per-score-bucket horizon profile

${horizonTable(horizon.perScoreBucket)}

**Interpretation**: if the top buckets show \`MOMENTUM_1D\` or \`MEAN_REVERTS_AFTER_1D\`, the score model is selecting valid setups but the 5-day backtest horizon is wrong. If they show \`NO_EDGE\` the score model itself needs a redesign.`);

  sections.push(`## 4. Score weight sweep (advisory)

Weight grid evaluated: ${sweep.totalCombinations} combinations × 4 horizons. The constants file is **not** modified — these are research outputs.

| horizon | weights | monotonic? | top-bucket n | top-bucket avg | top-bucket win | calibrationScore |
|---|---|:---:|---:|---:|---:|---:|
${[
  sweepRow("best 1d", sweep.best1dWeights),
  sweepRow("best 3d", sweep.best3dWeights),
  sweepRow("best 5d", sweep.best5dWeights),
  sweepRow("best 10d", sweep.best10dWeights),
  sweepRow("robust", sweep.robustWeights),
  sweepRow("conservative", sweep.conservativeWeights),
].join("\n")}`);

  sections.push(`## 5. SectorLeader tightening sweep

Baseline (current strategy, no extra filter): ${sectorLeader.baseline.signalCount} signals, +5d ${pct(sectorLeader.baseline.avgReturn5d)}, win5d ${rate(sectorLeader.baseline.winRate5d)}.

Top variants by +5d avg return:

${variantsTable(sectorLeader.variants)}

${sectorLeader.warning ? `> ⚠️ ${sectorLeader.warning}` : ""}`);

  sections.push(`## 6. FirstBreakout gate review

Evaluated ${firstBreakout.counts.entered.totalCandidates.toLocaleString()} (stock, date) candidates. After history gate: ${firstBreakout.counts.entered.sixtyDayRiseCap.toLocaleString()}.

| Gate | Entered | Rejected | Rejection rate |
|---|---:|---:|---:|
| 60-day rise cap | ${firstBreakout.counts.entered.sixtyDayRiseCap.toLocaleString()} | ${firstBreakout.counts.rejected.sixtyDayRiseCap.toLocaleString()} | ${(firstBreakout.rejectionRate.sixtyDayRiseCap * 100).toFixed(1)}% |
| Platform breakout | ${firstBreakout.counts.entered.platformBreakout.toLocaleString()} | ${firstBreakout.counts.rejected.platformBreakout.toLocaleString()} | ${(firstBreakout.rejectionRate.platformBreakout * 100).toFixed(1)}% |
| Volume expansion (1.5× 10d avg) | ${firstBreakout.counts.entered.volumeExpansion.toLocaleString()} | ${firstBreakout.counts.rejected.volumeExpansion.toLocaleString()} | ${(firstBreakout.rejectionRate.volumeExpansion * 100).toFixed(1)}% |
| Turnover expansion (1.5× 10d avg) | ${firstBreakout.counts.entered.turnoverExpansion.toLocaleString()} | ${firstBreakout.counts.rejected.turnoverExpansion.toLocaleString()} | ${(firstBreakout.rejectionRate.turnoverExpansion * 100).toFixed(1)}% |
| Sector strength | ${firstBreakout.counts.entered.sectorStrength.toLocaleString()} | ${firstBreakout.counts.rejected.sectorStrength.toLocaleString()} | ${(firstBreakout.rejectionRate.sectorStrength * 100).toFixed(1)}% |
| **Passed all gates** | — | — | **${firstBreakout.counts.passed.toLocaleString()}** |

- **Likely too strict?** ${firstBreakout.likelyTooStrict ? "Yes" : "No"}
- **Weakest gate**: \`${firstBreakout.weakestGate}\`
- **Suggested relaxation**: ${firstBreakout.suggestedRelaxation}`);

  sections.push(`## 7. What should change in v2

1. **Score weights** — do not push the best-1d or best-5d weight set into \`SCORE_WEIGHTS\` until the robust pick stays best across at least two horizons AND the top bucket carries ≥ 50 signals. Until then, keep the current 0.30 / 0.25 / 0.20 / 0.15 / 0.10 default.
2. **Strategy-specific horizons** — strategies with profile \`MOMENTUM_1D\` or \`MEAN_REVERTS_AFTER_1D\` should be reported with a 1d backtest horizon, not the unified 5d. The backtest engine should accept per-strategy horizons.
3. **SectorLeader filters** — apply the recommended sector-rank/member-count tightening. Do not enable until backtested out-of-sample on a held-out 2024 cohort.
4. **FirstBreakout** — relax the weakest gate identified above, or disable the strategy if no relaxation produces ≥ 30 signals/year.

These are recommendations, not orders. Run \`npm run calibrate:horizons\` again after each change to verify the move is in the right direction.

---

_Generated by_ \`scripts/horizon_calibration.ts\` _on ${new Date().toISOString().slice(0, 10)}._`);

  return sections.join("\n\n") + "\n";
}
