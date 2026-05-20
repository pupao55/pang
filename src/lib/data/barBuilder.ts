import type { BoardType, StockDailyBar } from "@/lib/types/stock";

// Tiny seeded RNG so mock data is deterministic across machines.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type BarEvent =
  | { kind: "limitUp"; t: number; nearOnly?: boolean; turnover?: number }
  | { kind: "failedLimitUp"; t: number; closeFromOpen?: number }
  | { kind: "maxTurnover"; t: number; rangePct?: number; turnover?: number; closePct?: number }
  | { kind: "breakout"; t: number; pct: number; amountMultiple?: number; turnoverMultiple?: number }
  | { kind: "highVolumeStagnation"; t: number }
  | { kind: "drift"; t: number; pct: number };

export interface BarBuilderConfig {
  symbol: string;
  name: string;
  basePrice: number;
  baseVolume: number; // shares
  baseTurnoverRate: number; // percent
  boardType: BoardType;
  bars: number; // total trading bars to produce
  seed: number;
  events?: BarEvent[];
  /** Daily drift between events (decimal, e.g. 0.001 = +0.1%/day). */
  drift?: number;
  /** Daily volatility for normal bars (decimal, e.g. 0.015). */
  volatility?: number;
}

/** Trading-day date sequence ending at endDate, skipping weekends. */
export function makeTradingDates(endDate: string, count: number): string[] {
  const out: string[] = [];
  const cursor = new Date(endDate + "T00:00:00Z");
  while (out.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      out.unshift(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out;
}

const LIMIT_PCT = {
  MAIN: 0.1,
  CHINEXT: 0.2,
  STAR: 0.2,
} satisfies Record<BoardType, number>;

export function buildBars(cfg: BarBuilderConfig, endDate: string): StockDailyBar[] {
  const dates = makeTradingDates(endDate, cfg.bars);
  const rand = mulberry32(cfg.seed);
  const drift = cfg.drift ?? 0.0008;
  const vol = cfg.volatility ?? 0.018;
  const eventByT = new Map<number, BarEvent>();
  for (const e of cfg.events ?? []) eventByT.set(e.t, e);

  const out: StockDailyBar[] = [];
  let prevClose = cfg.basePrice;
  for (let t = 0; t < dates.length; t++) {
    const date = dates[t];
    const evt = eventByT.get(t);
    let open: number;
    let high: number;
    let low: number;
    let close: number;
    let volume = cfg.baseVolume * (0.8 + rand() * 0.4);
    let turnoverRate = cfg.baseTurnoverRate * (0.7 + rand() * 0.6);

    if (evt?.kind === "limitUp") {
      const pct = LIMIT_PCT[cfg.boardType] * (evt.nearOnly ? 0.92 : 1);
      const change = pct;
      close = +(prevClose * (1 + change)).toFixed(2);
      open = +(prevClose * (1 + change * 0.4)).toFixed(2);
      high = close;
      low = +(prevClose * (1 + change * 0.2)).toFixed(2);
      volume = cfg.baseVolume * 2.2;
      turnoverRate = evt.turnover ?? cfg.baseTurnoverRate * 2.5;
    } else if (evt?.kind === "failedLimitUp") {
      const lim = LIMIT_PCT[cfg.boardType];
      const closeChange = evt.closeFromOpen ?? lim * 0.5;
      high = +(prevClose * (1 + lim)).toFixed(2);
      open = +(prevClose * (1 + lim * 0.8)).toFixed(2);
      close = +(prevClose * (1 + closeChange)).toFixed(2);
      low = +(prevClose * (1 + closeChange - 0.01)).toFixed(2);
      volume = cfg.baseVolume * 2.6;
      turnoverRate = cfg.baseTurnoverRate * 2.8;
    } else if (evt?.kind === "maxTurnover") {
      const rangePct = evt.rangePct ?? 0.07;
      const closePct = evt.closePct ?? 0.04;
      high = +(prevClose * (1 + rangePct)).toFixed(2);
      low = +(prevClose * (1 - rangePct * 0.2)).toFixed(2);
      open = +(prevClose * (1 + closePct * 0.2)).toFixed(2);
      close = +(prevClose * (1 + closePct)).toFixed(2);
      turnoverRate = evt.turnover ?? cfg.baseTurnoverRate * 3.2;
      volume = cfg.baseVolume * 2.5;
    } else if (evt?.kind === "breakout") {
      const change = evt.pct;
      open = +(prevClose * (1 + change * 0.3)).toFixed(2);
      close = +(prevClose * (1 + change)).toFixed(2);
      high = +(close * 1.005).toFixed(2);
      low = +(open * 0.995).toFixed(2);
      volume = cfg.baseVolume * (evt.amountMultiple ?? 1.8);
      turnoverRate = cfg.baseTurnoverRate * (evt.turnoverMultiple ?? 1.8);
    } else if (evt?.kind === "highVolumeStagnation") {
      open = +(prevClose * 1.01).toFixed(2);
      high = +(prevClose * 1.05).toFixed(2);
      low = +(prevClose * 0.992).toFixed(2);
      close = +(prevClose * 1.002).toFixed(2);
      volume = cfg.baseVolume * 2.2;
      turnoverRate = cfg.baseTurnoverRate * 2.4;
    } else if (evt?.kind === "drift") {
      const change = evt.pct;
      open = +(prevClose * (1 + change * 0.3)).toFixed(2);
      close = +(prevClose * (1 + change)).toFixed(2);
      high = +(Math.max(open, close) * 1.005).toFixed(2);
      low = +(Math.min(open, close) * 0.995).toFixed(2);
    } else {
      const shock = (rand() - 0.5) * 2 * vol;
      const change = drift + shock;
      open = +(prevClose * (1 + (rand() - 0.5) * vol * 0.5)).toFixed(2);
      close = +(prevClose * (1 + change)).toFixed(2);
      high = +(Math.max(open, close) * (1 + Math.abs(shock) * 0.5)).toFixed(2);
      low = +(Math.min(open, close) * (1 - Math.abs(shock) * 0.5)).toFixed(2);
    }

    // Safety: ensure ordering invariant
    high = Math.max(high, open, close);
    low = Math.min(low, open, close);

    const pctChange = +(((close - prevClose) / prevClose) * 100).toFixed(2);
    const amount = +(volume * ((open + close + high + low) / 4)).toFixed(0);

    out.push({
      symbol: cfg.symbol,
      name: cfg.name,
      date,
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
      volume: Math.round(volume),
      amount,
      turnoverRate: +turnoverRate.toFixed(2),
      pctChange,
    });
    prevClose = close;
  }
  return out;
}
