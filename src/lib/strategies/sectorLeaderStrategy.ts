import { calculateMA } from "@/lib/indicators/movingAverage";
import type { Strategy, StrategyCandidate, StrategyContext } from "./types";

const STRATEGY_ID = "sectorLeader";
const STRATEGY_NAME = "板块龙头 / Sector Leader";

/**
 * Score sector strength using sector pctChange, limit-up count, strength rank,
 * and momentum score. Stocks listed in the sector's top stocks get a further
 * boost. Technical confirmation determines BREAKOUT vs WATCH_ONLY.
 */
export const sectorLeaderStrategy: Strategy = (
  ctx: StrategyContext,
): StrategyCandidate | null => {
  const { sector, bars, meta } = ctx;
  if (!sector || bars.length < 20) return null;

  // Sector strength must be at least decent to qualify.
  if (sector.strengthRank > 5 && sector.momentumScore < 60) return null;
  if (sector.pctChange < 0 && sector.limitUpCount === 0) return null;

  const last = bars[bars.length - 1];
  const closes = bars.map((b) => b.close);
  const ma10 = calculateMA(closes, 10);
  const ma20 = calculateMA(closes, 20);
  const lastIdx = bars.length - 1;

  const aboveMA10 = !isNaN(ma10[lastIdx]) && last.close >= ma10[lastIdx];
  const aboveMA20 = !isNaN(ma20[lastIdx]) && last.close >= ma20[lastIdx];

  // Confirmation: today closed strong + above MA10.
  const breakoutConfirmed = aboveMA10 && last.pctChange >= 2;
  const isTopStock = sector.topStocks.includes(meta.symbol);

  let tech = 50;
  tech += Math.max(0, 12 - sector.strengthRank * 2); // top sector bonus
  if (sector.momentumScore >= 70) tech += 8;
  if (isTopStock) tech += 12;
  if (aboveMA10) tech += 5;
  if (aboveMA20) tech += 4;
  if (last.pctChange >= 3) tech += 5;
  tech = Math.min(92, tech);

  const recentHigh = Math.max(...bars.slice(-20).map((b) => b.high));
  const recentLow = Math.min(...bars.slice(-10).map((b) => b.low));

  return {
    strategyId: STRATEGY_ID,
    strategyName: STRATEGY_NAME,
    signalType: breakoutConfirmed ? "BREAKOUT" : "WATCH_ONLY",
    technicalScore: tech,
    keySupport: +recentLow.toFixed(2),
    keyResistance: +recentHigh.toFixed(2),
    stopLoss: +(recentLow * 0.97).toFixed(2),
    target1: +(recentHigh * 1.0).toFixed(2),
    target2: +(recentHigh * 1.1).toFixed(2),
    explanation: [
      `板块: ${sector.sectorName} 当日涨幅 ${sector.pctChange.toFixed(2)}%，涨停 ${sector.limitUpCount} 家`,
      `板块强度排名 #${sector.strengthRank}，动量分 ${sector.momentumScore}`,
      isTopStock ? "属于板块强势龙头股池 (sector leader)" : "板块跟随股，非首选龙头",
      breakoutConfirmed
        ? "技术形态确认突破 (above MA10 with strong close)"
        : "技术尚未确认突破，仅观察",
    ],
    bullishFactors: [
      `Sector rank #${sector.strengthRank}`,
      `Sector momentum ${sector.momentumScore}`,
      isTopStock ? "Listed as sector top stock" : "",
    ].filter(Boolean),
    bearishFactors: breakoutConfirmed
      ? []
      : ["Technical breakout not yet confirmed"],
  };
};
