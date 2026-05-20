// Score weight sweep (v1.9).
//
// Given a corpus of historical signals that already carry their per-component
// scores (technical / sector / sentiment / liquidity / fundamentalSafety) and
// risk penalty, evaluate alternative weight combinations to see which set
// produces the cleanest score → forward-return monotonicity at each holding
// horizon. The sweep is *advisory*: it never edits constants.ts. The output
// is a list of recommendations the human reviews before any production change.

import type { ForwardReturnResolver, HistoricalSignalRecord } from "./scoreCalibration";

export interface ScoreWeights {
  technical: number;
  sector: number;
  sentiment: number;
  liquidity: number;
  fundamentalSafety: number;
}

const WEIGHT_GRID: Record<keyof ScoreWeights, number[]> = {
  technical: [0.25, 0.3, 0.35, 0.4],
  sector: [0.1, 0.15, 0.2, 0.25, 0.3],
  sentiment: [0.1, 0.15, 0.2],
  liquidity: [0.1, 0.15, 0.2],
  fundamentalSafety: [0.05, 0.1],
};

export type SweepHorizonKey = "1d" | "3d" | "5d" | "10d";
const SWEEP_HORIZONS: { key: SweepHorizonKey; bars: number }[] = [
  { key: "1d", bars: 1 },
  { key: "3d", bars: 3 },
  { key: "5d", bars: 5 },
  { key: "10d", bars: 10 },
];

const SCORE_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "90-100", min: 90, max: 100.01 },
  { label: "80-90", min: 80, max: 90 },
  { label: "70-80", min: 70, max: 80 },
  { label: "60-70", min: 60, max: 70 },
  { label: "<60", min: -Infinity, max: 60 },
];

const TOP_BUCKET_LABELS = ["90-100", "80-90"]; // top-decile cohort
const MIN_TOP_BUCKET_SAMPLES = 30;

export interface BucketEval {
  bucket: string;
  signalCount: number;
  avgReturn: number;
  winRate: number;
}

export interface HorizonSweepResult {
  horizon: SweepHorizonKey;
  weights: ScoreWeights;
  monotonic: boolean;
  topBucketSamples: number;
  topBucketAvg: number;
  topBucketWinRate: number;
  /**
   * Composite score combining monotonicity bonus + top bucket edge + sample
   * adequacy. Higher is better. Range roughly [-100, +200] in practice.
   */
  calibrationScore: number;
}

export interface WeightSweepResult {
  totalCombinations: number;
  evaluated: number;
  best1dWeights?: HorizonSweepResult;
  best3dWeights?: HorizonSweepResult;
  best5dWeights?: HorizonSweepResult;
  best10dWeights?: HorizonSweepResult;
  /** Weight set that ranks well across multiple horizons. */
  robustWeights?: HorizonSweepResult & { medianRankAcrossHorizons: number };
  /** Bias toward sample size (≥ 50 in top bucket) and stability. */
  conservativeWeights?: HorizonSweepResult & { sampleSize: number };
  /** Optional warning if best result has small top-bucket sample. */
  warning?: string;
}

/** Enumerate every (technical, sector, sentiment, liquidity, fundamentalSafety)
 * combination that sums to ~1.0. Public for testing. */
export function enumerateWeightSets(
  grid: Record<keyof ScoreWeights, number[]> = WEIGHT_GRID,
): ScoreWeights[] {
  const out: ScoreWeights[] = [];
  for (const t of grid.technical)
    for (const sec of grid.sector)
      for (const sen of grid.sentiment)
        for (const liq of grid.liquidity)
          for (const fund of grid.fundamentalSafety) {
            const sum = t + sec + sen + liq + fund;
            if (Math.abs(sum - 1) <= 1e-9) {
              out.push({
                technical: t,
                sector: sec,
                sentiment: sen,
                liquidity: liq,
                fundamentalSafety: fund,
              });
            }
          }
  return out;
}

function bucketFor(score: number): string {
  for (const b of SCORE_BUCKETS) if (score >= b.min && score < b.max) return b.label;
  return "<60";
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
}

function winRate(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let w = 0;
  for (const x of xs) if (x > 0) w++;
  return w / xs.length;
}

/**
 * Pre-bucket helper: returns per-bucket avg + win for a given horizon. Pure
 * function so we can also expose it to the calibrationScore helper.
 */
