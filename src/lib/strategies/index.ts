import { firstBreakoutStrategy } from "./firstBreakoutStrategy";
import { limitUpSecondBuyStrategy } from "./limitUpSecondBuyStrategy";
import { maxTurnoverBreakoutStrategy } from "./maxTurnoverBreakoutStrategy";
import { sectorLeaderStrategy } from "./sectorLeaderStrategy";
import { trendPullbackStrategy } from "./trendPullbackStrategy";
import type { Strategy } from "./types";

export interface StrategyDefinition {
  id: string;
  nameCN: string;
  nameEN: string;
  /** Combined display name, kept for back-compat with v1. */
  name: string;
  fn: Strategy;
}

function def(id: string, nameCN: string, nameEN: string, fn: Strategy): StrategyDefinition {
  return { id, nameCN, nameEN, name: `${nameCN} / ${nameEN}`, fn };
}

export const STRATEGY_LIST: StrategyDefinition[] = [
  def("limitUpSecondBuy", "涨停后二买", "Limit-up Second Buy", limitUpSecondBuyStrategy),
  def("maxTurnoverBreakout", "最大换手位突破", "Max Turnover Breakout", maxTurnoverBreakoutStrategy),
  def("sectorLeader", "板块龙头", "Sector Leader", sectorLeaderStrategy),
  def("trendPullback", "趋势回踩", "Trend Pullback", trendPullbackStrategy),
  def("firstBreakout", "低位首爆", "First Breakout", firstBreakoutStrategy),
];

export const STRATEGIES: Record<string, StrategyDefinition> = Object.fromEntries(
  STRATEGY_LIST.map((d) => [d.id, d]),
);

export type { Strategy, StrategyCandidate, StrategyContext } from "./types";
export {
  firstBreakoutStrategy,
  limitUpSecondBuyStrategy,
  maxTurnoverBreakoutStrategy,
  sectorLeaderStrategy,
  trendPullbackStrategy,
};
