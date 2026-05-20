import { RISK_PENALTIES, STRATEGY_LOOKBACKS } from "@/lib/config/constants";
import { wasFailedLimitUpBar } from "@/lib/indicators/limitUp";
import type { MarketSentimentSnapshot, SectorSnapshot } from "@/lib/types/market";
import type { StockDailyBar, StockMeta } from "@/lib/types/stock";
import type { RiskLevel } from "@/lib/types/signal";

export interface RiskInput {
  meta: StockMeta;
  bars: StockDailyBar[];
  sector?: SectorSnapshot;
  sentiment?: MarketSentimentSnapshot;
}

export interface RiskOutput {
  riskLevel: RiskLevel;
  riskPenalty: number;
  /** Human-readable reasons (en + zh). */
  reasons: string[];
  /** True if the stock must be excluded outright. */
  excluded: boolean;
}

/**
 * Evaluate risk for a stock at the most recent bar.
 * FORBIDDEN cases (ST, delisting risk) short-circuit and exclude the stock.
 */
export function evaluateRisk(input: RiskInput): RiskOutput {
  const { meta, bars, sector, sentiment } = input;
  const reasons: string[] = [];
  let penalty = 0;
  let level: RiskLevel = "LOW";

  // Hard exclusions
  if (meta.isST) {
    return {
      riskLevel: "FORBIDDEN",
      riskPenalty: 100,
      reasons: ["ST 股，禁止交易 (ST stock — forbidden)"],
      excluded: true,
    };
  }
  if (meta.hasDelistingRisk) {
    return {
      riskLevel: "FORBIDDEN",
      riskPenalty: 100,
      reasons: ["退市风险股 (delisting risk)"],
      excluded: true,
    };
  }

  if (meta.hasRegulatoryWarning) {
    penalty += RISK_PENALTIES.regulatoryWarning;
    reasons.push("近期监管警示函 (recent regulatory warning)");
  }
  if (meta.hasRecentReduction) {
    penalty += RISK_PENALTIES.recentReduction;
    reasons.push("大股东近期减持 (recent shareholder reduction)");
  }
  if (meta.hasRecentUnlock) {
    penalty += RISK_PENALTIES.recentUnlock;
    reasons.push("近期解禁压力 (recent unlock pressure)");
  }

  if (bars.length >= 2) {
    const last = bars[bars.length - 1];
    const refIdx = Math.max(0, bars.length - 1 - STRATEGY_LOOKBACKS.overextended);
    const refClose = bars[refIdx].close;
    const change = (last.close - refClose) / refClose;
    if (change > 0.6) {
      penalty += RISK_PENALTIES.overextended;
      reasons.push(
        `20 日累计涨幅 ${(change * 100).toFixed(1)}%，明显超买 (overextended)`,
      );
    }

    const prev = bars[bars.length - 2];
    if (wasFailedLimitUpBar(last, prev, meta.boardType)) {
      penalty += RISK_PENALTIES.failedLimitUpToday;
      reasons.push("今日炸板 (failed limit-up today)");
    }

    // High-volume stagnation: top range expansion vs avg but close in lower half.
    const ref = bars.slice(-11, -1);
    const avgVol = ref.reduce((s, b) => s + b.volume, 0) / Math.max(1, ref.length);
    const range = last.high - last.low;
    const closeInRange = range > 0 ? (last.close - last.low) / range : 0.5;
    if (last.volume > avgVol * 1.8 && closeInRange < 0.35 && last.pctChange < 1) {
      penalty += RISK_PENALTIES.highVolumeStagnation;
      reasons.push("放量滞涨 (high-volume stagnation)");
    }

    const avgAmount = ref.reduce((s, b) => s + b.amount, 0) / Math.max(1, ref.length);
    if (avgAmount < 50_000_000) {
      penalty += RISK_PENALTIES.lowLiquidity;
      reasons.push("成交额偏低 (low liquidity)");
    }
    if (last.turnoverRate > 30) {
      penalty += RISK_PENALTIES.abnormalTurnover;
      reasons.push(`换手率异常高 ${last.turnoverRate.toFixed(1)}% (abnormal turnover)`);
    }
  }

  if (sentiment) {
    if (sentiment.marketRegime === "WEAK") {
      penalty += RISK_PENALTIES.weakMarket;
      reasons.push("市场退潮期 (weak market regime)");
    } else if (sentiment.marketRegime === "PANIC") {
      penalty += RISK_PENALTIES.panicMarket;
      reasons.push("情绪冰点 (panic regime)");
    }
  }

  if (sector && sector.momentumScore < 40) {
    penalty += RISK_PENALTIES.sectorWeakening;
    reasons.push("板块动量走弱 (sector momentum weakening)");
  }

  if (penalty >= 35) level = "HIGH";
  else if (penalty >= 15) level = "MEDIUM";
  else level = "LOW";

  return {
    riskLevel: level,
    riskPenalty: Math.min(60, penalty),
    reasons,
    excluded: false,
  };
}
