import type { BoardType, StockDailyBar } from "@/lib/types/stock";
import { LIMIT_UP_THRESHOLDS, NEAR_LIMIT_UP_RATIO } from "@/lib/config/constants";

/** Returns the daily limit-up percentage threshold (e.g. 0.0995 for main board). */
export function getLimitUpThreshold(boardType: BoardType): number {
  return LIMIT_UP_THRESHOLDS[boardType];
}

const HIGH_CLOSE_EPSILON = 0.002; // 0.2% tolerance for close vs high comparison

/**
 * True if `bar` closed at the limit-up price relative to the previous close.
 *
 * AUDIT B-3: a +9.95% bar that did not actually seal at the limit price would
 * otherwise be flagged 涨停. To reduce false positives we require both:
 *  - pct change ≥ threshold, AND
 *  - close within HIGH_CLOSE_EPSILON of intraday high (a sealed limit board
 *    has close == high).
 *
 * Real data providers usually supply a `limitState` flag that should be
 * preferred over this synthetic check when available.
 */
export function isLimitUpBar(
  bar: StockDailyBar,
  previousBar: StockDailyBar,
  boardType: BoardType,
): boolean {
  if (!previousBar) return false;
  const thr = getLimitUpThreshold(boardType);
  const change = (bar.close - previousBar.close) / previousBar.close;
  if (change < thr) return false;
  // Require close ≈ high (sealed limit-up has close == high == limit price).
  if (bar.high <= 0) return false;
  return bar.high - bar.close <= bar.high * HIGH_CLOSE_EPSILON;
}

/**
 * True if the bar got near limit-up (intraday touched ≥ NEAR ratio of limit
 * or closed ≥ NEAR ratio of limit). Looser than isLimitUpBar.
 */
export function isNearLimitUpBar(
  bar: StockDailyBar,
  previousBar: StockDailyBar,
  boardType: BoardType,
): boolean {
  if (!previousBar) return false;
  const thr = getLimitUpThreshold(boardType);
  const highChange = (bar.high - previousBar.close) / previousBar.close;
  const closeChange = (bar.close - previousBar.close) / previousBar.close;
  return (
    highChange >= thr * NEAR_LIMIT_UP_RATIO ||
    closeChange >= thr * NEAR_LIMIT_UP_RATIO
  );
}

/**
 * True 炸板 detection: intraday high reached the limit price but close fell
 * below it. Requires the high to be within HIGH_CLOSE_EPSILON of the limit
 * level AND close below limit by a non-trivial margin.
 *
 * Use this — not `isNearLimitUpBar && !isLimitUpBar` — to flag failed limits.
 * (AUDIT E-1)
 */
export function wasFailedLimitUpBar(
  bar: StockDailyBar,
  previousBar: StockDailyBar,
  boardType: BoardType,
): boolean {
  if (!previousBar) return false;
  const thr = getLimitUpThreshold(boardType);
  const limitPrice = previousBar.close * (1 + thr);
  const reachedLimit = bar.high >= limitPrice * (1 - HIGH_CLOSE_EPSILON);
  const closedBelowLimit = bar.close < limitPrice * (1 - HIGH_CLOSE_EPSILON);
  return reachedLimit && closedBelowLimit;
}
