// Per-strategy quality evaluation.
//
// Aggregates forward 1/3/5/10-day returns + win rates + best/worst + average
// score and risk penalty for each strategy, then issues a recommendation
// according to the v1.3 rules:
//
//   DISABLE_CANDIDATE when (n >= 100) AND avg5d < 0 AND win5d < 45% AND worst5d < -12
//   KEEP_CANDIDATE    when (n >= 100) AND avg5d > 0 AND win5d > 52% AND worst5d >= -10
//                     AND scoreCalibration is positive
//   NEEDS_MORE_DATA   when n < 30
//   LOW_CONFIDENCE    badge on any verdict if 30 <= n < 100
//   MODIFY_CANDIDATE  everything else with enough samples

import type { HistoricalSignalRecord, ForwardReturnResolver } from "./scoreCalibration";

export type StrategyRecommendation =
  | "KEEP_CANDIDATE"
  | "MODIFY_CANDIDATE"
  | "DISABLE_CANDIDATE"
  | "NEEDS_MORE_DATA";

export type SampleSizeBadge = "OK" | "LOW_CONFIDENCE" | "NEEDS_MORE_DATA";

export interface StrategyQualityRow {
  strategyId: string;
  signalCount: number;
  avg1dReturn: number;
  avg3dReturn: number;
  avg5dReturn: number;
  avg10dReturn: number;
  winRate1d: number;
  winRate3d: number;
  winRate5d: number;
  winRate10d: number;
  bestReturn: number;
  worstReturn: number;
  averageScore: number;
  averageRiskPenalty: number;
  recommendation: StrategyRecommendation;
  sampleSizeBadge: SampleSizeBadge;
  /** Specific reasons explaining the recommendation, useful in the report/UI. */
  reasons: string[];
}

export const MIN_SAMPLE_FOR_VERDICT = 30;
export const MIN_SAMPLE_FOR_STRONG_VERDICT = 100;

function sampleBadge(n: number): SampleSizeBadge {
  if (n < MIN_SAMPLE_FOR_VERDICT) return "NEEDS_MORE_DATA";
  if (n < MIN_SAMPLE_FOR_STRONG_VERDICT) return "LOW_CONFIDENCE";
  return "OK";
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
}

function winRate(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let wins = 0;
  for (const x of xs) if (x > 0) wins += 1;
  return wins / xs.length;
}

export interface StrategyQualityInput {
  signals: HistoricalSignalRecord[];
  resolver: ForwardReturnResolver;
  /** If provided, KEEP_CANDIDATE requires this strategy to appear in the
   *  "score-calibration is positive" set. Usually wired to the bucket
   *  verdict's per-strategy positive-calibration list, but for v1.3 we use a
   *  global verdict — see calibrationReport. */
  scoreCalibrationOk?: boolean;
}

