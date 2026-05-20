import type {
  MarketSentimentSnapshot,
  SectorSnapshot,
} from "@/lib/types/market";
import type { StockDailyBar, StockMeta } from "@/lib/types/stock";
import type { SignalType } from "@/lib/types/signal";

/** Read-only context passed to every strategy. Pure functions only. */
export interface StrategyContext {
  meta: StockMeta;
  /** Daily bars in chronological order (oldest first). */
  bars: StockDailyBar[];
  /** Sector snapshot of `meta.industry` or strongest matching concept. */
  sector?: SectorSnapshot;
  /** Market-wide sentiment snapshot for the evaluation date. */
  sentiment?: MarketSentimentSnapshot;
}

/** Raw output from a strategy before scoring and risk filtering. */
export interface StrategyCandidate {
  strategyId: string;
  strategyName: string;
  signalType: SignalType;
  /** Pre-scoring technical confidence, 0-100. */
  technicalScore: number;
  keySupport: number;
  keyResistance: number;
  stopLoss: number;
  target1: number;
  target2: number;
  explanation: string[];
  bullishFactors: string[];
  bearishFactors: string[];
}

export type Strategy = (ctx: StrategyContext) => StrategyCandidate | null;
