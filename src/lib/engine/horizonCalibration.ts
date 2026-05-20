// Horizon-aware calibration (v1.9).
//
// Answers per (strategy | score bucket) the question that single-horizon
// calibration cannot: at what holding period does the signal actually work?
// High-score limit-up-second-buy signals often show +1d momentum that
// mean-reverts by +5d — a result that looks like "NOT_CALIBRATED" when only
// the 5-day return is checked.

import type { ForwardReturnResolver, HistoricalSignalRecord } from "./scoreCalibration";

export const MIN_SAMPLES_FOR_VERDICT = 30;

export type HorizonProfile =
  | "MOMENTUM_1D"
  | "SHORT_SWING_3D"
  | "SWING_5D"
  | "MEAN_REVERTS_AFTER_1D"
  | "NO_EDGE"
  | "INCONCLUSIVE";

export type HorizonKey = "1d" | "2d" | "3d" | "5d" | "10d";

const HORIZONS: { key: HorizonKey; bars: number }[] = [
  { key: "1d", bars: 1 },
  { key: "2d", bars: 2 },
  { key: "3d", bars: 3 },
  { key: "5d", bars: 5 },
  { key: "10d", bars: 10 },
];

export interface HorizonStat {
  signalCount: number;
  avgReturn1d: number;
  avgReturn2d: number;
  avgReturn3d: number;
  avgReturn5d: number;
  avgReturn10d: number;
  winRate1d: number;
  winRate2d: number;
  winRate3d: number;
  winRate5d: number;
  winRate10d: number;
  /** Horizon with the highest avg return (among those with avg > 0). */
  bestHorizon: HorizonKey | "none";
  /** Horizon with the lowest avg return. */
  worstHorizon: HorizonKey | "none";
  horizonProfile: HorizonProfile;
}

export interface HorizonGroup {
  key: string;
  stat: HorizonStat;
}

