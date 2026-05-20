import { buildBars, type BarBuilderConfig } from "@/lib/data/barBuilder";
import type { MarketSentimentSnapshot, SectorSnapshot } from "@/lib/types/market";
import type { StockMeta } from "@/lib/types/stock";
import type { StrategyContext } from "@/lib/strategies/types";

export const TEST_DATE = "2026-05-19";

export const baseMeta = (override: Partial<StockMeta> = {}): StockMeta => ({
  symbol: "TST001",
  name: "TestCo",
  exchange: "SZ",
  boardType: "MAIN",
  industry: "Test",
  concepts: [],
  isST: false,
  marketCap: 10_000_000_000,
  floatMarketCap: 6_000_000_000,
  ...override,
});

export const baseSector = (override: Partial<SectorSnapshot> = {}): SectorSnapshot => ({
  date: TEST_DATE,
  sectorName: "Test",
  pctChange: 1.2,
  limitUpCount: 1,
  topStocks: [],
  strengthRank: 5,
  momentumScore: 60,
  ...override,
});

export const baseSentiment = (
  override: Partial<MarketSentimentSnapshot> = {},
): MarketSentimentSnapshot => ({
  date: TEST_DATE,
  indexTrend: "UP",
  limitUpCount: 40,
  limitDownCount: 8,
  failedLimitUpRate: 0.1,
  maxConsecutiveLimitUp: 4,
  yesterdayLimitUpPerformance: 1.5,
  marketRegime: "STRONG",
  ...override,
});

export function buildCtx(
  cfg: Omit<BarBuilderConfig, "bars"> & { bars?: number },
  override: Partial<StrategyContext> = {},
): StrategyContext {
  const bars = buildBars({ ...cfg, bars: cfg.bars ?? 80 }, TEST_DATE);
  return {
    meta: baseMeta({ symbol: cfg.symbol, name: cfg.name, boardType: cfg.boardType }),
    bars,
    sector: baseSector(),
    sentiment: baseSentiment(),
    ...override,
  };
}
