// firstBreakoutRelaxedStrategy — research-only relaxed variant of firstBreakout.
//
// Created for T-006 (v1.9 follow-up). The v1.9 horizon report showed that
// `firstBreakout` rejects 96.3% of candidates at the platform-breakout gate,
// producing only 33 historical signals across the BaoStock cache. This file
// duplicates the strict logic with two narrow relaxations:
//
//   1. Platform lookback shortened from 40 trading days → 30.
//   2. "Near breakout" accepted: `close >= platformHigh * 0.99`
//      (strict requires `close > platformHigh`).
//
// Everything else — 60-day rise cap, amount+turnover expansion, sector
// strength, technicalScore composition — matches `firstBreakoutStrategy`
// exactly. This is deliberate: only the gate the v1.9 review named as the
// weakest link is touched. The strict strategy is unchanged and remains the
// production default per D-006.

import { FIRST_BREAKOUT_MAX_60D_RISE_PCT } from "@/lib/config/constants";
import type { Strategy, StrategyCandidate, StrategyContext } from "./types";

const STRATEGY_ID = "firstBreakoutRelaxed";
const STRATEGY_NAME = "低位首爆放宽版 / First Breakout Relaxed";

/** Lookback used by the relaxed variant. Production strict uses 40d via STRATEGY_LOOKBACKS.breakoutHigh. */
export const FIRST_BREAKOUT_RELAXED_LOOKBACK = 30;
/** "Near breakout" ratio: close must be at least platformHigh × this value. */
export const FIRST_BREAKOUT_RELAXED_NEAR_RATIO = 0.99;

export const firstBreakoutRelaxedStrategy: Strategy = (
  ctx: StrategyContext,
): StrategyCandidate | null => {
  const { bars, sector } = ctx;
  // Need enough history for the 60-day rise gate even though our platform
  // lookback is shorter. Keep the same warm-up requirement as strict so a
  // signal cannot fire on too-thin history.
  if (bars.length < 61) return null;

  const last = bars[bars.length - 1];
  const window60 = bars.slice(-60);
  const startPrice = window60[0].close;
  const sixtyDayChange = (last.close - startPrice) / startPrice;
  if (sixtyDayChange * 100 > FIRST_BREAKOUT_MAX_60D_RISE_PCT) return null;

  // Relaxation #1: lookback 30 instead of 40.
  // Relaxation #2: accept close >= platformHigh * 0.99 (near-breakout).
  const highWindow = bars.slice(
    -FIRST_BREAKOUT_RELAXED_LOOKBACK - 1,
    -1,
  );
  if (highWindow.length === 0) return null;
  const platformHigh = Math.max(...highWindow.map((b) => b.high));
  const nearBreakoutThreshold = platformHigh * FIRST_BREAKOUT_RELAXED_NEAR_RATIO;
  if (last.close < nearBreakoutThreshold) return null;

  // Amount + turnover expansion vs prior 10-day average (unchanged from strict).
  const ref = bars.slice(-11, -1);
  const avgAmount = ref.reduce((s, b) => s + b.amount, 0) / ref.length;
  const avgTurnover = ref.reduce((s, b) => s + b.turnoverRate, 0) / ref.length;
  const amountExpand = last.amount > avgAmount * 1.5;
  const turnoverExpand = last.turnoverRate > avgTurnover * 1.5;
  if (!(amountExpand && turnoverExpand)) return null;

  // Sector strength (unchanged from strict).
  const sectorOk =
    !sector || sector.momentumScore >= 50 || sector.strengthRank <= 8;
  if (!sectorOk) return null;

  const sectorConfirmed =
    !!sector && (sector.strengthRank <= 5 || sector.momentumScore >= 65);
  // Distinguish a strict breakout (close > platformHigh) from a near breakout
  // for the human reading the explanation; both qualify as a signal here.
  const breakoutAboveHigh = last.close > platformHigh;

  let tech = 60;
  if (last.pctChange >= 5) tech += 8;
  if (amountExpand && turnoverExpand) tech += 6;
  if (sectorConfirmed) tech += 6;
  // Slight haircut for "near-but-not-above" so the relaxed signal is not
  // scored as confidently as the strict one. Never moves the strategy above
  // the strict cap of 90.
  if (!breakoutAboveHigh) tech -= 4;
  tech = Math.min(90, Math.max(0, tech));

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
      breakoutAboveHigh
        ? `突破 ${FIRST_BREAKOUT_RELAXED_LOOKBACK} 日平台高点 ${platformHigh.toFixed(2)}`
        : `接近 ${FIRST_BREAKOUT_RELAXED_LOOKBACK} 日平台高点 ${platformHigh.toFixed(2)} (close = ${(last.close).toFixed(2)}, 阈值 ${(nearBreakoutThreshold).toFixed(2)})`,
      `成交放大 ${(last.amount / avgAmount).toFixed(2)}x，换手放大 ${(
        last.turnoverRate / avgTurnover
      ).toFixed(2)}x`,
      sectorConfirmed ? "板块同步走强" : "板块强度一般，待观察",
      "实验性放宽版本：仅供研究使用，不进入默认 /signals 列表",
    ],
    bullishFactors: [
      breakoutAboveHigh
        ? "Breakout from low base (relaxed lookback)"
        : "Near-breakout from low base (within 1% of 30d platform high)",
      "Amount and turnover expansion",
      sectorConfirmed ? "Sector confirms breakout" : "",
    ].filter(Boolean),
    bearishFactors: [
      sectorConfirmed ? "" : "Sector confirmation weak — single-stock setup",
      breakoutAboveHigh ? "" : "Did not actually clear the platform high",
    ].filter(Boolean),
  };
};
