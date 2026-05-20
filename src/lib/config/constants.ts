// Centralized thresholds and constants — avoid magic numbers in strategy/scoring code.
// A-share specific: 10cm = 10% daily limit (main board, post-2020); 20cm = 20% (ChiNext + STAR).

import type { BoardType } from "@/lib/types/stock";

export const LIMIT_UP_THRESHOLDS: Record<BoardType, number> = {
  MAIN: 0.0995, // use 9.95% to tolerate rounding noise in mock/real data
  CHINEXT: 0.1995,
  STAR: 0.1995,
};

/** Considered "near limit-up" — useful for failed-limit / sticky setups. */
export const NEAR_LIMIT_UP_RATIO = 0.85;

/** Lookback windows used by the strategies. */
export const STRATEGY_LOOKBACKS = {
  /** Second-buy looks for a prior limit-up within this many days. */
  limitUpSecondBuyMin: 5,
  limitUpSecondBuyMax: 60,
  /** Max-turnover lookback. */
  maxTurnover: 120,
  /** Breakout reference window. */
  breakoutHigh: 40,
  /** Overextension check window. */
  overextended: 20,
  /** Trend / MA reference window. */
  trend: 60,
};

/**
 * Tolerances for "near" checks. Split per check so each strategy can be tuned
 * without coupling to unrelated ones (see AUDIT.md J-1).
 *
 * - LIMIT_BODY: how far the low may dip below limit-up body low and still
 *   count as "support held". Tight (1.0%) because the body low is a sharp
 *   battle level.
 * - MA_TOUCH: how close the low must come to MA10/MA20 to count as a pullback
 *   touch. Loose (1.5%) because MA values are themselves smoothed.
 * - MAX_TURN_DEFENCE: same idea, applied to max-turnover body-low defence.
 */
export const PULLBACK_TOLERANCES = {
  limitBodyPct: 1.0,
  maTouchPct: 1.5,
  maxTurnDefencePct: 1.5,
} as const;

/** @deprecated use PULLBACK_TOLERANCES; kept for older imports only. */
export const PULLBACK_TOLERANCE_PCT = PULLBACK_TOLERANCES.limitBodyPct;

/** First-breakout 60-day rise cap. Moved out of strategy as named config. */
export const FIRST_BREAKOUT_MAX_60D_RISE_PCT = 60;

/** Score weights — must sum to 1 (enforced at module load). */
export const SCORE_WEIGHTS = {
  technical: 0.3,
  sector: 0.25,
  sentiment: 0.2,
  liquidity: 0.15,
  fundamentalSafety: 0.1,
} as const;

// AUDIT D-2: fail fast if weights are ever edited to a non-unit sum.
{
  const sum = Object.values(SCORE_WEIGHTS).reduce((s, v) => s + v, 0);
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(`SCORE_WEIGHTS must sum to 1, got ${sum}`);
  }
}

/** Action thresholds applied to the final post-penalty score (0-100). */
export const ACTION_THRESHOLDS = {
  standard: 75,
  light: 60,
  watch: 45,
} as const;

/** Risk penalty contributions. */
export const RISK_PENALTIES = {
  regulatoryWarning: 25,
  recentReduction: 12,
  recentUnlock: 10,
  overextended: 18,
  failedLimitUpToday: 20,
  highVolumeStagnation: 15,
  weakMarket: 8,
  panicMarket: 15,
  sectorWeakening: 10,
  lowLiquidity: 12,
  abnormalTurnover: 10,
} as const;
