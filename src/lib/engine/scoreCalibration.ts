// Score calibration diagnostic.
//
// Answers: "do higher scores actually outperform lower scores on this dataset?"
//
// Inputs: a flat list of point-in-time historical signals (the signal store
// JSONL) plus a function that resolves forward N-day return for a given
// (symbol, signal-date). Output: per-bucket averages and a monotonicity verdict.

import type { StockDailyBar } from "@/lib/types/stock";
import type { RiskLevel } from "@/lib/types/signal";

export interface HistoricalSignalRecord {
  date: string;
  symbol: string;
  name?: string;
  strategyId: string;
  score: number;
  riskLevel: RiskLevel;
  signalType: string;
  suggestedAction: string;
  keySupport: number;
  keyResistance: number;
  stopLoss: number;
  target1: number;
  target2: number;
  explanation: string[];
  risks: string[];
  /**
   * v1.9 — component scores persisted so weight sweeps can recompute
   * alternative total scores without re-running the engine. Optional for
   * backwards compatibility with v1.0-v1.8 stores.
   */
  technicalScore?: number;
  sectorScore?: number;
  sentimentScore?: number;
  liquidityScore?: number;
  fundamentalSafetyScore?: number;
  riskPenalty?: number;
}

export interface ScoreBucketStat {
  bucket: string;
  signalCount: number;
  /** Average forward 1/3/5/10-day returns, percent. */
  avgR1: number;
  avgR3: number;
  avgR5: number;
  avgR10: number;
  /** Win rate over forward 5-day return. */
  winRate5d: number;
  /** Worst single 5-day loss in the bucket, percent. */
  worstR5: number;
  /** Average riskLevel encoded numerically (LOW=1..FORBIDDEN=4). */
  avgRiskLevelEncoded: number;
}

export type CalibrationVerdict = "CALIBRATED" | "NOT_CALIBRATED" | "INCONCLUSIVE";

export interface ScoreCalibrationResult {
  buckets: ScoreBucketStat[];
  /**
   * True if the 5-day average return is non-decreasing as bucket score
   * increases — a basic monotonicity sanity check.
   */
  monotonic5d: boolean;
  /** Spearman-style rank correlation between bucket midpoint and avgR5. */
  rankCorrelation5d: number;
  /**
   * Combined verdict (v1.3):
   *   CALIBRATED      — monotonic5d AND rankCorrelation5d ≥ 0.4
   *                     AND ≥ 2 buckets have ≥ 30 samples each
   *   NOT_CALIBRATED  — sufficient sample but monotonicity/correlation fail
   *   INCONCLUSIVE    — fewer than 2 buckets meet the 30-sample floor
   */
  verdict: CalibrationVerdict;
  /** Set if calibration is judged poor; surfaced as a warning in reports. */
  warning?: string;
}

const MIN_PER_BUCKET = 30;

const BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "90-100", min: 90, max: 100.01 },
  { label: "80-90", min: 80, max: 90 },
  { label: "70-80", min: 70, max: 80 },
  { label: "60-70", min: 60, max: 70 },
  { label: "<60", min: -Infinity, max: 60 },
];

function bucketFor(score: number): string {
  for (const b of BUCKETS) if (score >= b.min && score < b.max) return b.label;
  return "<60";
}

function encodeRisk(r: RiskLevel): number {
  return r === "LOW" ? 1 : r === "MEDIUM" ? 2 : r === "HIGH" ? 3 : 4;
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
}

/** Spearman rank correlation between two parallel arrays. */
function spearman(x: number[], y: number[]): number {
  if (x.length < 2) return 0;
  const rank = (a: number[]): number[] => {
    const idx = a.map((v, i) => ({ v, i })).sort((m, n) => m.v - n.v);
    const ranks = new Array<number>(a.length);
    for (let r = 0; r < idx.length; r++) ranks[idx[r].i] = r + 1;
    return ranks;
  };
  const rx = rank(x);
  const ry = rank(y);
  const n = x.length;
  const mean = (n + 1) / 2;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i] - mean;
    const b = ry[i] - mean;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? 0 : num / denom;
}

export interface ForwardReturnResolver {
  /** Returns percent return between (date) and (date + nTradingBars), or NaN. */
  resolve(symbol: string, date: string, nTradingBars: number): number;
}