export interface HorizonCalibrationResult {
  perStrategy: HorizonGroup[];
  perScoreBucket: HorizonGroup[];
  /** Overall — every signal in one bucket. */
  overall: HorizonStat;
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
 * Classify a horizon profile from per-horizon averages and win rates.
 * Pure function exported for testing.
 */
export function classifyHorizonProfile(stat: {
  signalCount: number;
  avgReturn1d: number;
  avgReturn2d: number;
  avgReturn3d: number;
  avgReturn5d: number;
  avgReturn10d: number;
  winRate1d: number;
  winRate3d: number;
  winRate5d: number;
}): HorizonProfile {
  if (stat.signalCount < MIN_SAMPLES_FOR_VERDICT) return "INCONCLUSIVE";

  const a1 = stat.avgReturn1d;
  const a3 = stat.avgReturn3d;
  const a5 = stat.avgReturn5d;
  const w1 = stat.winRate1d;
  const w3 = stat.winRate3d;
  const w5 = stat.winRate5d;

  const oneDayEdge = a1 > 0 && w1 > 0.55;
  const fiveDayEdge = a5 > 0 && w5 > 0.52;
  const threeDayEdge = a3 > 0 && w3 > 0.52;

  // 1d momentum that mean-reverts: 1d positive but 5d weak or negative.
  if (oneDayEdge && (a5 <= 0 || w5 < 0.5)) {
    // If 5d is materially worse than 1d, this is true mean reversion.
    if (a5 < 0 || a5 < a1 - 1) return "MEAN_REVERTS_AFTER_1D";
    return "MOMENTUM_1D";
  }

  if (fiveDayEdge && a5 >= a3) return "SWING_5D";
  if (threeDayEdge) return "SHORT_SWING_3D";
  if (!oneDayEdge && !threeDayEdge && !fiveDayEdge) return "NO_EDGE";
  // Mixed but mild — treat as inconclusive.
  return "INCONCLUSIVE";
}

function computeStat(
  signals: HistoricalSignalRecord[],
  resolver: ForwardReturnResolver,
): HorizonStat {
  const returnsByHorizon: Record<HorizonKey, number[]> = {
    "1d": [], "2d": [], "3d": [], "5d": [], "10d": [],
  };
  for (const s of signals) {
    for (const h of HORIZONS) {
      const r = resolver.resolve(s.symbol, s.date, h.bars);
      if (!Number.isNaN(r)) returnsByHorizon[h.key].push(r);
    }
  }
  const a1 = avg(returnsByHorizon["1d"]);
  const a2 = avg(returnsByHorizon["2d"]);
  const a3 = avg(returnsByHorizon["3d"]);
  const a5 = avg(returnsByHorizon["5d"]);
  const a10 = avg(returnsByHorizon["10d"]);
  const horizonAvgs: { key: HorizonKey; v: number }[] = (
    [
      { key: "1d" as HorizonKey, v: a1 },
      { key: "2d" as HorizonKey, v: a2 },
      { key: "3d" as HorizonKey, v: a3 },
      { key: "5d" as HorizonKey, v: a5 },
      { key: "10d" as HorizonKey, v: a10 },
    ]
  ).filter((x) => !Number.isNaN(x.v));
  let bestHorizon: HorizonStat["bestHorizon"] = "none";
  let worstHorizon: HorizonStat["worstHorizon"] = "none";
  if (horizonAvgs.length > 0) {
    bestHorizon = horizonAvgs.reduce((b, x) => (x.v > b.v ? x : b)).key;
    worstHorizon = horizonAvgs.reduce((b, x) => (x.v < b.v ? x : b)).key;
  }
  const stat: HorizonStat = {
    signalCount: signals.length,
    avgReturn1d: a1,
    avgReturn2d: a2,
    avgReturn3d: a3,
    avgReturn5d: a5,
    avgReturn10d: a10,
    winRate1d: winRate(returnsByHorizon["1d"]),
    winRate2d: winRate(returnsByHorizon["2d"]),
    winRate3d: winRate(returnsByHorizon["3d"]),
    winRate5d: winRate(returnsByHorizon["5d"]),
    winRate10d: winRate(returnsByHorizon["10d"]),
    bestHorizon,
    worstHorizon,
    horizonProfile: "INCONCLUSIVE",
  };
  stat.horizonProfile = classifyHorizonProfile(stat);
  return stat;
}

const SCORE_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "90-100", min: 90, max: 100.01 },
  { label: "80-90", min: 80, max: 90 },
  { label: "70-80", min: 70, max: 80 },
  { label: "60-70", min: 60, max: 70 },
  { label: "<60", min: -Infinity, max: 60 },
];

function bucketFor(score: number): string {
  for (const b of SCORE_BUCKETS) if (score >= b.min && score < b.max) return b.label;
  return "<60";
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    let arr = out.get(k);
    if (!arr) {
      arr = [];
      out.set(k, arr);
    }
    arr.push(it);
  }
  return out;
}

export function calibrateHorizons(
  signals: HistoricalSignalRecord[],
  resolver: ForwardReturnResolver,
): HorizonCalibrationResult {
  const byStrategy = groupBy(signals, (s) => s.strategyId);
  const byBucket = groupBy(signals, (s) => bucketFor(s.score));

  const perStrategy: HorizonGroup[] = [...byStrategy.entries()]
    .map(([key, ss]) => ({ key, stat: computeStat(ss, resolver) }))
    .sort((a, b) => b.stat.signalCount - a.stat.signalCount);

  const bucketOrder = SCORE_BUCKETS.map((b) => b.label);
  const perScoreBucket: HorizonGroup[] = bucketOrder
    .filter((b) => byBucket.has(b))
    .map((b) => ({ key: b, stat: computeStat(byBucket.get(b)!, resolver) }));

  return {
    perStrategy,
    perScoreBucket,
    overall: computeStat(signals, resolver),
  };
}
