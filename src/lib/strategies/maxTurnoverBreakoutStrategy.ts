import { calculateTurnoverLevels, findMaxTurnoverBar } from "@/lib/indicators/turnover";
import { STRATEGY_LOOKBACKS } from "@/lib/config/constants";
import type { Strategy, StrategyCandidate, StrategyContext } from "./types";

const STRATEGY_ID = "maxTurnoverBreakout";
const STRATEGY_NAME = "最大换手位突破 / Max Turnover Breakout";

/**
 * Max-turnover-day represents the largest capital battle zone in a lookback
 * window. Body-high reclaim with expanding amount = BREAKOUT; pullback to
 * body-low without breaking it = WATCH_ONLY (the level is being defended).
 */
export const maxTurnoverBreakoutStrategy: Strategy = (
  ctx: StrategyContext,
): StrategyCandidate | null => {
  const { bars } = ctx;
  if (bars.length < 20) return null;

  const last = bars[bars.length - 1];
  const historical = bars.slice(0, -1); // exclude today when locating the level
  const maxTurn = findMaxTurnoverBar(historical, STRATEGY_LOOKBACKS.maxTurnover);
  if (!maxTurn) return null;
  if (maxTurn.date === last.date) return null;

  const levels = calculateTurnoverLevels(maxTurn);

  // Reference amount = 10-day average amount.
  const recent = bars.slice(-11, -1);
  const avgAmount =
    recent.reduce((s, b) => s + b.amount, 0) / Math.max(1, recent.length);
  const amountExpansion = last.amount / avgAmount;

  const breakout =
    last.close > levels.bodyHigh && amountExpansion >= 1.2;

  const watchOnly =
    !breakout &&
    last.low >= levels.bodyLow * 0.985 &&
    last.close >= levels.bodyLow &&
    last.close <= levels.bodyHigh;

  if (!breakout && !watchOnly) return null;

  const signalType = breakout ? "BREAKOUT" : "WATCH_ONLY";
  let tech = breakout ? 70 : 50;
  if (breakout && amountExpansion >= 1.6) tech += 10;
  if (breakout && last.pctChange >= 3) tech += 5;
  tech = Math.min(92, tech);

  const explanation: string[] = [
    `最大换手位: ${maxTurn.date} 换手率 ${maxTurn.turnoverRate.toFixed(2)}%，body ${levels.bodyLow.toFixed(2)}-${levels.bodyHigh.toFixed(2)}`,
    breakout
      ? `今日收盘 ${last.close.toFixed(2)} 突破实体高点，量能放大 ${amountExpansion.toFixed(2)}x`
      : `今日回踩至实体下沿 ${levels.bodyLow.toFixed(2)} 附近未破，关键位有效`,
  ];

  const bullishFactors = breakout
    ? [
        "Closed above max-turnover body high",
        `Amount expansion ${amountExpansion.toFixed(2)}x vs 10-day average`,
      ]
    : ["Held above max-turnover body low — capital still defending the level"];
  const bearishFactors = breakout
    ? []
    : ["Breakout not yet confirmed; watch only"];

  return {
    strategyId: STRATEGY_ID,
    strategyName: STRATEGY_NAME,
    signalType,
    technicalScore: tech,
    keySupport: +levels.bodyLow.toFixed(2),
    keyResistance: +levels.high.toFixed(2),
    stopLoss: +(levels.bodyLow * 0.96).toFixed(2),
    target1: +(levels.high * 1.0).toFixed(2),
    target2: +(levels.high * 1.1).toFixed(2),
    explanation,
    bullishFactors,
    bearishFactors,
  };
};
