import type { StockDailyBar } from "@/lib/types/stock";

/**
 * Find the bar with the highest turnover rate inside the lookback window
 * (counting the most recent `lookback` bars). 最大换手位 — represents the
 * day with the largest capital battle, often a key support/resistance area.
 */
export function findMaxTurnoverBar(
  bars: StockDailyBar[],
  lookback: number,
): StockDailyBar | null {
  if (bars.length === 0 || lookback <= 0) return null;
  const start = Math.max(0, bars.length - lookback);
  let best: StockDailyBar | null = null;
  for (let i = start; i < bars.length; i++) {
    if (!best || bars[i].turnoverRate > best.turnoverRate) best = bars[i];
  }
  return best;
}

/**
 * Decompose a bar into the four "battle levels" used in A-share short-term
 * analysis: full range (high/low) and candle body (max/min of open/close).
 */
export function calculateTurnoverLevels(bar: StockDailyBar): {
  high: number;
  low: number;
  bodyHigh: number;
  bodyLow: number;
} {
  return {
    high: bar.high,
    low: bar.low,
    bodyHigh: Math.max(bar.open, bar.close),
    bodyLow: Math.min(bar.open, bar.close),
  };
}
