// Risk filter validation diagnostic.
//
// Answers: "does excluding higher risk levels improve forward-return metrics?"
//
// v1.5 rules — designed to refuse a verdict when the data does not actually
// test the filter. The v1.4 pass showed that a homogeneous LOW-only cohort
// trivially produced filterHelps=true, which was misleading.
//
//   INCONCLUSIVE when ANY of:
//     - total signals < MIN_TOTAL_SAMPLES (30)
//     - LOW_MED_ONLY count < MIN_LOW_MED_SAMPLES (30)
//     - all four cohorts have identical signal counts (filter is a no-op)
//     - HIGH + FORBIDDEN combined < MIN_HIGH_FORBIDDEN_FOR_TEST (10)
//     - LOW_MED_ONLY removes < MIN_REMOVED_FRACTION (5%) of signals
//
//   IMPROVES when (and only when) all of:
//     - LOW_MED_ONLY has ≥ 30 signals
//     - filtering removes ≥ 5% of signals
//     - LOW_MED_ONLY avgR5 > ALL avgR5
//     - LOW_MED_ONLY worstR5 ≥ ALL worstR5
//     - LOW_MED_ONLY winRate5d ≥ ALL winRate5d - 0.02
//
//   NO_IMPROVEMENT when sample is sufficient and filtering removes enough
//     signals, but the stricter cohort doesn't improve on avg/worst return.

import type {
  HistoricalSignalRecord,
  ForwardReturnResolver,
} from "./scoreCalibration";

export interface RiskCohortStat {
  cohort: "ALL" | "NO_FORBIDDEN" | "NO_HIGH" | "LOW_MED_ONLY";
  signalCount: number;
  /** Number of records dropped relative to ALL. */
  skippedCount: number;
  avgR5: number;
  winRate5d: number;
  worstR5: number;
  /** Simple cumulative-return proxy: product of (1 + r/100) - 1 across the cohort. */
  cumulativeReturnProxy: number;
}

export type RiskFilterVerdict = "IMPROVES" | "NO_IMPROVEMENT" | "INCONCLUSIVE";

export interface RiskFilterValidationResult {
  cohorts: RiskCohortStat[];
  /** True if stricter cohorts strictly improve avgR5. */
  filterHelps: boolean;
  verdict: RiskFilterVerdict;
  /** Always populated — short reason for the verdict. */
  explanation: string;
  warning?: string;
}

export const MIN_TOTAL_SAMPLES = 30;
export const MIN_LOW_MED_SAMPLES = 30;
export const MIN_HIGH_FORBIDDEN_FOR_TEST = 10;
export const MIN_REMOVED_FRACTION = 0.05;

function statFor(
  cohort: RiskCohortStat["cohort"],
  signals: HistoricalSignalRecord[],
  resolver: ForwardReturnResolver,
  totalForBaseline: number,
): RiskCohortStat {
  const r5s: number[] = [];
  let wins = 0;
  let worst = Infinity;
  let logSum = 0;
  for (const s of signals) {
    const r = resolver.resolve(s.symbol, s.date, 5);
    if (Number.isNaN(r)) continue;
    r5s.push(r);
    if (r > 0) wins += 1;
    if (r < worst) worst = r;
    logSum += Math.log(1 + r / 100);
  }
  const avg = r5s.length ? r5s.reduce((s, v) => s + v, 0) / r5s.length : NaN;
  return {
    cohort,
    signalCount: signals.length,
    skippedCount: Math.max(0, totalForBaseline - signals.length),
    avgR5: r5s.length ? +avg.toFixed(2) : NaN,
    winRate5d: r5s.length ? +(wins / r5s.length).toFixed(3) : NaN,
    worstR5: r5s.length ? +worst.toFixed(2) : NaN,
    cumulativeReturnProxy: r5s.length ? +(Math.exp(logSum) - 1).toFixed(4) : 0,
  };
}

