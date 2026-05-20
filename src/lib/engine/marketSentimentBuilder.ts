// Build a per-date MarketSentimentSnapshot from cached daily bars.
//
// Rationale: AkShare does not expose a single "market sentiment" endpoint.
// v1.6 derives it from the union of cached bars so the signal engine can
// operate on real regime estimates instead of the mock fallback.
//
// Pure function — caller provides the universe of bars; CLI wrapper handles
// filesystem I/O and writes data/akshare/sentiment/sentiment.jsonl.

import type { MarketRegime, MarketSentimentSnapshot } from "@/lib/types/market";
import type { BoardType, StockDailyBar, StockMeta } from "@/lib/types/stock";
import { LIMIT_UP_THRESHOLDS } from "@/lib/config/constants";

export interface SentimentBuilderConfig {
  /** Multiplier on the limit threshold to decide "limit-up close" (default 0.98). */
  limitUpCloseRatio: number;
  /** Multiplier on the limit-up high vs limit price to flag 炸板 (default 0.998). */
  failedHighTolerance: number;
  /** STRONG/WEAK/PANIC thresholds. */
  regimeThresholds: {
    strongLimitUpCount: number;
    weakLimitUpCount: number;
    panicMedianReturnPct: number;
    panicLimitDownCount: number;
  };
}

export const DEFAULT_SENTIMENT_CONFIG: SentimentBuilderConfig = {
  limitUpCloseRatio: 0.98,
  failedHighTolerance: 0.998,
  regimeThresholds: {
    strongLimitUpCount: 50,
    weakLimitUpCount: 15,
    panicMedianReturnPct: -2.0,
    panicLimitDownCount: 30,
  },
};

interface SymbolBars {
  symbol: string;
  bars: StockDailyBar[];
  boardType: BoardType;
}

