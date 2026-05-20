// In-memory adapter backed by the deterministic mock dataset.
// Used by the app's pages and by every test that needs a representative
// universe without hitting disk or network.

import type { DataAdapter } from "./types";
import type { StockDailyBar, StockMeta } from "@/lib/types/stock";
import type { MarketSentimentSnapshot, SectorSnapshot } from "@/lib/types/market";
import { MOCK_STOCKS } from "@/lib/data/mockStocks";
import { MOCK_SECTORS } from "@/lib/data/mockSectors";
import { MOCK_SENTIMENT } from "@/lib/data/mockSentiment";
import { getMockBarsBySymbol } from "@/lib/data/mockDailyBars";

function sliceBars(
  bars: StockDailyBar[],
  startDate: string,
  endDate: string,
): StockDailyBar[] {
  return bars.filter((b) => b.date >= startDate && b.date <= endDate);
}

export function createMockAdapter(): DataAdapter {
  return {
    id: "mock",

    async getStockMetas(): Promise<StockMeta[]> {
      return MOCK_STOCKS;
    },

    async getDailyBars(symbol, startDate, endDate): Promise<StockDailyBar[]> {
      const all = getMockBarsBySymbol()[symbol] ?? [];
      return sliceBars(all, startDate, endDate);
    },

    async getDailyBarsForUniverse(
      symbols,
      startDate,
      endDate,
    ): Promise<Record<string, StockDailyBar[]>> {
      const out: Record<string, StockDailyBar[]> = {};
      const all = getMockBarsBySymbol();
      for (const sym of symbols) {
        out[sym] = sliceBars(all[sym] ?? [], startDate, endDate);
      }
      return out;
    },

    async getSectorSnapshots(_date: string): Promise<SectorSnapshot[]> {
      // Mock v1.1 limitation: a single static snapshot is returned for any
      // requested date (see AUDIT H-2). A real adapter would key by date.
      return MOCK_SECTORS;
    },

    async getMarketSentiment(
      _date: string,
    ): Promise<MarketSentimentSnapshot | undefined> {
      return MOCK_SENTIMENT;
    },

    async getTradingCalendar(
      startDate: string,
      endDate: string,
    ): Promise<string[]> {
      // Derive from the mock bar timeline of the first stock; all mock stocks
      // share the same trading calendar by construction.
      const first = MOCK_STOCKS[0];
      const bars = getMockBarsBySymbol()[first.symbol] ?? [];
      return bars
        .map((b) => b.date)
        .filter((d) => d >= startDate && d <= endDate);
    },
  };
}