export function validateRiskFilter(
  signals: HistoricalSignalRecord[],
  resolver: ForwardReturnResolver,
): RiskFilterValidationResult {
  const all = signals;
  const noForbidden = signals.filter((s) => s.riskLevel !== "FORBIDDEN");
  const noHigh = signals.filter(
    (s) => s.riskLevel !== "FORBIDDEN" && s.riskLevel !== "HIGH",
  );
  const lowMed = signals.filter(
    (s) => s.riskLevel === "LOW" || s.riskLevel === "MEDIUM",
  );

  const total = all.length;
  const cohorts: RiskCohortStat[] = [
    statFor("ALL", all, resolver, total),
    statFor("NO_FORBIDDEN", noForbidden, resolver, total),
    statFor("NO_HIGH", noHigh, resolver, total),
    statFor("LOW_MED_ONLY", lowMed, resolver, total),
  ];
  const byCohort = Object.fromEntries(cohorts.map((c) => [c.cohort, c]));

  const allC = byCohort["ALL"];
  const lowMedC = byCohort["LOW_MED_ONLY"];

  const highForbiddenCount = signals.filter(
    (s) => s.riskLevel === "HIGH" || s.riskLevel === "FORBIDDEN",
  ).length;
  const removedFraction = total > 0 ? (total - lowMedC.signalCount) / total : 0;
  const allCohortsIdentical = cohorts.every(
    (c) => c.signalCount === allC.signalCount,
  );

  // Compute the "improves" gate using LOW_MED_ONLY vs ALL.
  let filterHelps = false;
  let avgImproves = false;
  let worstImproves = false;
  let winRateOk = false;
  if (
    !Number.isNaN(allC.avgR5) &&
    !Number.isNaN(lowMedC.avgR5) &&
    !Number.isNaN(allC.worstR5) &&
    !Number.isNaN(lowMedC.worstR5) &&
    !Number.isNaN(allC.winRate5d) &&
    !Number.isNaN(lowMedC.winRate5d)
  ) {
    avgImproves = lowMedC.avgR5 > allC.avgR5;
    worstImproves = lowMedC.worstR5 >= allC.worstR5;
    winRateOk = lowMedC.winRate5d >= allC.winRate5d - 0.02;
    filterHelps = avgImproves && worstImproves && winRateOk;
  }

  // Verdict gating, in priority order.
  let verdict: RiskFilterVerdict;
  let explanation: string;

  if (total < MIN_TOTAL_SAMPLES) {
    verdict = "INCONCLUSIVE";
    explanation = `Only ${total} total signals (< ${MIN_TOTAL_SAMPLES}); cannot evaluate risk filter.`;
  } else if (lowMedC.signalCount < MIN_LOW_MED_SAMPLES) {
    verdict = "INCONCLUSIVE";
    explanation = `LOW_MED_ONLY has ${lowMedC.signalCount} signals (< ${MIN_LOW_MED_SAMPLES}); cannot evaluate risk filter.`;
  } else if (allCohortsIdentical) {
    verdict = "INCONCLUSIVE";
    explanation =
      "Risk cohorts are identical; filter verdict is inconclusive. " +
      "Every signal in the store shares one risk level, so the filter is a no-op on this dataset.";
  } else if (highForbiddenCount < MIN_HIGH_FORBIDDEN_FOR_TEST) {
    verdict = "INCONCLUSIVE";
    explanation = `Too few HIGH/FORBIDDEN signals to evaluate risk filter (${highForbiddenCount} < ${MIN_HIGH_FORBIDDEN_FOR_TEST}).`;
  } else if (removedFraction < MIN_REMOVED_FRACTION) {
    verdict = "INCONCLUSIVE";
    explanation = `Filter removes less than ${(MIN_REMOVED_FRACTION * 100).toFixed(0)}% of signals (${(removedFraction * 100).toFixed(1)}%); verdict inconclusive.`;
  } else if (filterHelps) {
    verdict = "IMPROVES";
    explanation =
      `LOW_MED_ONLY avg5d +${(lowMedC.avgR5 - allC.avgR5).toFixed(2)}pp, ` +
      `worst5d ${lowMedC.worstR5.toFixed(2)}% vs ${allC.worstR5.toFixed(2)}%, ` +
      `win5d ${(lowMedC.winRate5d * 100).toFixed(1)}% vs ${(allC.winRate5d * 100).toFixed(1)}%.`;
  } else {
    verdict = "NO_IMPROVEMENT";
    const reasons: string[] = [];
    if (!avgImproves) reasons.push("avgR5 not improved");
    if (!worstImproves) reasons.push("worstR5 worse");
    if (!winRateOk) reasons.push("winRate5d falls >2pp");
    explanation = `Filter did not improve risk-adjusted result (${reasons.join("; ")}).`;
  }

  let warning: string | undefined;
  if (verdict === "NO_IMPROVEMENT") {
    warning =
      "Risk filter does not consistently improve forward returns on this dataset — " +
      "stricter risk exclusion is not always better. Investigate which risk reasons " +
      "are firing on otherwise-profitable signals.";
  } else if (verdict === "INCONCLUSIVE") {
    warning = explanation;
  }

  return { cohorts, filterHelps, verdict, explanation, warning };
}
