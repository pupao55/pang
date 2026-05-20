// Backtest types — describe a simulated trade and aggregate result.

import type { CostModel } from "@/lib/config/costs";

export type BuyRule = "CLOSE" | "NEXT_OPEN";

export type SellRule =
  | "FIXED_DAYS"
  | "STOP_LOSS_TAKE_PROFIT"
  | "BREAK_MA10"
  | "BREAK_SUPPORT";

export interface PortfolioConfig {
  /** Total starting capital, default 1_000_000 CNY. */
  startingCapital?: number;
  /**
   * If false, only one position at a time across the whole portfolio
   * (sequential mode — matches v1 behavior for back-compat).
   */
  allowConcurrentPositions?: boolean;
  /** Hard cap on simultaneously held positions. */
  maxConcurrentPositions?: number;
  /** Per-sector position cap. */
  maxPositionsPerSector?: number;
  /** Allow re-entering the same symbol while already holding it. */
  allowSameSymbolOverlap?: boolean;
  /** Minimum signal score required to enter a trade (0 = no gate). */
  minScore?: number;
}

export interface BacktestParams {
  strategyId: string;
  startDate: string;
  endDate: string;
  buyRule: BuyRule;
  sellRule: SellRule;
  maxHoldingDays: number;
  /** Percent, e.g. 6 means -6% triggers stop loss. */
  stopLossPct: number;
  /** Percent, e.g. 12 means +12% triggers take profit. */
  takeProfitPct: number;
  portfolio?: PortfolioConfig;
  costs?: CostModel;
}

export interface BacktestTrade {
  symbol: string;
  strategyId: string;
  entryDate: string;
  exitDate: string;
  /** Fill price after slippage. */
  entryPrice: number;
  /** Fill price after slippage. */
  exitPrice: number;
  /** Return on entry notional after costs, percent. */
  returnPct: number;
  /** Pre-cost return for diagnostic comparison. */
  grossReturnPct: number;
  holdingDays: number;
  exitReason: string;
  /** P&L breakdown in CNY. */
  pnlCny: number;
  feesCny: number;
  slippageCny: number;
  /** Original signal context for diagnostics. */
  signalType?: string;
  signalScore?: number;
  riskLevel?: string;
  sector?: string;
}

export interface EquityPoint {
  date: string;
  equity: number;
  cash?: number;
  positionsValue?: number;
  positionCount?: number;
}

export type SkipReason =
  | "POSITION_CAP"
  | "SECTOR_CAP"
  | "SYMBOL_OVERLAP"
  | "RISK_FORBIDDEN"
  | "MIN_SCORE"
  | "LIMIT_OPEN_BLOCKED"
  | "INSUFFICIENT_CASH"
  | "NO_NEXT_BAR";

export interface SkippedSignal {
  date: string;
  symbol: string;
  reason: SkipReason;
}

export interface BacktestResult {
  strategyId: string;
  startDate: string;
  endDate: string;
  /** Total return on starting equity, percent. */
  totalReturn: number;
  annualizedReturn: number;
  winRate: number;
  averageReturn: number;
  /** Average winner / |average loser|. */
  profitLossRatio: number;
  maxDrawdown: number;
  maxConsecutiveLosses: number;
  /** Fraction of days with at least one open position, 0..1. */
  exposureRatio: number;
  averageHoldingDays: number;
  /** Sum of trade notional / starting capital. */
  turnover: number;
  totalFeesCny: number;
  totalSlippageCny: number;
  signalCount: number;
  executedTradeCount: number;
  skippedSignalCount: number;
  skipReasonCounts: Partial<Record<SkipReason, number>>;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  /** Echo of the cost model used (for transparency in diagnostics). */
  costs?: CostModel;
}
