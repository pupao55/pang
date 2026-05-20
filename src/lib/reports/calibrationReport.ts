// Calibration report — distinct from the validation report.
//
// The validation report tells you what the strategies did. The calibration
// report tells you whether you should believe the result, and which knobs to
// turn next. Output is markdown; rendered to reports/calibration-report.md
// by scripts/calibrate_strategies.ts.

import type { ScoreCalibrationResult } from "@/lib/engine/scoreCalibration";
import type { RiskFilterValidationResult } from "@/lib/engine/riskFilterValidation";
import type { StrategyQualityRow } from "@/lib/engine/strategyQuality";
import type { FailureModeBreakdowns, FailureModeGroup } from "@/lib/engine/failureModes";
import type { SweepCell, SweepResult } from "@/lib/engine/thresholdSweep";
import type { PerStrategyCalibrationRow } from "@/lib/engine/perStrategyCalibration";
import {
  renderScoreDistributionHealthMarkdown,
  type ScoreDistributionHealth,
} from "@/lib/engine/scoreDistributionHealth";

export interface CalibrationReportPayload {
  source: string;
  generatedAt: string;
  signalCount: number;
  dateRange: { start: string; end: string };
  perStrategy: StrategyQualityRow[];
  /** v1.6 — per-strategy calibration verdicts. */
  perStrategyCalibration?: PerStrategyCalibrationRow[];
  calibration: ScoreCalibrationResult;
  riskValidation: RiskFilterValidationResult;
  failureModes: FailureModeBreakdowns;
  sweep: SweepResult;
  /** v1.8 — score-bucket coverage + sector/sentiment mode echo. */
  scoreDistribution?: ScoreDistributionHealth;
}

