import {
  FIRST_BREAKOUT_MAX_60D_RISE_PCT,
  STRATEGY_LOOKBACKS,
} from "@/lib/config/constants";
import type { Strategy, StrategyCandidate, StrategyContext } from "./types";

const STRATEGY_ID = "firstBreakout";
const STRATEGY_NAME = "低位首爆 / First Breakout";

/**
 * Low-base first breakout:
 *  - 60-day price rise should not be excessive (avoid chasing late tops)
 *  - close breaks above the recent 40-day high or a flat-platform high
 *  - amount and turnover expand vs recent baseline
 *  - sector strength neutral or positive
 */
export const firstBreakoutStrategy: Strategy = (
  ctx: StrategyContext,
): StrategyCandidate | null => {
  const { bars, sector } = ctx;
  if (bars.length < STRATEGY_LOOKBACKS.trend + 1) return null;

  const last = bars[bars.length - 1];
  const window60 = bars.slice(-60);
  const startPrice = window60[0].close;
  const sixtyDayChange = (last.close - startPrice) / startPrice;
  if (sixtyDayChange * 100 > FIRST_BREAKOUT_MAX_60D_RISE_PCT) return null;

  const highWindow = bars.slice(-STRATEGY_LOOKBACKS.breakoutHigh - 1, -1);
  const platformHigh = Math.max(...highWindow.map((b) => b.high));
  if (last.close <= platformHigh) return null;

  // Amount + turnover expansion vs prior 10-day average.
  const ref = bars.slice(-11, -1);
  const avgAmount = ref.reduce((s, b) => s + b.amount, 0) / ref.length;
  const avgTurnover = ref.reduce((s, b) => s + b.turnoverRate, 0) / ref.length;
  const amountExpand = last.amount > avgAmount * 1.5;
  const turnoverExpand = last.turnoverRate > avgTurnover * 1.5;
  if (!(amountExpand && turnoverExpand)) return null;

  // Sector strength must not be outright negative.
  const sectorOk =
    !sector || sector.momentumScore >= 50 || sector.strengthRank <= 8;
  if (!sectorOk) return null;

  const sectorConfirmed = !!sector && (sector.strengthRank <= 5 || sector.momentumScore >= 65);

  let tech = 60;
  if (last.pctChange >= 5) tech += 8;
  if (amountExpand && turnoverExpand) tech += 6;
  if (sectorConfirmed) tech += 6;
  tech = Math.min(90, tech);

  const support = +platformHigh.toFixed(2);
  const target1 = +(platformHigh * 1.08).toFixed(2);
  const target2 = +(platformHigh * 1.18).toFixed(2);

  return {
    strategyId: STRATEGY_ID,
    strategyName: STRATEGY_NAME,
    signalType: sectorConfirmed ? "BREAKOUT" : "WATCH_ONLY",
    technicalScore: tech,
    keySupport: support,
    keyResistance: target1,
    stopLoss: +(platformHigh * 0.96).toFixed(2),
    target1,
    target2,
    explanation: [
      `60 日累计涨幅 ${(sixtyDayChange * 100).toFixed(2)}%，位置不算过高`,
      `突破 40 日平台高点 ${platformHigh.toFixed(2)}`,
      `成交放大 ${(last.amount / avgAmount).toFixed(2)}x，换手放大 ${(
        last.turnoverRate / avgTurnover
      ).toFixed(2)}x`,
      sectorConfirmed ? "板块同步走强" : "板块强度一般，待观察",
    ],
    bullishFactors: [
      "First breakout from low base",
      "Amount and turnover expansion",
      sectorConfirmed ? "Sector confirms breakout" : "",
    ].filter(Boolean),
    bearishFactors: sectorConfirmed
      ? []
      : ["Sector confirmation weak — single-stock setup"],
  };
};
