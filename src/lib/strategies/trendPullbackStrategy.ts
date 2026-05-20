import { calculateMA } from "@/lib/indicators/movingAverage";
import { PULLBACK_TOLERANCES } from "@/lib/config/constants";
import type { Strategy, StrategyCandidate, StrategyContext } from "./types";

const STRATEGY_ID = "trendPullback";
const STRATEGY_NAME = "趋势回踩 / Trend Pullback";

/**
 * Healthy uptrend pulls back to MA10/MA20 and bounces:
 *   - MA5 > MA10 > MA20 (bullish stack) OR close above MA10 and MA20
 *   - In last few bars: price touched MA10 or MA20 (pullback)
 *   - Volume contracts during pullback then expands on rebound
 *   - Today is a rebound bar (positive pctChange)
 */
export const trendPullbackStrategy: Strategy = (
  ctx: StrategyContext,
): StrategyCandidate | null => {
  const { bars } = ctx;
  if (bars.length < 30) return null;

  const closes = bars.map((b) => b.close);
  const ma5 = calculateMA(closes, 5);
  const ma10 = calculateMA(closes, 10);
  const ma20 = calculateMA(closes, 20);
  const i = bars.length - 1;
  const last = bars[i];

  const stack = ma5[i] > ma10[i] && ma10[i] > ma20[i];
  const aboveBoth = last.close >= ma10[i] && last.close >= ma20[i];
  if (!stack && !aboveBoth) return null;

  // Look back 1-5 bars to find a pullback touch of MA10 or MA20.
  const tol = 1 + PULLBACK_TOLERANCES.maTouchPct / 100;
  let pullbackIdx = -1;
  for (let k = i - 5; k < i; k++) {
    if (k < 0) continue;
    const b = bars[k];
    const touchedMA10 = !isNaN(ma10[k]) && b.low <= ma10[k] * tol;
    const touchedMA20 = !isNaN(ma20[k]) && b.low <= ma20[k] * tol;
    if (touchedMA10 || touchedMA20) {
      pullbackIdx = k;
      break;
    }
  }
  if (pullbackIdx === -1) return null;

  // Volume: pullback bars on average lower than prior 10 days, today expands.
  const pullbackVols = bars.slice(pullbackIdx, i).map((b) => b.volume);
  const refVols = bars.slice(Math.max(0, pullbackIdx - 10), pullbackIdx).map(
    (b) => b.volume,
  );
  const avg = (xs: number[]) =>
    xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
  const pullbackAvg = avg(pullbackVols);
  const refAvg = avg(refVols);
  const volumeContracted = pullbackAvg < refAvg * 0.95;
  const todayExpand = last.volume > pullbackAvg * 1.1;
  const rebound = last.pctChange > 0;
  if (!(rebound && (volumeContracted || todayExpand))) return null;

  let tech = 55;
  if (stack) tech += 10;
  if (volumeContracted) tech += 5;
  if (todayExpand) tech += 8;
  if (last.pctChange >= 2) tech += 5;
  tech = Math.min(90, tech);

  const support = +Math.min(ma10[i], ma20[i]).toFixed(2);
  const resistance = +Math.max(...bars.slice(-20).map((b) => b.high)).toFixed(2);

  return {
    strategyId: STRATEGY_ID,
    strategyName: STRATEGY_NAME,
    signalType: "PULLBACK",
    technicalScore: tech,
    keySupport: support,
    keyResistance: resistance,
    stopLoss: +(support * 0.97).toFixed(2),
    target1: resistance,
    target2: +(resistance * 1.08).toFixed(2),
    explanation: [
      stack ? "MA5 > MA10 > MA20 多头排列" : "收盘价站稳 MA10 与 MA20",
      `回踩 ${bars[pullbackIdx].date} 于 MA10/MA20 附近未破`,
      todayExpand ? "今日成交放量反弹" : "缩量回踩",
    ],
    bullishFactors: [
      stack ? "Bullish MA stack" : "Above MA10 and MA20",
      volumeContracted ? "Volume contracted during pullback" : "",
      todayExpand ? "Volume expanded on rebound" : "",
    ].filter(Boolean),
    bearishFactors: [],
  };
};