export function makeBarBasedResolver(
  barsBySymbol: Record<string, StockDailyBar[]>,
): ForwardReturnResolver {
  // Build a per-symbol date->index map once for fast lookup.
  const indexMap = new Map<string, Map<string, number>>();
  for (const sym of Object.keys(barsBySymbol)) {
    const m = new Map<string, number>();
    const bars = barsBySymbol[sym];
    for (let i = 0; i < bars.length; i++) m.set(bars[i].date, i);
    indexMap.set(sym, m);
  }
  return {
    resolve(symbol, date, n) {
      const m = indexMap.get(symbol);
      const bars = barsBySymbol[symbol];
      if (!m || !bars) return NaN;
      const i = m.get(date);
      if (i === undefined) return NaN;
      const j = i + n;
      if (j >= bars.length) return NaN;
      const entry = bars[i].close;
      if (entry <= 0) return NaN;
      return ((bars[j].close - entry) / entry) * 100;
    },
  };
}

export function calibrateScores(
  signals: HistoricalSignalRecord[],
  resolver: ForwardReturnResolver,
): ScoreCalibrationResult {
  const byBucket = new Map<string, HistoricalSignalRecord[]>();
  for (const s of signals) {
    const k = bucketFor(s.score);
    (byBucket.get(k) ?? byBucket.set(k, []).get(k)!).push(s);
  }

  const bucketsOrdered = BUCKETS.map((b) => b.label);
  const out: ScoreBucketStat[] = [];
  for (const label of bucketsOrdered) {
    const list = byBucket.get(label) ?? [];
    const r1: number[] = [];
    const r3: number[] = [];
    const r5: number[] = [];
    const r10: number[] = [];
    const risks: number[] = [];
    let wins5 = 0;
    let worst5 = Infinity;
    for (const s of list) {
      const a = resolver.resolve(s.symbol, s.date, 1);
      const b = resolver.resolve(s.symbol, s.date, 3);
      const c = resolver.resolve(s.symbol, s.date, 5);
      const d = resolver.resolve(s.symbol, s.date, 10);
      if (!Number.isNaN(a)) r1.push(a);
      if (!Number.isNaN(b)) r3.push(b);
      if (!Number.isNaN(c)) {
        r5.push(c);
        if (c > 0) wins5 += 1;
        if (c < worst5) worst5 = c;
      }
      if (!Number.isNaN(d)) r10.push(d);
      risks.push(encodeRisk(s.riskLevel));
    }
    out.push({
      bucket: label,
      signalCount: list.length,
      avgR1: r1.length ? +avg(r1).toFixed(2) : NaN,
      avgR3: r3.length ? +avg(r3).toFixed(2) : NaN,
      avgR5: r5.length ? +avg(r5).toFixed(2) : NaN,
      avgR10: r10.length ? +avg(r10).toFixed(2) : NaN,
      winRate5d: r5.length ? +(wins5 / r5.length).toFixed(3) : NaN,
      worstR5: r5.length ? +worst5.toFixed(2) : NaN,
      avgRiskLevelEncoded: risks.length ? +avg(risks).toFixed(2) : NaN,
    });
  }

  // Monotonicity check from 90+ down: best bucket should have ≥ avg next bucket.
  const filled = out.filter((b) => !Number.isNaN(b.avgR5));
  let monotonic = true;
  for (let i = 1; i < filled.length; i++) {
    if (filled[i - 1].avgR5 < filled[i].avgR5 - 0.25) {
      monotonic = false;
      break;
    }
  }

  // Rank correlation using bucket midpoints.
  const midpoint = (label: string): number => {
    if (label === "90-100") return 95;
    if (label === "80-90") return 85;
    if (label === "70-80") return 75;
    if (label === "60-70") return 65;
    return 50;
  };
  const xs = filled.map((b) => midpoint(b.bucket));
  const ys = filled.map((b) => b.avgR5);
  const corr = +spearman(xs, ys).toFixed(3);

  // Verdict gating (v1.3): require at least two buckets with ≥ MIN_PER_BUCKET
  // samples before issuing CALIBRATED / NOT_CALIBRATED; otherwise INCONCLUSIVE.
  const bucketsWithSamples = out.filter((b) => b.signalCount >= MIN_PER_BUCKET);
  let verdict: CalibrationVerdict;
  if (bucketsWithSamples.length < 2) {
    verdict = "INCONCLUSIVE";
  } else if (monotonic && corr >= 0.4) {
    verdict = "CALIBRATED";
  } else {
    verdict = "NOT_CALIBRATED";
  }

  let warning: string | undefined;
  if (verdict === "NOT_CALIBRATED") {
    warning =
      "Current scoring model is not calibrated on this dataset — higher score buckets " +
      "do not reliably show higher forward 5-day returns. Consider re-weighting score " +
      "components or recalibrating action thresholds.";
  } else if (verdict === "INCONCLUSIVE") {
    warning =
      `Score calibration is inconclusive: fewer than 2 buckets have ≥ ${MIN_PER_BUCKET} signals. ` +
      "Generate more historical signals before drawing conclusions.";
  }

  return {
    buckets: out,
    monotonic5d: monotonic,
    rankCorrelation5d: corr,
    verdict,
    warning,
  };
}
