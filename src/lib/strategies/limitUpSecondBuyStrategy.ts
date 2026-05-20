import { calculateMA } from "@/lib/indicators/movingAverage";
import { isLimitUpBar, isNearLimitUpBar } from "@/lib/indicators/limitUp";
import { calculateTurnoverLevels, findMaxTurnoverBar } from "@/lib/indicators/turnover";
import {
  PULLBACK_TOLERANCES,
  STRATEGY_LOOKBACKS,
} from "@/lib/config/constants";
import type { Strategy, StrategyCandidate, StrategyContext } from "./types";

const STRATEGY_ID = "limitUpSecondBuy";
const STRATEGY_NAME = "涨停后二买 / Limit-up Second Buy";

/**
 * 二买 / 类二买 (second-buy or second-buy-like) after a strong limit-up:
 *  - find a limit-up (or near-limit-up) bar within [min, max] trading days ago
 *  - require pullback that did not break the limit-up body low (key support)
 *  - require reclaim of one of: MA10, MA20, limit-up body high, or max-turnover body high
 */
export const limitUpSecondBuyStrategy: Strategy = (
  ctx: StrategyContext,
): StrategyCandidate | null => {
  const { bars, meta } = ctx;
  if (bars.length < 30) return null;

  const last = bars[bars.length - 1];
  const closes = bars.map((b) => b.close);
  const ma10 = calculateMA(closes, 10);
  const ma20 = calculateMA(closes, 20);
  const lastIdx = bars.length - 1;

  const { limitUpSecondBuyMin: minBack, limitUpSecondBuyMax: maxBack } =
    STRATEGY_LOOKBACKS;

  // Locate the most recent limit-up or near-limit-up event in the window.
  let limitUpIdx = -1;
  let limitUpNear = false;
  const searchStart = Math.max(1, lastIdx - maxBack);
  const searchEnd = Math.max(1, lastIdx - minBack);
  for (let i = searchEnd; i >= searchStart; i--) {
    const prev = bars[i - 1];
    if (isLimitUpBar(bars[i], prev, meta.boardType)) {
      limitUpIdx = i;
      break;
    }
    if (limitUpIdx === -1 && isNearLimitUpBar(bars[i], prev, meta.boardType)) {
      limitUpIdx = i;
      limitUpNear = true;
    }
  }
  if (limitUpIdx === -1) return null;

  const limitBar = bars[limitUpIdx];
  const limitLevels = calculateTurnoverLevels(limitBar);
  const tol = 1 - PULLBACK_TOLERANCES.limitBodyPct / 100;

  // Pullback must not break limit-up body low (key support).
  let brokeKeySupport = false;
  for (let i = limitUpIdx + 1; i <= lastIdx; i++) {
    if (bars[i].low < limitLevels.bodyLow * tol) {
      brokeKeySupport = true;
      break;
    }
  }
  if (brokeKeySupport) return null;

  // Reclaim conditions.
  const ma10v = ma10[lastIdx];
  const ma20v = ma20[lastIdx];
  // AUDIT B-1: exclude today so reclaiming "today's own body" cannot trivially
  // satisfy the max-turnover reclaim condition.
  const maxTurn = findMaxTurnoverBar(
    bars.slice(0, lastIdx),
    STRATEGY_LOOKBACKS.maxTurnover,
  );
  const maxTurnLevels = maxTurn ? calculateTurnoverLevels(maxTurn) : null;

  const reclaimedMA10 = !isNaN(ma10v) && last.close >= ma10v;
  const reclaimedMA20 = !isNaN(ma20v) && last.close >= ma20v;
  const reclaimedLimitBody = last.close >= limitLevels.bodyHigh;
  const reclaimedMaxTurn = !!maxTurnLevels && last.close >= maxTurnLevels.bodyHigh;
  const anyReclaim =
    reclaimedMA10 || reclaimedMA20 || reclaimedLimitBody || reclaimedMaxTurn;
  if (!anyReclaim) return null;

  // Strength scoring: more reclaims + closer to MA pullback = higher confidence.
  let tech = 55;
  if (reclaimedMA10) tech += 8;
  if (reclaimedMA20) tech += 6;
  if (reclaimedLimitBody) tech += 12;
  if (reclaimedMaxTurn) tech += 8;
  if (!limitUpNear) tech += 5; // a real seal is stronger than a near-miss
  if (last.pctChange > 0) tech += 4;
  tech = Math.min(95, tech);

  const support = limitLevels.bodyLow;
  const resistance = Math.max(
    limitLevels.high,
    maxTurnLevels?.high ?? limitLevels.high,
  );
  const stopLoss = +(support * 0.97).toFixed(2);
  const target1 = +(resistance * 1.0).toFixed(2);
  const target2 = +(resistance * 1.08).toFixed(2);

  const explanation: string[] = [
    `${limitUpNear ? "近涨停" : "涨停"}日 (${limitBar.date}) 涨幅 ${limitBar.pctChange.toFixed(2)}%，换手率 ${limitBar.turnoverRate.toFixed(2)}%`,
    `回踩未跌破涨停实体下沿 (key support ${limitLevels.bodyLow.toFixed(2)})`,
    reclaimedMA10 ? "已收复 MA10" : "",
    reclaimedMA20 ? "已收复 MA20" : "",
    reclaimedLimitBody ? "已重新站上涨停实体高点 (bullish reclaim)" : "",
    reclaimedMaxTurn ? "已站上最大换手位实体高点" : "",
  ].filter(Boolean);

  const bullishFactors = [
    "Prior limit-up provides identifiable key levels",
    "Pullback respected support without breaking down",
    anyReclaim ? "Reclaimed a key technical level" : "",
  ].filter(Boolean);

  const bearishFactors: string[] = [];
  if (limitUpNear) bearishFactors.push("Initial signal was near-limit-up, not a clean seal");
  if (last.close < (maxTurnLevels?.bodyHigh ?? Infinity))
    bearishFactors.push("Still below max-turnover body high");

  return {
    strategyId: STRATEGY_ID,
    strategyName: STRATEGY_NAME,
    signalType: reclaimedLimitBody || reclaimedMaxTurn ? "SECOND_BUY" : "PULLBACK",
    technicalScore: tech,
    keySupport: +support.toFixed(2),
    keyResistance: +resistance.toFixed(2),
    stopLoss,
    target1,
    target2,
    explanation,
    bullishFactors,
    bearishFactors,
  };
};
