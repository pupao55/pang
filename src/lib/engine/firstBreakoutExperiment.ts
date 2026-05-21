// firstBreakoutExperiment — strict vs relaxed firstBreakout A/B (T-006).
//
// Walks every (symbol, date) in the supplied universe, applies BOTH the
// strict and relaxed strategies on point-in-time bars, counts gate
// rejections, runs the resulting candidates through the same risk-filter
// path the production engine uses, and computes 1d/3d/5d/10d forward
// returns.
//
// This file is research-only. It does not register anything in the default
// strategy list and does not change any production constant.

import { firstBreakoutStrategy } from "@/lib/strategies/firstBreakoutStrategy";
import {
  firstBreakoutRelaxedStrategy,
  FIRST_BREAKOUT_RELAXED_LOOKBACK,
  FIRST_BREAKOUT_RELAXED_NEAR_RATIO,
} from "@/lib/strategies/firstBreakoutRelaxedStrategy";
import { evaluateRisk } from "@/lib/engine/riskFilter";
import { FIRST_BREAKOUT_MAX_60D_RISE_PCT, STRATEGY_LOOKBACKS } from "@/lib/config/constants";
import type { ForwardReturnResolver } from "@/lib/engine/scoreCalibration";
import type { SectorSnapshot, MarketSentimentSnapshot } from "@/lib/types/market";
import type { StockDailyBar, StockMeta } from "@/lib/types/stock";

export type FirstBreakoutVerdict =
  | "KEEP_STRICT"
  | "TEST_RELAXED"
  | "PROMISING_RELAXED"
  | "DISABLE_BOTH"
  | "NEEDS_MORE_DATA";

export type SampleSizeBadge = "NEEDS_MORE_DATA" | "LOW_CONFIDENCE" | "OK";

export interface FirstBreakoutGateCounts {
  /** History gate (≥ 61 bars) — needed before any other check. */
  minHistory: number;
  priorRiseCap: number;
  platformBreakout: number;
  volumeExpansion: number;
  amountExpansion: number;
  sectorStrength: number;
  riskFilter: number;
}

export interface FirstBreakoutVariantResult {
  variant: "strict" | "relaxed";
  candidateCount: number;
  signalCount: number;
  passRate: number;
  rejected: FirstBreakoutGateCounts;
  avgReturn1d: number;
  avgReturn3d: number;
  avgReturn5d: number;
  avgReturn10d: number;
  winRate1d: number;
  winRate3d: number;
  winRate5d: number;
  winRate10d: number;
  worstReturn5d: number;
  bestReturn5d: number;
  sampleSizeBadge: SampleSizeBadge;
}

export interface FirstBreakoutExperimentResult {
  strict: FirstBreakoutVariantResult;
  relaxed: FirstBreakoutVariantResult;
  verdict: FirstBreakoutVerdict;
  recommendation: string;
  note: string;
}

export interface FirstBreakoutExperimentInput {
  metas: StockMeta[];
  barsBySymbol: Record<string, StockDailyBar[]>;
  /** Per-date sector snapshots (the same map the calibration script builds). */
  sectorSnapshotsByDate: Map<string, SectorSnapshot[]>;
  /** Optional per-date market sentiment, used by riskFilter. */
  sentimentByDate?: Map<string, MarketSentimentSnapshot | undefined>;
  resolver: ForwardReturnResolver;
  /** Limit to the most recent N trading dates per symbol — bounds cost on large caches. */
  maxDatesPerSymbol?: number;
}

