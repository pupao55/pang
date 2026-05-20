import { buildBars, type BarBuilderConfig } from "./barBuilder";
import { MOCK_STOCKS } from "./mockStocks";
import type { StockDailyBar } from "@/lib/types/stock";

/**
 * Mock evaluation date — the "today" the screening engine acts on.
 * Bars are generated ending at this date.
 */
export const EVAL_DATE = "2026-05-19";

const BARS = 80;

type ConfigSpec = Omit<BarBuilderConfig, "bars" | "boardType"> & {
  symbol: string;
};

function specFor(symbol: string): BarBuilderConfig {
  const meta = MOCK_STOCKS.find((s) => s.symbol === symbol);
  if (!meta) throw new Error(`Unknown mock symbol: ${symbol}`);
  const baseCfg: ConfigSpec = SPECS[symbol];
  return { ...baseCfg, bars: BARS, boardType: meta.boardType };
}

// All event indices are relative to a 0..(BARS-1) timeline, so t=79 is today.
const SPECS: Record<string, ConfigSpec> = {
  // 1. Strong limit-up second-buy setup. Limit-up 20+ days ago, healthy
  // pullback, today reclaims limit-up body high with MA10 reclaim.
  "300101": {
    symbol: "300101",
    name: "智算先锋",
    basePrice: 30,
    baseVolume: 9_000_000,
    baseTurnoverRate: 4,
    seed: 11,
    drift: 0.001,
    volatility: 0.012,
    events: [
      { kind: "drift", t: 55, pct: 0.04 },
      { kind: "limitUp", t: 56, turnover: 16 },
      { kind: "drift", t: 57, pct: -0.03 },
      { kind: "drift", t: 58, pct: -0.02 },
      { kind: "drift", t: 59, pct: -0.015 },
      { kind: "drift", t: 60, pct: 0.005 },
      { kind: "drift", t: 76, pct: 0.02 },
      { kind: "drift", t: 77, pct: 0.015 },
      { kind: "drift", t: 78, pct: 0.025 },
      { kind: "breakout", t: 79, pct: 0.06, amountMultiple: 1.8, turnoverMultiple: 1.6 },
    ],
  },

  // 2. AI sector leader. Steady uptrend, strong close today.
  "688202": {
    symbol: "688202",
    name: "星算芯科",
    basePrice: 80,
    baseVolume: 6_000_000,
    baseTurnoverRate: 3.5,
    seed: 22,
    drift: 0.003,
    volatility: 0.014,
    events: [
      { kind: "drift", t: 70, pct: 0.025 },
      { kind: "drift", t: 71, pct: 0.018 },
      { kind: "drift", t: 72, pct: 0.012 },
      { kind: "drift", t: 73, pct: -0.008 },
      { kind: "drift", t: 74, pct: -0.005 },
      { kind: "drift", t: 75, pct: 0.011 },
      { kind: "drift", t: 76, pct: 0.014 },
      { kind: "drift", t: 77, pct: 0.022 },
      { kind: "drift", t: 78, pct: 0.018 },
      { kind: "breakout", t: 79, pct: 0.035, amountMultiple: 1.5, turnoverMultiple: 1.4 },
    ],
  },

  // 3. Max-turnover breakout. Battle zone established ~30 days ago,
  // sideways consolidation, today reclaims body high with amount expansion.
  "600303": {
    symbol: "600303",
    name: "蓝色锂能",
    basePrice: 22,
    baseVolume: 18_000_000,
    baseTurnoverRate: 3,
    seed: 33,
    drift: 0.0008,
    volatility: 0.013,
    events: [
      { kind: "maxTurnover", t: 50, rangePct: 0.08, closePct: 0.045, turnover: 14 },
      { kind: "drift", t: 51, pct: -0.02 },
      { kind: "drift", t: 52, pct: -0.015 },
      { kind: "drift", t: 78, pct: 0.018 },
      { kind: "breakout", t: 79, pct: 0.048, amountMultiple: 1.7, turnoverMultiple: 1.5 },
    ],
  },

  // 4. Trend pullback. MA stack bullish, recent pullback to MA10, today rebound.
  "002404": {
    symbol: "002404",
    name: "灵巧机器人",
    basePrice: 18,
    baseVolume: 12_000_000,
    baseTurnoverRate: 3.2,
    seed: 44,
    drift: 0.0025,
    volatility: 0.011,
    events: [
      { kind: "drift", t: 74, pct: 0.015 },
      { kind: "drift", t: 75, pct: -0.022 },
      { kind: "drift", t: 76, pct: -0.018 },
      { kind: "drift", t: 77, pct: -0.012 },
      { kind: "drift", t: 78, pct: 0.005 },
      { kind: "breakout", t: 79, pct: 0.028, amountMultiple: 1.4, turnoverMultiple: 1.3 },
    ],
  },

  // 5. First breakout. Quiet base, today breaks 40-day high with both
  // amount and turnover expansion.
  "300505": {
    symbol: "300505",
    name: "云顶低空",
    basePrice: 24,
    baseVolume: 8_000_000,
    baseTurnoverRate: 3,
    seed: 55,
    drift: 0.0005,
    volatility: 0.012,
    events: [
      { kind: "drift", t: 60, pct: 0.02 },
      { kind: "drift", t: 70, pct: 0.015 },
      { kind: "drift", t: 75, pct: 0.012 },
      { kind: "breakout", t: 79, pct: 0.08, amountMultiple: 2.2, turnoverMultiple: 2.0 },
    ],
  },

  // 6. Neutral random walk — should not produce a signal.
  "300606": {
    symbol: "300606",
    name: "康卫信息",
    basePrice: 16,
    baseVolume: 5_000_000,
    baseTurnoverRate: 2.5,
    seed: 66,
    drift: 0,
    volatility: 0.01,
    events: [],
  },

  // 7. ST stock — risk filter excludes outright.
  "000707": {
    symbol: "000707",
    name: "*ST 远帆",
    basePrice: 6,
    baseVolume: 4_000_000,
    baseTurnoverRate: 2,
    seed: 77,
    drift: -0.002,
    volatility: 0.018,
    events: [],
  },

  // 8. Has regulatory warning, mild uptrend → penalty applied.
  "600808": {
    symbol: "600808",
    name: "瑞讯医药",
    basePrice: 12,
    baseVolume: 7_000_000,
    baseTurnoverRate: 3,
    seed: 88,
    drift: 0.0015,
    volatility: 0.012,
    events: [
      { kind: "drift", t: 75, pct: 0.015 },
      { kind: "drift", t: 76, pct: 0.012 },
      { kind: "drift", t: 77, pct: 0.018 },
      { kind: "drift", t: 78, pct: 0.012 },
      { kind: "breakout", t: 79, pct: 0.045, amountMultiple: 1.6, turnoverMultiple: 1.5 },
    ],
  },

  // 9. High-volume stagnation — risk filter penalty.
  "002909": {
    symbol: "002909",
    name: "海岩新材",
    basePrice: 28,
    baseVolume: 10_000_000,
    baseTurnoverRate: 3.5,
    seed: 99,
    drift: 0.0008,
    volatility: 0.012,
    events: [
      { kind: "drift", t: 75, pct: 0.015 },
      { kind: "drift", t: 78, pct: 0.012 },
      { kind: "highVolumeStagnation", t: 79 },
    ],
  },

  // 10. Low liquidity — base amount intentionally tiny.
  "002010": {
    symbol: "002010",
    name: "南国软件",
    basePrice: 9,
    baseVolume: 1_200_000,
    baseTurnoverRate: 1.2,
    seed: 110,
    drift: 0.0008,
    volatility: 0.013,
    events: [
      { kind: "drift", t: 78, pct: 0.015 },
      { kind: "breakout", t: 79, pct: 0.04, amountMultiple: 1.6, turnoverMultiple: 1.6 },
    ],
  },

  // 11. Recent reduction + failed limit-up today.
  "002111": {
    symbol: "002111",
    name: "东冶重工",
    basePrice: 14,
    baseVolume: 9_000_000,
    baseTurnoverRate: 3,
    seed: 121,
    drift: 0.0008,
    volatility: 0.012,
    events: [
      { kind: "drift", t: 78, pct: 0.02 },
      { kind: "failedLimitUp", t: 79, closeFromOpen: 0.055 },
    ],
  },

  // 12. Overextended (60-day large rise) + recent unlock pressure.
  "300212": {
    symbol: "300212",
    name: "极目飞控",
    basePrice: 14,
    baseVolume: 10_000_000,
    baseTurnoverRate: 4,
    seed: 132,
    drift: 0.012, // ~+85% over 60 days
    volatility: 0.018,
    events: [
      { kind: "drift", t: 78, pct: 0.03 },
      { kind: "drift", t: 79, pct: 0.025 },
    ],
  },
};

let _cache: Record<string, StockDailyBar[]> | null = null;

/** Lazy build + cache to avoid recomputing during a single SSR cycle. */
export function getMockBarsBySymbol(): Record<string, StockDailyBar[]> {
  if (_cache) return _cache;
  const out: Record<string, StockDailyBar[]> = {};
  for (const meta of MOCK_STOCKS) {
    out[meta.symbol] = buildBars(specFor(meta.symbol), EVAL_DATE);
  }
  _cache = out;
  return out;
}

export function getMockBars(symbol: string): StockDailyBar[] {
  return getMockBarsBySymbol()[symbol] ?? [];
}
