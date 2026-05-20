// CSV-backed adapter.
//
// Wraps an in-memory CSV import. The user is expected to provide:
//   - daily-bar CSV text (or pre-parsed map)
//   - the StockMeta universe
//   - optional sector + sentiment snapshots
//
// Useful for:
//   - tests against synthetic CSV fixtures
//   - one-off analyses where someone has already exported bars

import type { DataAdapter } from "./types";
import type { StockDailyBar, StockMeta } from "@/lib/types/stock";
import type {
  MarketSentimentSnapshot,
  SectorSnapshot,
} from "@/lib/types/market";
import { importDailyBarsCsv, type CsvWarning } from "@/lib/data/csvImporter";

export interface CsvAdapterInput {
  metas: StockMeta[];
  /** Either pre-parsed bars or raw CSV text. */
  bars?: Record<string, StockDailyBar[]>;
  csv?: string;
  /** Per-date sector snapshots; key is YYYY-MM-DD. */
  sectorsByDate?: Record<string, SectorSnapshot[]>;
  /** Per-date sentiment snapshots; key is YYYY-MM-DD. */
  sentimentByDate?: Record<string, MarketSentimentSnapshot>;
  /** Optional explicit trading calendar; derived from bars otherwise. */
  tradingCalendar?: string[];
}

export interface CsvAdapter extends DataAdapter {
  /** Parse warnings surfaced during initial import. */
  readonly warnings: CsvWarning[];
}

export function createCsvAdapter(input: CsvAdapterInput): CsvAdapter {
  let bars: Record<string, StockDailyBar[]>;
  let warnings: CsvWarning[] = [];

  if (input.bars) {
    bars = input.bars;
  } else if (input.csv !== undefined) {
    const r = importDailyBarsCsv(input.csv);
    bars = r.bars;
    warnings = r.warnings;
    if (r.hasFatalError) {
      throw new Error(
        `CSV import failed: ${r.warnings.map((w) => w.detail).join("; ")}`,
      );
    }
  } else {
    throw new Error("createCsvAdapter requires either `bars` or `csv`");
  }

  function sliceBars(
    all: StockDailyBar[],
    start: string,
    end: string,
  ): StockDailyBar[] {
    return all.filter((b) => b.date >= start && b.date <= end);
  }

  const calendar = (() => {
    if (input.tradingCalendar) return [...input.tradingCalendar].sort();
    const dates = new Set<string>();
    for (const sym of Object.keys(bars)) for (const b of bars[sym]) dates.add(b.date);
    return Array.from(dates).sort();
  })();

  return {
    id: "csv",
    warnings,

    async getStockMetas() {
      return input.metas;
    },

    async getDailyBars(symbol, startDate, endDate) {
      return sliceBars(bars[symbol] ?? [], startDate, endDate);
    },

    async getDailyBarsForUniverse(symbols, startDate, endDate) {
      const out: Record<string, StockDailyBar[]> = {};
      for (const s of symbols) out[s] = sliceBars(bars[s] ?? [], startDate, endDate);
      return out;
    },

    async getSectorSnapshots(date) {
      const exact = input.sectorsByDate?.[date];
      if (exact) return exact;
      // Fall back to the most recent snapshot at or before `date`.
      if (input.sectorsByDate) {
        const keys = Object.keys(input.sectorsByDate)
          .filter((k) => k <= date)
          .sort();
        const last = keys[keys.length - 1];
        if (last) return input.sectorsByDate[last];
      }
      return [];
    },

    async getMarketSentiment(date) {
      const exact = input.sentimentByDate?.[date];
      if (exact) return exact;
      if (input.sentimentByDate) {
        const keys = Object.keys(input.sentimentByDate)
          .filter((k) => k <= date)
          .sort();
        const last = keys[keys.length - 1];
        if (last) return input.sentimentByDate[last];
      }
      return undefined;
    },

    async getTradingCalendar(startDate, endDate) {
      return calendar.filter((d) => d >= startDate && d <= endDate);
    },
  };
}
