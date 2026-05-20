import type { MarketSentimentSnapshot } from "@/lib/types/market";
import { EVAL_DATE } from "./mockDailyBars";

export const MOCK_SENTIMENT: MarketSentimentSnapshot = {
  date: EVAL_DATE,
  indexTrend: "UP",
  limitUpCount: 62,
  limitDownCount: 8,
  failedLimitUpRate: 0.18,
  maxConsecutiveLimitUp: 5,
  yesterdayLimitUpPerformance: 2.4,
  marketRegime: "STRONG",
};

/**
 * Returns a short English+Chinese explanation of the current market regime.
 * Pure function — used by the dashboard.
 */
export function describeMarketRegime(s: MarketSentimentSnapshot): string {
  switch (s.marketRegime) {
    case "STRONG":
      return "市场赚钱效应明显，涨停家数多、炸板率低，适合积极参与强势股。 (Strong profit effect — favor leaders.)";
    case "NEUTRAL":
      return "市场中性，板块轮动较快，建议精选龙头并控制仓位。 (Neutral — rotate carefully, pick leaders.)";
    case "WEAK":
      return "市场进入退潮期，炸板率上升，建议降低仓位、避免追高。 (Cooldown — reduce exposure.)";
    case "PANIC":
      return "情绪冰点，普跌环境下应保持空仓或等待企稳信号。 (Panic — stay defensive.)";
  }
}