export function evaluateStrategyQuality(
  input: StrategyQualityInput,
): StrategyQualityRow[] {
  const { signals, resolver, scoreCalibrationOk = true } = input;
  const grouped = new Map<string, HistoricalSignalRecord[]>();
  for (const s of signals) {
    (grouped.get(s.strategyId) ?? grouped.set(s.strategyId, []).get(s.strategyId)!).push(s);
  }
  const out: StrategyQualityRow[] = [];
  for (const [strategyId, list] of grouped) {
    const r1: number[] = [];
    const r3: number[] = [];
    const r5: number[] = [];
    const r10: number[] = [];
    for (const s of list) {
      const a = resolver.resolve(s.symbol, s.date, 1);
      const b = resolver.resolve(s.symbol, s.date, 3);
      const c = resolver.resolve(s.symbol, s.date, 5);
      const d = resolver.resolve(s.symbol, s.date, 10);
      if (!Number.isNaN(a)) r1.push(a);
      if (!Number.isNaN(b)) r3.push(b);
      if (!Number.isNaN(c)) r5.push(c);
      if (!Number.isNaN(d)) r10.push(d);
    }
    const all5 = r5.length ? r5 : r3.length ? r3 : r1;
    const best = all5.length ? Math.max(...all5) : NaN;
    const worst = all5.length ? Math.min(...all5) : NaN;
    const avgScore = +avg(list.map((s) => s.score)).toFixed(2);
    // The store keeps `score` but not the raw penalty — we leave penalty NaN
    // when the upstream record doesn't carry it. (Field reserved for v1.4.)
    const avgPenalty = NaN;
    const n = list.length;
    const badge = sampleBadge(n);

    const reasons: string[] = [];
    let rec: StrategyRecommendation;
    const avg5 = r5.length ? avg(r5) : NaN;
    const win5 = r5.length ? winRate(r5) : NaN;
    const worst5 = r5.length ? Math.min(...r5) : NaN;

    if (n < MIN_SAMPLE_FOR_VERDICT) {
      rec = "NEEDS_MORE_DATA";
      reasons.push(`Only ${n} signals; need ≥ ${MIN_SAMPLE_FOR_VERDICT} for a verdict.`);
    } else if (
      n >= MIN_SAMPLE_FOR_STRONG_VERDICT &&
      !Number.isNaN(avg5) && avg5 < 0 &&
      !Number.isNaN(win5) && win5 < 0.45 &&
      !Number.isNaN(worst5) && worst5 < -12
    ) {
      rec = "DISABLE_CANDIDATE";
      reasons.push(
        `n=${n}, avg5d=${avg5.toFixed(2)}%, win5d=${(win5 * 100).toFixed(1)}%, ` +
          `worst5d=${worst5.toFixed(2)}% — all three negative gates failed.`,
      );
    } else if (
      n >= MIN_SAMPLE_FOR_STRONG_VERDICT &&
      !Number.isNaN(avg5) && avg5 > 0 &&
      !Number.isNaN(win5) && win5 > 0.52 &&
      !Number.isNaN(worst5) && worst5 >= -10 &&
      scoreCalibrationOk
    ) {
      rec = "KEEP_CANDIDATE";
      reasons.push(
        `n=${n}, avg5d=+${avg5.toFixed(2)}%, win5d=${(win5 * 100).toFixed(1)}%, ` +
          `worst5d=${worst5.toFixed(2)}%, calibration OK.`,
      );
    } else if (n < MIN_SAMPLE_FOR_STRONG_VERDICT) {
      rec = "NEEDS_MORE_DATA";
      reasons.push(
        `n=${n} (≥ ${MIN_SAMPLE_FOR_STRONG_VERDICT} required for KEEP/DISABLE verdict).`,
      );
    } else {
      rec = "MODIFY_CANDIDATE";
      if (Number.isNaN(avg5)) reasons.push("Insufficient forward 5d returns.");
      else if (avg5 < 0) reasons.push(`avg5d=${avg5.toFixed(2)}% is negative but not severe enough to disable.`);
      else if (win5 <= 0.52) reasons.push(`win5d=${(win5 * 100).toFixed(1)}% borderline (need >52%).`);
      else if (worst5 < -10) reasons.push(`worst5d=${worst5.toFixed(2)}% breaches -10% tail risk.`);
      else if (!scoreCalibrationOk) reasons.push("Score calibration not positive on this dataset.");
      else reasons.push("Marginal — tune thresholds before keeping.");
    }

    out.push({
      strategyId,
      signalCount: n,
      avg1dReturn: r1.length ? +avg(r1).toFixed(2) : NaN,
      avg3dReturn: r3.length ? +avg(r3).toFixed(2) : NaN,
      avg5dReturn: r5.length ? +avg(r5).toFixed(2) : NaN,
      avg10dReturn: r10.length ? +avg(r10).toFixed(2) : NaN,
      winRate1d: r1.length ? +winRate(r1).toFixed(3) : NaN,
      winRate3d: r3.length ? +winRate(r3).toFixed(3) : NaN,
      winRate5d: r5.length ? +winRate(r5).toFixed(3) : NaN,
      winRate10d: r10.length ? +winRate(r10).toFixed(3) : NaN,
      bestReturn: Number.isNaN(best) ? NaN : +best.toFixed(2),
      worstReturn: Number.isNaN(worst) ? NaN : +worst.toFixed(2),
      averageScore: avgScore,
      averageRiskPenalty: avgPenalty,
      recommendation: rec,
      sampleSizeBadge: badge,
      reasons,
    });
  }
  // Sort: KEEP first, then MODIFY, then NEEDS, then DISABLE (so the user sees
  // the "use these" strategies up top).
  const order: Record<StrategyRecommendation, number> = {
    KEEP_CANDIDATE: 0,
    MODIFY_CANDIDATE: 1,
    NEEDS_MORE_DATA: 2,
    DISABLE_CANDIDATE: 3,
  };
  out.sort((a, b) => order[a.recommendation] - order[b.recommendation] || (b.avg5dReturn || -Infinity) - (a.avg5dReturn || -Infinity));
  return out;
}