function emptyGateCounts(): FirstBreakoutGateCounts {
  return {
    minHistory: 0,
    priorRiseCap: 0,
    platformBreakout: 0,
    volumeExpansion: 0,
    amountExpansion: 0,
    sectorStrength: 0,
    riskFilter: 0,
  };
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
function badge(n: number): SampleSizeBadge {
  if (n < 30) return "NEEDS_MORE_DATA";
  if (n < 100) return "LOW_CONFIDENCE";
  return "OK";
}

function resolveSector(
  meta: StockMeta,
  sectors: SectorSnapshot[],
): SectorSnapshot | undefined {
  const byIndustry = sectors.find((s) => s.sectorName === meta.industry);
  if (byIndustry) return byIndustry;
  for (const concept of meta.concepts ?? []) {
    const m = sectors.find((s) => s.sectorName === concept);
    if (m) return m;
  }
  return undefined;
}

interface GatedOutcome {
  /** A signal that survived every gate. */
  passed: boolean;
  /** Which gate dropped this candidate (for the rejected{} accumulator). */
  rejectedAt?: keyof FirstBreakoutGateCounts;
}

/**
 * Replays the strict-strategy gates one at a time so we can attribute the
 * rejection to a specific gate. Mirrors `firstBreakoutStrategy` exactly —
 * if production logic changes, this function must be kept in sync.
 */
function runStrictGates(bars: StockDailyBar[], sector?: SectorSnapshot): GatedOutcome {
  if (bars.length < STRATEGY_LOOKBACKS.trend + 1) return { passed: false, rejectedAt: "minHistory" };

  const last = bars[bars.length - 1];
  const window60 = bars.slice(-60);
  const startPrice = window60[0].close;
  if (((last.close - startPrice) / startPrice) * 100 > FIRST_BREAKOUT_MAX_60D_RISE_PCT)
    return { passed: false, rejectedAt: "priorRiseCap" };

  const highWindow = bars.slice(-STRATEGY_LOOKBACKS.breakoutHigh - 1, -1);
  if (highWindow.length === 0) return { passed: false, rejectedAt: "platformBreakout" };
  const platformHigh = Math.max(...highWindow.map((b) => b.high));
  if (last.close <= platformHigh) return { passed: false, rejectedAt: "platformBreakout" };

  const ref = bars.slice(-11, -1);
  if (ref.length === 0) return { passed: false, rejectedAt: "volumeExpansion" };
  const avgAmount = ref.reduce((s, b) => s + b.amount, 0) / ref.length;
  const avgTurnover = ref.reduce((s, b) => s + b.turnoverRate, 0) / ref.length;
  if (!(last.amount > avgAmount * 1.5)) return { passed: false, rejectedAt: "amountExpansion" };
  if (!(last.turnoverRate > avgTurnover * 1.5))
    return { passed: false, rejectedAt: "volumeExpansion" };

  const sectorOk = !sector || sector.momentumScore >= 50 || sector.strengthRank <= 8;
  if (!sectorOk) return { passed: false, rejectedAt: "sectorStrength" };

  return { passed: true };
}

function runRelaxedGates(bars: StockDailyBar[], sector?: SectorSnapshot): GatedOutcome {
  if (bars.length < 61) return { passed: false, rejectedAt: "minHistory" };

  const last = bars[bars.length - 1];
  const window60 = bars.slice(-60);
  const startPrice = window60[0].close;
  if (((last.close - startPrice) / startPrice) * 100 > FIRST_BREAKOUT_MAX_60D_RISE_PCT)
    return { passed: false, rejectedAt: "priorRiseCap" };

  const highWindow = bars.slice(-FIRST_BREAKOUT_RELAXED_LOOKBACK - 1, -1);
  if (highWindow.length === 0) return { passed: false, rejectedAt: "platformBreakout" };
  const platformHigh = Math.max(...highWindow.map((b) => b.high));
  if (last.close < platformHigh * FIRST_BREAKOUT_RELAXED_NEAR_RATIO)
    return { passed: false, rejectedAt: "platformBreakout" };

  const ref = bars.slice(-11, -1);
  if (ref.length === 0) return { passed: false, rejectedAt: "volumeExpansion" };
  const avgAmount = ref.reduce((s, b) => s + b.amount, 0) / ref.length;
  const avgTurnover = ref.reduce((s, b) => s + b.turnoverRate, 0) / ref.length;
  if (!(last.amount > avgAmount * 1.5)) return { passed: false, rejectedAt: "amountExpansion" };
  if (!(last.turnoverRate > avgTurnover * 1.5))
    return { passed: false, rejectedAt: "volumeExpansion" };

  const sectorOk = !sector || sector.momentumScore >= 50 || sector.strengthRank <= 8;
  if (!sectorOk) return { passed: false, rejectedAt: "sectorStrength" };

  return { passed: true };
}

function aggregate(
  variant: "strict" | "relaxed",
  candidateCount: number,
  rejected: FirstBreakoutGateCounts,
  returns: { r1: number[]; r3: number[]; r5: number[]; r10: number[] },
): FirstBreakoutVariantResult {
  const signalCount = returns.r5.length;
  const passRate = candidateCount > 0 ? signalCount / candidateCount : 0;
  const r5 = returns.r5;
  return {
    variant,
    candidateCount,
    signalCount,
    passRate: +passRate.toFixed(4),
    rejected,
    avgReturn1d: +avg(returns.r1).toFixed(3),
    avgReturn3d: +avg(returns.r3).toFixed(3),
    avgReturn5d: +avg(returns.r5).toFixed(3),
    avgReturn10d: +avg(returns.r10).toFixed(3),
    winRate1d: +winRate(returns.r1).toFixed(3),
    winRate3d: +winRate(returns.r3).toFixed(3),
    winRate5d: +winRate(returns.r5).toFixed(3),
    winRate10d: +winRate(returns.r10).toFixed(3),
    worstReturn5d: r5.length ? +Math.min(...r5).toFixed(3) : NaN,
    bestReturn5d: r5.length ? +Math.max(...r5).toFixed(3) : NaN,
    sampleSizeBadge: badge(signalCount),
  };
}

/**
 * Pure verdict classifier — exported for tests.
 */
export function classifyVerdict(
  strict: FirstBreakoutVariantResult,
  relaxed: FirstBreakoutVariantResult,
): FirstBreakoutVerdict {
  if (strict.signalCount < 30 && relaxed.signalCount < 30) return "NEEDS_MORE_DATA";

  const relaxedPromising =
    relaxed.signalCount >= 100 &&
    Number.isFinite(relaxed.avgReturn5d) &&
    relaxed.avgReturn5d > 0 &&
    relaxed.winRate5d > 0.52 &&
    Number.isFinite(relaxed.worstReturn5d) &&
    relaxed.worstReturn5d > -25;
  if (relaxedPromising) return "PROMISING_RELAXED";

  const relaxedBetterSampled =
    relaxed.signalCount >= 30 &&
    relaxed.signalCount >= strict.signalCount * 1.5;
  const relaxedReturnsNotWorse =
    !Number.isFinite(strict.avgReturn5d) ||
    !Number.isFinite(relaxed.avgReturn5d) ||
    relaxed.avgReturn5d >= strict.avgReturn5d - 1; // tolerate 1pp worse

  if (relaxedBetterSampled && relaxedReturnsNotWorse) return "TEST_RELAXED";

  const bothWeak =
    strict.signalCount >= 100 &&
    relaxed.signalCount >= 100 &&
    (!Number.isFinite(strict.avgReturn5d) || strict.avgReturn5d <= 0) &&
    (!Number.isFinite(relaxed.avgReturn5d) || relaxed.avgReturn5d <= 0);
  if (bothWeak) return "DISABLE_BOTH";

  return "KEEP_STRICT";
}

function recommendationFor(verdict: FirstBreakoutVerdict, relaxed: FirstBreakoutVariantResult): string {
  switch (verdict) {
    case "PROMISING_RELAXED":
      return `Relaxed variant produced ${relaxed.signalCount} signals with +5d ${relaxed.avgReturn5d.toFixed(2)}% / win ${(relaxed.winRate5d * 100).toFixed(0)}%. Promote to a flag-gated rollout (test in /signals behind ENABLE_EXPERIMENTAL_STRATEGIES) and re-validate on a held-out 2024 cohort.`;
    case "TEST_RELAXED":
      return `Relaxed variant adds samples without materially worsening returns. Run the experiment again after the next data refresh; do not promote yet.`;
    case "KEEP_STRICT":
      return `Relaxation does not unlock enough additional signal or quality. Keep the strict default; revisit only if the universe expands.`;
    case "DISABLE_BOTH":
      return `Neither variant earns its place. Consider removing firstBreakout from the default registry in a follow-up product decision.`;
    case "NEEDS_MORE_DATA":
      return `Sample sizes too small for a verdict. Expand the BaoStock universe (current cache: 169 symbols) before re-running.`;
  }
}

export function runFirstBreakoutExperiment(
  input: FirstBreakoutExperimentInput,
): FirstBreakoutExperimentResult {
  const metaBySymbol = new Map<string, StockMeta>();
  for (const m of input.metas) metaBySymbol.set(m.symbol, m);

  const maxDates = input.maxDatesPerSymbol ?? Infinity;
  const sentByDate = input.sentimentByDate ?? new Map();

  const strictRejected = emptyGateCounts();
  const relaxedRejected = emptyGateCounts();
  let strictCandidates = 0;
  let relaxedCandidates = 0;
  const strictReturns = { r1: [] as number[], r3: [] as number[], r5: [] as number[], r10: [] as number[] };
  const relaxedReturns = { r1: [] as number[], r3: [] as number[], r5: [] as number[], r10: [] as number[] };

  for (const meta of input.metas) {
    const allBars = input.barsBySymbol[meta.symbol] ?? [];
    if (allBars.length === 0) continue;
    const startIdx = Math.max(0, allBars.length - maxDates);
    for (let i = startIdx; i < allBars.length; i++) {
      const date = allBars[i].date;
      const bars = allBars.slice(0, i + 1);
      strictCandidates++;
      relaxedCandidates++;

      const sectors = input.sectorSnapshotsByDate.get(date) ?? [];
      const sector = resolveSector(meta, sectors);
      const sentiment = sentByDate.get(date);

      // Strict pipeline
      const strictGate = runStrictGates(bars, sector);
      if (!strictGate.passed) {
        if (strictGate.rejectedAt) strictRejected[strictGate.rejectedAt]++;
      } else {
        const risk = evaluateRisk({ meta, bars, sector, sentiment });
        if (risk.excluded) {
          strictRejected.riskFilter++;
        } else {
          // Confirm the production strategy fires identically (defensive).
          const candidate = firstBreakoutStrategy({ meta, bars, sector, sentiment });
          if (candidate) {
            const r1 = input.resolver.resolve(meta.symbol, date, 1);
            const r3 = input.resolver.resolve(meta.symbol, date, 3);
            const r5 = input.resolver.resolve(meta.symbol, date, 5);
            const r10 = input.resolver.resolve(meta.symbol, date, 10);
            if (!Number.isNaN(r1)) strictReturns.r1.push(r1);
            if (!Number.isNaN(r3)) strictReturns.r3.push(r3);
            if (!Number.isNaN(r5)) strictReturns.r5.push(r5);
            if (!Number.isNaN(r10)) strictReturns.r10.push(r10);
          }
        }
      }

      // Relaxed pipeline
      const relaxedGate = runRelaxedGates(bars, sector);
      if (!relaxedGate.passed) {
        if (relaxedGate.rejectedAt) relaxedRejected[relaxedGate.rejectedAt]++;
      } else {
        const risk = evaluateRisk({ meta, bars, sector, sentiment });
        if (risk.excluded) {
          relaxedRejected.riskFilter++;
        } else {
          const candidate = firstBreakoutRelaxedStrategy({ meta, bars, sector, sentiment });
          if (candidate) {
            const r1 = input.resolver.resolve(meta.symbol, date, 1);
            const r3 = input.resolver.resolve(meta.symbol, date, 3);
            const r5 = input.resolver.resolve(meta.symbol, date, 5);
            const r10 = input.resolver.resolve(meta.symbol, date, 10);
            if (!Number.isNaN(r1)) relaxedReturns.r1.push(r1);
            if (!Number.isNaN(r3)) relaxedReturns.r3.push(r3);
            if (!Number.isNaN(r5)) relaxedReturns.r5.push(r5);
            if (!Number.isNaN(r10)) relaxedReturns.r10.push(r10);
          }
        }
      }
    }
  }

  const strict = aggregate("strict", strictCandidates, strictRejected, strictReturns);
  const relaxed = aggregate("relaxed", relaxedCandidates, relaxedRejected, relaxedReturns);
  const verdict = classifyVerdict(strict, relaxed);
  return {
    strict,
    relaxed,
    verdict,
    recommendation: recommendationFor(verdict, relaxed),
    note:
      "This experiment does not change production defaults. The relaxed variant is research-only and is not registered in the default strategy list.",
  };
}