export interface SentimentBuilderInput {
  /** Universe metadata used to pick the limit threshold per board. */
  metas: StockMeta[];
  /** Per-symbol chronological bars. */
  barsBySymbol: Record<string, StockDailyBar[]>;
  config?: Partial<SentimentBuilderConfig>;
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function classify(
  limitUpCount: number,
  limitDownCount: number,
  medianReturn: number,
  cfg: SentimentBuilderConfig,
): MarketRegime {
  if (
    medianReturn <= cfg.regimeThresholds.panicMedianReturnPct &&
    limitDownCount >= cfg.regimeThresholds.panicLimitDownCount
  ) {
    return "PANIC";
  }
  if (limitUpCount >= cfg.regimeThresholds.strongLimitUpCount) return "STRONG";
  if (limitUpCount <= cfg.regimeThresholds.weakLimitUpCount) return "WEAK";
  return "NEUTRAL";
}

function isLimitUpClose(bar: StockDailyBar, prev: StockDailyBar, thr: number, ratio: number): boolean {
  if (prev.close <= 0) return false;
  const change = (bar.close - prev.close) / prev.close;
  return change >= thr * ratio;
}

function isLimitDownClose(bar: StockDailyBar, prev: StockDailyBar, thr: number, ratio: number): boolean {
  if (prev.close <= 0) return false;
  const change = (prev.close - bar.close) / prev.close;
  return change >= thr * ratio;
}

function isFailedLimitUp(bar: StockDailyBar, prev: StockDailyBar, thr: number, tolerance: number): boolean {
  if (prev.close <= 0) return false;
  const limitPrice = prev.close * (1 + thr);
  const reached = bar.high >= limitPrice * tolerance;
  const closedBelow = bar.close < limitPrice * tolerance;
  return reached && closedBelow;
}

function collectAlignedDates(barsBySymbol: Record<string, StockDailyBar[]>): string[] {
  const all = new Set<string>();
  for (const sym of Object.keys(barsBySymbol)) {
    for (const b of barsBySymbol[sym]) all.add(b.date);
  }
  return Array.from(all).sort();
}

/**
 * Build a chronological list of MarketSentimentSnapshot, one per trading day
 * that the union of bars covers. Each snapshot is derived purely from the
 * data on that day (and the prior bar for limit-up checks).
 */
export function buildMarketSentiment(
  input: SentimentBuilderInput,
): MarketSentimentSnapshot[] {
  const cfg: SentimentBuilderConfig = {
    ...DEFAULT_SENTIMENT_CONFIG,
    ...(input.config ?? {}),
    regimeThresholds: {
      ...DEFAULT_SENTIMENT_CONFIG.regimeThresholds,
      ...(input.config?.regimeThresholds ?? {}),
    },
  };

  const boardBySymbol = new Map<string, BoardType>();
  for (const m of input.metas) boardBySymbol.set(m.symbol, m.boardType);

  const dates = collectAlignedDates(input.barsBySymbol);
  if (dates.length === 0) return [];

  // For each date, walk every symbol's bars and tally counts.
  const dateIndexBySymbol = new Map<string, Map<string, number>>();
  for (const sym of Object.keys(input.barsBySymbol)) {
    const idx = new Map<string, number>();
    const bars = input.barsBySymbol[sym];
    for (let i = 0; i < bars.length; i++) idx.set(bars[i].date, i);
    dateIndexBySymbol.set(sym, idx);
  }

  // Track consecutive limit-up streaks per symbol for maxConsecutiveLimitUp.
  const streakBySymbol = new Map<string, number>();

  const out: MarketSentimentSnapshot[] = [];
  let yesterdayLimitUpCohort: { symbol: string; date: string }[] = [];

  for (const date of dates) {
    let limitUpCount = 0;
    let limitDownCount = 0;
    let failedLimitUpAttempts = 0;
    let limitUpAttempts = 0;
    let maxConsecutive = 0;
    const dailyReturns: number[] = [];

    for (const sym of Object.keys(input.barsBySymbol)) {
      const bars = input.barsBySymbol[sym];
      const idx = dateIndexBySymbol.get(sym)?.get(date);
      if (idx === undefined || idx === 0) continue;
      const bar = bars[idx];
      const prev = bars[idx - 1];
      const board = boardBySymbol.get(sym) ?? "MAIN";
      const thr = LIMIT_UP_THRESHOLDS[board];

      const change = (bar.close - prev.close) / prev.close;
      if (Number.isFinite(change)) dailyReturns.push(change * 100);

      const isLU = isLimitUpClose(bar, prev, thr, cfg.limitUpCloseRatio);
      const isLD = isLimitDownClose(bar, prev, thr, cfg.limitUpCloseRatio);
      const reachedLimit =
        bar.high >= prev.close * (1 + thr) * cfg.failedHighTolerance;
      if (reachedLimit) {
        limitUpAttempts += 1;
        if (!isLU && isFailedLimitUp(bar, prev, thr, cfg.failedHighTolerance)) {
          failedLimitUpAttempts += 1;
        }
      }
      if (isLU) {
        limitUpCount += 1;
        const streak = (streakBySymbol.get(sym) ?? 0) + 1;
        streakBySymbol.set(sym, streak);
        if (streak > maxConsecutive) maxConsecutive = streak;
      } else {
        streakBySymbol.set(sym, 0);
      }
      if (isLD) limitDownCount += 1;
    }

    const failedRate = limitUpAttempts > 0 ? failedLimitUpAttempts / limitUpAttempts : 0;
    const medReturn = median(dailyReturns);

    // yesterdayLimitUpPerformance — average next-day return of yesterday's
    // limit-up cohort. (Today is the "next day" for yesterday's cohort.)
    let yPerf = NaN;
    if (yesterdayLimitUpCohort.length > 0) {
      const perfs: number[] = [];
      for (const e of yesterdayLimitUpCohort) {
        const idx = dateIndexBySymbol.get(e.symbol)?.get(date);
        const bars = input.barsBySymbol[e.symbol];
        if (idx === undefined || idx === 0 || !bars) continue;
        const today = bars[idx];
        const ystdy = bars[idx - 1];
        if (ystdy.close > 0) perfs.push(((today.close - ystdy.close) / ystdy.close) * 100);
      }
      if (perfs.length > 0) yPerf = perfs.reduce((s, v) => s + v, 0) / perfs.length;
    }

    // Refresh yesterday cohort: today's limit-ups become tomorrow's "yesterday".
    const cohortNext: { symbol: string; date: string }[] = [];
    for (const sym of Object.keys(input.barsBySymbol)) {
      const idx = dateIndexBySymbol.get(sym)?.get(date);
      if (idx === undefined || idx === 0) continue;
      const bar = input.barsBySymbol[sym][idx];
      const prev = input.barsBySymbol[sym][idx - 1];
      const board = boardBySymbol.get(sym) ?? "MAIN";
      const thr = LIMIT_UP_THRESHOLDS[board];
      if (isLimitUpClose(bar, prev, thr, cfg.limitUpCloseRatio)) {
        cohortNext.push({ symbol: sym, date });
      }
    }
    yesterdayLimitUpCohort = cohortNext;

    const indexTrend: MarketSentimentSnapshot["indexTrend"] =
      medReturn > 0.3 ? "UP" : medReturn < -0.3 ? "DOWN" : "SIDEWAYS";

    out.push({
      date,
      indexTrend,
      limitUpCount,
      limitDownCount,
      failedLimitUpRate: +failedRate.toFixed(3),
      maxConsecutiveLimitUp: maxConsecutive,
      yesterdayLimitUpPerformance: Number.isNaN(yPerf) ? 0 : +yPerf.toFixed(2),
      marketRegime: classify(limitUpCount, limitDownCount, medReturn, cfg),
    });
  }

  return out;
}