function bucketStats(
  scoredSignals: { bucket: string; r: number }[],
): BucketEval[] {
  const byBucket = new Map<string, number[]>();
  for (const s of scoredSignals) {
    let arr = byBucket.get(s.bucket);
    if (!arr) {
      arr = [];
      byBucket.set(s.bucket, arr);
    }
    arr.push(s.r);
  }
  const order = SCORE_BUCKETS.map((b) => b.label);
  return order
    .filter((b) => byBucket.has(b))
    .map((b) => {
      const xs = byBucket.get(b)!;
      return {
        bucket: b,
        signalCount: xs.length,
        avgReturn: avg(xs),
        winRate: winRate(xs),
      };
    });
}

function isMonotonic(buckets: BucketEval[]): boolean {
  // Walk buckets from highest score to lowest; avg should be non-increasing.
  const order = SCORE_BUCKETS.map((b) => b.label);
  const ordered = order
    .map((label) => buckets.find((x) => x.bucket === label))
    .filter(Boolean) as BucketEval[];
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].avgReturn > ordered[i - 1].avgReturn + 0.05) return false;
  }
  return true;
}

/** Composite calibration score used to rank weight combinations. */
function compositeCalibrationScore(args: {
  monotonic: boolean;
  topBucketAvg: number;
  topBucketWin: number;
  topBucketSamples: number;
  rankCorr: number;
}): number {
  let s = 0;
  // Monotonicity is the strongest signal of an actually-calibrated score.
  if (args.monotonic) s += 60;
  // Top bucket edge (avg return) scaled.
  s += args.topBucketAvg * 5;
  // Win rate edge above 50%.
  s += (args.topBucketWin - 0.5) * 80;
  // Rank correlation between bucket midpoint and avg return.
  s += args.rankCorr * 40;
  // Penalize tiny samples in the top bucket.
  if (args.topBucketSamples < 30) s -= 25;
  return s;
}

