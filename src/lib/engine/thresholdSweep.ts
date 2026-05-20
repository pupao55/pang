// Threshold sweep — explore whether the current minScore / riskLevel /
// holdingWindow combination is reasonable on the cached dataset.
//
// The sweep is cheap: it filters the historical signal store and asks the
// forward-return resolver for the configured holding window. No re-running of
// the strategy engine. This intentionally avoids the temptation to overfit
// strategies in v1.3 — calibration tunes use of existing strategies, not
// strategies themselves.

import type { RiskLevel } from "@/lib/types/signal";
import type {
  ForwardReturnResolver,
  HistoricalSignalRecord,
} from "./scoreCalibration";

export type MaxRiskLevel = "LOW_ONLY" | "LOW_MEDIUM" | "LOW_MEDIUM_HIGH";

export interface SweepParams {
  minScores?: number[];
  maxRiskLevels?: MaxRiskLevel[];
  holdingWindows?: number[]; // trading days
}

export interface SweepCell {
  minScore: number;
  maxRiskLevel: MaxRiskLevel;
  holdingWindow: number;
  signalCount: number;
  avgReturn: number;
  winRate: number;
  worstReturn: number;
  /** avgReturn / max(|worstReturn|, 1) — naive risk-adjusted score. */
  riskAdjusted: number;
}

export interface SweepResult {
  cells: SweepCell[];
  /** Highest riskAdjusted with at least 30 signals. */
  bestOverall?: SweepCell;
  /** Highest avgReturn while keeping worstReturn ≥ -10% and ≥ 30 signals. */
  bestConservative?: SweepCell;
  /** Largest signalCount cell whose avgReturn is positive. */
  bestHighSignalCount?: SweepCell;
}

const DEFAULTS: Required<SweepParams> = {
  minScores: [50, 55, 60, 65, 70, 75, 80],
  maxRiskLevels: ["LOW_ONLY", "LOW_MEDIUM", "LOW_MEDIUM_HIGH"],
  holdingWindows: [1, 3, 5, 10],
};

const RISK_ALLOWLIST: Record<MaxRiskLevel, RiskLevel[]> = {
  LOW_ONLY: ["LOW"],
  LOW_MEDIUM: ["LOW", "MEDIUM"],
  LOW_MEDIUM_HIGH: ["LOW", "MEDIUM", "HIGH"],
};

function summarize(returns: number[]): {
  avg: number;
  winRate: number;
  worst: number;
} {
  if (returns.length === 0) {
    return { avg: NaN, winRate: NaN, worst: NaN };
  }
  let wins = 0;
  let worst = Infinity;
  let sum = 0;
  for (const r of returns) {
    sum += r;
    if (r > 0) wins += 1;
    if (r < worst) worst = r;
  }
  return { avg: sum / returns.length, winRate: wins / returns.length, worst };
}

export function runThresholdSweep(
  signals: HistoricalSignalRecord[],
  resolver: ForwardReturnResolver,
  params: SweepParams = {},
): SweepResult {
  const cfg = { ...DEFAULTS, ...params };
  const cells: SweepCell[] = [];

  for (const minScore of cfg.minScores) {
    for (const maxRisk of cfg.maxRiskLevels) {
      const allow = new Set(RISK_ALLOWLIST[maxRisk]);
      const filtered = signals.filter(
        (s) => s.score >= minScore && allow.has(s.riskLevel),
      );
      for (const window of cfg.holdingWindows) {
        const returns: number[] = [];
        for (const s of filtered) {
          const r = resolver.resolve(s.symbol, s.date, window);
          if (!Number.isNaN(r)) returns.push(r);
        }
        const s = summarize(returns);
        const risk = Number.isNaN(s.worst)
          ? NaN
          : s.avg / Math.max(Math.abs(s.worst), 1);
        cells.push({
          minScore,
          maxRiskLevel: maxRisk,
          holdingWindow: window,
          signalCount: returns.length,
          avgReturn: Number.isNaN(s.avg) ? NaN : +s.avg.toFixed(2),
          winRate: Number.isNaN(s.winRate) ? NaN : +s.winRate.toFixed(3),
          worstReturn: Number.isNaN(s.worst) ? NaN : +s.worst.toFixed(2),
          riskAdjusted: Number.isNaN(risk) ? NaN : +risk.toFixed(3),
        });
      }
    }
  }

  const eligible = cells.filter((c) => c.signalCount >= 30);

  const bestOverall = pickBest(eligible, (c) =>
    Number.isNaN(c.riskAdjusted) ? -Infinity : c.riskAdjusted,
  );
  const bestConservative = pickBest(
    eligible.filter((c) => !Number.isNaN(c.worstReturn) && c.worstReturn >= -10),
    (c) => (Number.isNaN(c.avgReturn) ? -Infinity : c.avgReturn),
  );
  const bestHighSignalCount = pickBest(
    cells.filter((c) => !Number.isNaN(c.avgReturn) && c.avgReturn > 0),
    (c) => c.signalCount,
  );

  return { cells, bestOverall, bestConservative, bestHighSignalCount };
}

function pickBest<T>(items: T[], key: (t: T) => number): T | undefined {
  if (items.length === 0) return undefined;
  let best = items[0];
  let bestKey = key(best);
  for (let i = 1; i < items.length; i++) {
    const k = key(items[i]);
    if (k > bestKey) {
      best = items[i];
      bestKey = k;
    }
  }
  return best;
}
