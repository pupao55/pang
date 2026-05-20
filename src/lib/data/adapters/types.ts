// Data adapter contract. Strategies and engines depend only on these shapes,
// never on the concrete adapter, so adding real-data providers is purely a
// matter of implementing this interface.

import type {
  MarketSentimentSnapshot,
  SectorSnapshot,
} from "@/lib/types/market";
import type { StockDailyBar, StockMeta } from "@/lib/types/stock";

export interface DataAdapter {
  /** Identifies the adapter (for diagnostics and logging). */
  readonly id: string;

  /** Static metadata for the universe of stocks the adapter exposes. */
  getStockMetas(): Promise<StockMeta[]>;

  /**
   * Chronological daily bars for one symbol, inclusive of both bounds.
   * Returns an empty array if no data is available.
   */
  getDailyBars(
    symbol: string,
    startDate: string,
    endDate: string,
  ): Promise<StockDailyBar[]>;

  /** Batch convenience: same as getDailyBars repeated. */
  getDailyBarsForUniverse(
    symbols: string[],
    startDate: string,
    endDate: string,
  ): Promise<Record<string, StockDailyBar[]>>;

  /**
   * Sector snapshots for a given trading day. If the adapter has no notion of
   * per-day snapshots it may return the most recent or a static snapshot.
   * Engines should treat missing data as "no sector context".
   */
  getSectorSnapshots(date: string): Promise<SectorSnapshot[]>;

  /** Market sentiment for a given trading day or undefined if unavailable. */
  getMarketSentiment(date: string): Promise<MarketSentimentSnapshot | undefined>;

  /**
   * Trading calendar (inclusive). Real-data adapters MUST exclude weekends
   * AND market holidays. Mock adapter derives from generated bars.
   */
  getTradingCalendar(startDate: string, endDate: string): Promise<string[]>;
}
