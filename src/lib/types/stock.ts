// Domain types describing A-share stocks and their daily price bars.
// Concepts kept close to Tongdaxin terminology to ease later mapping
// to real market data providers (Tushare, AKShare, etc.).

export type BoardType = "MAIN" | "CHINEXT" | "STAR";

export interface StockDailyBar {
  symbol: string;
  name: string;
  /** ISO date (YYYY-MM-DD) — A-share trading day, no time zone. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Volume in shares. */
  volume: number;
  /** Turnover amount in CNY. */
  amount: number;
  /** Free-float turnover rate, percent (e.g. 5.2 means 5.2%). */
  turnoverRate: number;
  /** Daily percent change vs. previous close, percent. */
  pctChange: number;
}

export interface StockMeta {
  symbol: string;
  name: string;
  /** "SH" or "SZ" or "BJ". */
  exchange: string;
  boardType: BoardType;
  industry: string;
  concepts: string[];
  isST: boolean;
  /** Total market cap in CNY. */
  marketCap: number;
  /** Free-float market cap in CNY. */
  floatMarketCap: number;
  hasDelistingRisk?: boolean;
  hasRecentReduction?: boolean;
  hasRecentUnlock?: boolean;
  hasRegulatoryWarning?: boolean;
}

export type LimitType = "NORMAL_10CM" | "CHINEXT_20CM" | "STAR_20CM";

export interface LimitUpEvent {
  symbol: string;
  date: string;
  limitType: LimitType;
  /** True if the bar closed at the limit-up price (涨停). */
  isLimitUp: boolean;
  /** True if the bar touched limit-up intraday but failed to seal (炸板). */
  isFailedLimitUp: boolean;
  firstSealTime?: string;
  lastSealTime?: string;
  /** Buy-side amount sealing the limit board, in CNY. */
  sealAmount?: number;
  /** Number of consecutive limit-up days including this one. */
  consecutiveLimitUpCount?: number;
}