function rankCorrelation(buckets: BucketEval[]): number {
  // Compare bucket midpoint to avgReturn; use a simple linear correlation.
  if (buckets.length < 2) return 0;
  const midpoint = (label: string): number => {
    if (label === "<60") return 50;
    const [a, b] = label.split("-").map(Number);
    return (a + b) / 2;
  };
  const xs = buckets.map((b) => midpoint(b.bucket));
  const ys = buckets.map((b) => b.avgReturn);
  const mx = avg(xs);
  const my = avg(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? 0 : num / denom;
}

interface PreparedSignal {
  symbol: string;
  date: string;
  tech: number;
  sec: number;
  sen: number;
  liq: number;
  fund: number;
  penalty: number;
  /** Per-horizon forward returns (cached once per signal). */
  returns: Record<SweepHorizonKey, number>;
}

function prepare(
  signals: HistoricalSignalRecord[],
  resolver: ForwardReturnResolver,
): PreparedSignal[] {
  const out: PreparedSignal[] = [];
  for (const s of signals) {
    if (
      s.technicalScore === undefined ||
      s.sectorScore === undefined ||
      s.sentimentScore === undefined ||
      s.liquidityScore === undefined ||
      s.fundamentalSafetyScore === undefined ||
      s.riskPenalty === undefined
    ) {
      continue; // skip records lacking components (pre-v1.9)
    }
    const returns: Record<SweepHorizonKey, number> = {
      "1d": resolver.resolve(s.symbol, s.date, 1),
      "3d": resolver.resolve(s.symbol, s.date, 3),
      "5d": resolver.resolve(s.symbol, s.date, 5),
      "10d": resolver.resolve(s.symbol, s.date, 10),
    };
    out.push({
      symbol: s.symbol,
      date: s.date,
      tech: s.technicalScore,
      sec: s.sectorScore,
      sen: s.sentimentScore,
      liq: s.liquidityScore,
      fund: s.fundamentalSafetyScore,
      penalty: s.riskPenalty,
      returns,
    });
  }
  return out;
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

function evaluateWeights(
  prepared: PreparedSignal[],
  w: ScoreWeights,
  horizon: { key: SweepHorizonKey; bars: number },
): HorizonSweepResult {
  const scored: { bucket: string; r: number }[] = [];
  for (const s of prepared) {
    const r = s.returns[horizon.key];
    if (Number.isNaN(r)) continue;
    const weighted =
      s.tech * w.technical +
      s.sec * w.sector +
      s.sen * w.sentiment +
      s.liq * w.liquidity +
      s.fund * w.fundamentalSafety;
    const final = clamp(weighted - s.penalty);
    scored.push({ bucket: bucketFor(final), r });
  }
  const buckets = bucketStats(scored);
  const top = buckets.filter((b) => TOP_BUCKET_LABELS.includes(b.bucket));
  const topSamples = top.reduce((s, b) => s + b.signalCount, 0);
  const topAvgWeighted =
    topSamples > 0
      ? top.reduce((s, b) => s + b.avgReturn * b.signalCount, 0) / topSamples
      : NaN;
  const topWinWeighted =
    topSamples > 0
      ? top.reduce((s, b) => s + b.winRate * b.signalCount, 0) / topSamples
      : NaN;
  const mono = isMonotonic(buckets);
  const rc = rankCorrelation(buckets);
  const calibrationScore = compositeCalibrationScore({
    monotonic: mono,
    topBucketAvg: Number.isNaN(topAvgWeighted) ? 0 : topAvgWeighted,
    topBucketWin: Number.isNaN(topWinWeighted) ? 0.5 : topWinWeighted,
    topBucketSamples: topSamples,
    rankCorr: Number.isNaN(rc) ? 0 : rc,
  });
  return {
    horizon: horizon.key,
    weights: w,
    monotonic: mono,
    topBucketSamples: topSamples,
    topBucketAvg: Number.isNaN(topAvgWeighted) ? 0 : +topAvgWeighted.toFixed(3),
    topBucketWinRate: Number.isNaN(topWinWeighted) ? 0 : +topWinWeighted.toFixed(3),
    calibrationScore: +calibrationScore.toFixed(2),
  };
}

export function runScoreWeightSweep(
  signals: HistoricalSignalRecord[],
  resolver: ForwardReturnResolver,
): WeightSweepResult {
  const weightSets = enumerateWeightSets();
  const prepared = prepare(signals, resolver);
  if (prepared.length === 0) {
    return {
      totalCombinations: weightSets.length,
      evaluated: 0,
      warning:
        "No historical signals carried component scores (technicalScore, sectorScore, …). Re-run npm run rebuild:signals -- --rebuild after upgrading to v1.9 to persist them.",
    };
  }

  const perHorizon: Record<SweepHorizonKey, HorizonSweepResult[]> = {
    "1d": [], "3d": [], "5d": [], "10d": [],
  };
  for (const h of SWEEP_HORIZONS) {
    for (const w of weightSets) {
      perHorizon[h.key].push(evaluateWeights(prepared, w, h));
    }
    perHorizon[h.key].sort((a, b) => b.calibrationScore - a.calibrationScore);
  }

  const best = {
    "1d": perHorizon["1d"][0],
    "3d": perHorizon["3d"][0],
    "5d": perHorizon["5d"][0],
    "10d": perHorizon["10d"][0],
  };

  // Robust pick: the weight set with the lowest median rank across all
  // horizons (i.e., consistently ok everywhere, not great in one).
  const rankByWeightset = new Map<string, number[]>();
  const key = (w: ScoreWeights) =>
    `${w.technical}|${w.sector}|${w.sentiment}|${w.liquidity}|${w.fundamentalSafety}`;
  for (const h of SWEEP_HORIZONS) {
    perHorizon[h.key].forEach((res, idx) => {
      const k = key(res.weights);
      let arr = rankByWeightset.get(k);
      if (!arr) {
        arr = [];
        rankByWeightset.set(k, arr);
      }
      arr.push(idx);
    });
  }
  const medianOf = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  let robustEntry: { k: string; median: number } | null = null;
  for (const [k, ranks] of rankByWeightset.entries()) {
    const m = medianOf(ranks);
    if (!robustEntry || m < robustEntry.median) robustEntry = { k, median: m };
  }
  let robust: WeightSweepResult["robustWeights"];
  if (robustEntry) {
    // Use the 5d result for that weight set as the reported card.
    const winner = perHorizon["5d"].find((r) => key(r.weights) === robustEntry!.k)!;
    robust = { ...winner, medianRankAcrossHorizons: robustEntry.median };
  }

  // Conservative pick: highest calibrationScore among 5d results with
  // topBucketSamples >= 50.
  const conservativeCandidates = perHorizon["5d"].filter(
    (r) => r.topBucketSamples >= 50,
  );
  let conservative: WeightSweepResult["conservativeWeights"];
  if (conservativeCandidates.length > 0) {
    const c = conservativeCandidates[0];
    conservative = { ...c, sampleSize: c.topBucketSamples };
  }

  const warning =
    best["5d"] && best["5d"].topBucketSamples < 50
      ? `Best 5d weight set has only ${best["5d"].topBucketSamples} signals in top bucket (90-100 + 80-90). Treat as exploratory, not as a calibration result.`
      : undefined;

  return {
    totalCombinations: weightSets.length,
    evaluated: weightSets.length,
    best1dWeights: best["1d"],
    best3dWeights: best["3d"],
    best5dWeights: best["5d"],
    best10dWeights: best["10d"],
    robustWeights: robust,
    conservativeWeights: conservative,
    warning,
  };
}