function pct(v: number): string {
  return Number.isNaN(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}
function rate(v: number): string {
  return Number.isNaN(v) ? "—" : `${(v * 100).toFixed(1)}%`;
}
function cellLine(c: SweepCell | undefined): string {
  if (!c) return "_(no eligible cell)_";
  return `minScore=${c.minScore} · risk≤${c.maxRiskLevel} · hold=${c.holdingWindow}d → n=${c.signalCount}, avg=${pct(c.avgReturn)}, win=${rate(c.winRate)}, worst=${pct(c.worstReturn)}, risk-adj=${c.riskAdjusted.toFixed(2)}`;
}

function thresholdSuggestions(p: CalibrationReportPayload): string[] {
  const out: string[] = [];
  const { bestOverall, bestConservative } = p.sweep;
  if (bestOverall) {
    out.push(
      `Sweep best risk-adjusted: ${cellLine(bestOverall)}. ` +
        `Compare with current default \`minScore=60, riskLevel=LOW_MEDIUM, holdingWindow=5\`.`,
    );
  }
  if (bestConservative) {
    out.push(`Sweep best conservative (worst ≥ -10%): ${cellLine(bestConservative)}.`);
  }
  if (p.calibration.verdict === "NOT_CALIBRATED") {
    out.push(
      "Score calibration FAILED on this dataset. Re-weight components in `SCORE_WEIGHTS` " +
        "or recalibrate `ACTION_THRESHOLDS` before raising the `minScore` gate.",
    );
  }
  if (p.riskValidation.verdict === "NO_IMPROVEMENT") {
    out.push(
      "Stricter risk filtering does NOT improve forward returns. Drill into the " +
        "byRiskLevel failure-mode table — some risk reasons may be firing on signals that " +
        "would otherwise be profitable.",
    );
  }
  return out;
}

function passingStrategies(rows: StrategyQualityRow[]): StrategyQualityRow[] {
  return rows.filter((r) => r.recommendation === "KEEP_CANDIDATE");
}
function failingStrategies(rows: StrategyQualityRow[]): StrategyQualityRow[] {
  return rows.filter((r) => r.recommendation === "DISABLE_CANDIDATE");
}
function modifyStrategies(rows: StrategyQualityRow[]): StrategyQualityRow[] {
  return rows.filter((r) => r.recommendation === "MODIFY_CANDIDATE");
}
function smallSampleStrategies(rows: StrategyQualityRow[]): StrategyQualityRow[] {
  return rows.filter((r) => r.recommendation === "NEEDS_MORE_DATA");
}

function joinList(xs: string[]): string {
  return xs.length === 0 ? "_(none)_" : xs.join(", ");
}

function failureTable(rows: FailureModeGroup[]): string {
  if (rows.length === 0) return "_(no losing signals)_";
  const top = rows.slice(0, 10);
  const lines: string[] = [];
  lines.push("| Key | Count | avg loss | worst loss | top risk reasons |");
  lines.push("|---|---:|---:|---:|---|");
  for (const r of top) {
    const reasons = r.topReasons.map((x) => `${x.reason} (${x.count})`).join("; ");
    lines.push(
      `| ${r.key} | ${r.count} | ${pct(r.avgLossPct)} | ${pct(r.worstLossPct)} | ${reasons || "—"} |`,
    );
  }
  return lines.join("\n");
}

export function renderCalibrationReport(p: CalibrationReportPayload): string {
  const passing = passingStrategies(p.perStrategy);
  const failing = failingStrategies(p.perStrategy);
  const modify = modifyStrategies(p.perStrategy);
  const small = smallSampleStrategies(p.perStrategy);

  const lines: string[] = [];
  lines.push(`# Pangzi calibration report — ${p.source}`);
  lines.push("");
  lines.push(`Generated ${p.generatedAt}.`);
  lines.push("");
  lines.push(
    "> ⚠️ Research output. Past returns do not predict future returns. " +
      "Verify before trading.",
  );
  lines.push("");

  lines.push("## Executive summary");
  lines.push("");
  lines.push(`- Source: \`${p.source}\``);
  lines.push(`- Date range: ${p.dateRange.start} → ${p.dateRange.end}`);
  lines.push(`- Historical signals analysed: ${p.signalCount.toLocaleString()}`);
  lines.push(`- Score calibration: **${p.calibration.verdict}** (corr=${p.calibration.rankCorrelation5d.toFixed(3)})`);
  lines.push(`- Risk filter: **${p.riskValidation.verdict}**`);
  lines.push("");
  lines.push(`- Strategies passing validation: ${joinList(passing.map((s) => s.strategyId))}`);
  lines.push(`- Strategies recommended to MODIFY: ${joinList(modify.map((s) => s.strategyId))}`);
  lines.push(`- Strategies recommended to DISABLE: ${joinList(failing.map((s) => s.strategyId))}`);
  lines.push(`- Strategies with insufficient data: ${joinList(small.map((s) => s.strategyId))}`);
  lines.push("");

  lines.push("## Per-strategy quality");
  lines.push("");
  lines.push(
    "| Strategy | N | sample | avg5d | win5d | worst5d | avg score | rec | reason |",
  );
  lines.push("|---|---:|---|---:|---:|---:|---:|---|---|");
  for (const r of p.perStrategy) {
    lines.push(
      `| ${r.strategyId} | ${r.signalCount} | ${r.sampleSizeBadge} | ${pct(r.avg5dReturn)} | ${rate(r.winRate5d)} | ${pct(r.worstReturn)} | ${r.averageScore.toFixed(1)} | **${r.recommendation}** | ${r.reasons.join(" ")} |`,
    );
  }
  lines.push("");

  if (p.perStrategyCalibration && p.perStrategyCalibration.length > 0) {
    lines.push("## Per-strategy calibration (v1.6)");
    lines.push("");
    lines.push(
      "Per-strategy verdicts give better resolution than the global verdict — a single " +
        "well-tuned strategy can be masked by noise from other strategies in the same dataset.",
    );
    lines.push("");
    lines.push(
      "| Strategy | N | Calibration | Risk filter | Quality | Sweep best (n≥30) |",
    );
    lines.push("|---|---:|---|---|---|---|");
    for (const r of p.perStrategyCalibration) {
      const sweepBest = r.sweep.bestOverall
        ? `minScore=${r.sweep.bestOverall.minScore} hold=${r.sweep.bestOverall.holdingWindow}d avg=${pct(r.sweep.bestOverall.avgReturn)}`
        : "_(no eligible cell)_";
      lines.push(
        `| ${r.strategyId} | ${r.signalCount} | **${r.calibrationVerdict}** | **${r.riskVerdict}** | **${r.overall}** | ${sweepBest} |`,
      );
    }
    lines.push("");
  }

  if (p.scoreDistribution) {
    lines.push("## Score distribution health (v1.8)");
    lines.push(renderScoreDistributionHealthMarkdown(p.scoreDistribution));
    lines.push("");
  }

  lines.push("## Score calibration");
  lines.push("");
  lines.push(
    `Verdict: **${p.calibration.verdict}** · monotonic5d=${p.calibration.monotonic5d} · rank correlation=${p.calibration.rankCorrelation5d.toFixed(3)}`,
  );
  if (p.calibration.warning) {
    lines.push("");
    lines.push(`> ⚠️ ${p.calibration.warning}`);
  }
  lines.push("");
  lines.push("| Bucket | N | +1d | +3d | +5d | +10d | win 5d | worst 5d | avg risk |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const b of p.calibration.buckets) {
    lines.push(
      `| ${b.bucket} | ${b.signalCount} | ${pct(b.avgR1)} | ${pct(b.avgR3)} | ${pct(b.avgR5)} | ${pct(b.avgR10)} | ${rate(b.winRate5d)} | ${pct(b.worstR5)} | ${b.avgRiskLevelEncoded.toFixed(2)} |`,
    );
  }
  lines.push("");

  lines.push("## Risk filter effectiveness");
  lines.push("");
  lines.push(`Verdict: **${p.riskValidation.verdict}** · filterHelps=${p.riskValidation.filterHelps}`);
  if (p.riskValidation.explanation) {
    lines.push("");
    lines.push(`_${p.riskValidation.explanation}_`);
  }
  if (
    p.riskValidation.warning &&
    p.riskValidation.warning !== p.riskValidation.explanation
  ) {
    lines.push("");
    lines.push(`> ⚠️ ${p.riskValidation.warning}`);
  }
  lines.push("");
  lines.push("| Cohort | N | skipped | avg +5d | win 5d | worst 5d | cum proxy |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const c of p.riskValidation.cohorts) {
    lines.push(
      `| ${c.cohort} | ${c.signalCount} | ${c.skippedCount} | ${pct(c.avgR5)} | ${rate(c.winRate5d)} | ${pct(c.worstR5)} | ${(c.cumulativeReturnProxy * 100).toFixed(2)}% |`,
    );
  }
  lines.push("");

  lines.push("## Top 10 failure modes");
  lines.push("");
  lines.push("### by strategy");
  lines.push("");
  lines.push(failureTable(p.failureModes.byStrategy));
  lines.push("");
  lines.push("### by risk level");
  lines.push("");
  lines.push(failureTable(p.failureModes.byRiskLevel));
  lines.push("");
  lines.push("### by signal type");
  lines.push("");
  lines.push(failureTable(p.failureModes.bySignalType));
  lines.push("");
  lines.push("### by score bucket");
  lines.push("");
  lines.push(failureTable(p.failureModes.byScoreBucket));
  lines.push("");
  lines.push("### by board type");
  lines.push("");
  lines.push(failureTable(p.failureModes.byBoardType));
  lines.push("");
  lines.push("### by month");
  lines.push("");
  lines.push(failureTable(p.failureModes.byMonth));
  lines.push("");

  lines.push("## Threshold sweep");
  lines.push("");
  lines.push(`- Best overall (risk-adjusted, n≥30): ${cellLine(p.sweep.bestOverall)}`);
  lines.push(`- Best conservative (worst ≥ -10%, n≥30): ${cellLine(p.sweep.bestConservative)}`);
  lines.push(`- Best high-signal-count (positive avg): ${cellLine(p.sweep.bestHighSignalCount)}`);
  lines.push("");
  lines.push("Top 15 cells by risk-adjusted score (n≥30):");
  lines.push("");
  lines.push("| minScore | risk≤ | hold | n | avg | win | worst | risk-adj |");
  lines.push("|---:|---|---:|---:|---:|---:|---:|---:|");
  const eligible = p.sweep.cells
    .filter((c) => c.signalCount >= 30 && !Number.isNaN(c.riskAdjusted))
    .sort((a, b) => b.riskAdjusted - a.riskAdjusted)
    .slice(0, 15);
  for (const c of eligible) {
    lines.push(
      `| ${c.minScore} | ${c.maxRiskLevel} | ${c.holdingWindow} | ${c.signalCount} | ${pct(c.avgReturn)} | ${rate(c.winRate)} | ${pct(c.worstReturn)} | ${c.riskAdjusted.toFixed(2)} |`,
    );
  }
  lines.push("");

  lines.push("## Recommended threshold changes");
  lines.push("");
  const suggestions = thresholdSuggestions(p);
  if (suggestions.length === 0) {
    lines.push("_No urgent threshold changes — current defaults look reasonable on this dataset._");
  } else {
    for (const s of suggestions) lines.push(`- ${s}`);
  }
  lines.push("");

  return lines.join("\n");
}
