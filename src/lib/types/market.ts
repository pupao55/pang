// Market-level types: sector strength snapshots and overall sentiment regime.

export type MarketRegime = "STRONG" | "NEUTRAL" | "WEAK" | "PANIC";

export interface SectorSnapshot {
  date: string;
  sectorName: string;
  /** Sector pct change for the day, percent. */
  pctChange: number;
  limitUpCount: number;
  /** Symbols of the strongest leaders in the sector. */
  topStocks: string[];
  /** 1 = strongest sector of the day. */
  strengthRank: number;
  /** 0-100 momentum score, reflecting multi-day trend. */
  momentumScore: number;
}

export interface MarketSentimentSnapshot {
  date: string;
  indexTrend: "UP" | "SIDEWAYS" | "DOWN";
  limitUpCount: number;
  limitDownCount: number;
  /** Percent of intraday limit-up touches that failed to seal (炸板率). */
  failedLimitUpRate: number;
  /** Tallest 连板 number across the market on that day. */
  maxConsecutiveLimitUp: number;
  /**
   * Average next-day return of yesterday's limit-up cohort, percent.
   * Acts as a proxy for 赚钱效应 (market profit effect).
   */
  yesterdayLimitUpPerformance: number;
  marketRegime: MarketRegime;
}
