// Multi-provider data ingestion abstraction (v1.7).
//
// The DataAdapter interface stays the read-side contract for the rest of
// Pangzi. This module adds a *write-side* abstraction so we can describe and
// reason about each upstream provider uniformly — useful for provider
// campaigns, comparison reports, and the /validation UI.
//
// Concrete fetchers (Python scripts that write JSON to data/{provider}/)
// don't implement this interface directly; they conform by writing the
// shapes below into the on-disk JSON cache. The TS side of each provider is
// a thin adapter that reads that JSON.

import type { MarketSentimentSnapshot, SectorSnapshot } from "@/lib/types/market";
import type { StockDailyBar, StockMeta } from "@/lib/types/stock";

export type ProviderId =
  | "akshare"
  | "akshareLocal"
  | "baostock"
  | "baostockLocal"
  | "tushare"
  | "csv";

/** Normalized stock metadata produced by any provider. */
export interface ProviderStockMeta extends StockMeta {
  providerId: ProviderId;
  /** Provider's native symbol form, kept for traceability. */
  nativeSymbol?: string;
}

/** Normalized daily bar produced by any provider. */
export interface ProviderDailyBar extends StockDailyBar {
  providerId: ProviderId;
  /** Provider-recorded adjustment ("qfq" / "hfq" / "raw"). */
  adjust?: string;
}

export type ProviderFetchStatus =
  | "SUCCESS"
  | "FAILED"
  | "EMPTY_DATA"
  | "SCHEMA_ERROR"
  | "INVALID_SYMBOL"
  | "SKIPPED";

export interface ProviderError {
  symbol?: string;
  kind: "BLOCKED" | "NETWORK" | "RATE_LIMIT" | "AUTH" | "SCHEMA" | "UNKNOWN";
  message: string;
  retriable: boolean;
}

export interface ProviderFetchResult<T> {
  ok: boolean;
  data?: T;
  error?: ProviderError;
}

export interface ProviderHealthCheck {
  providerId: ProviderId;
  reachable: boolean;
  /** Aggregated tally if a status file is present. */
  knownSymbols: number;
  succeeded: number;
  failed: number;
  empty: number;
  lastUpdatedAt?: string;
  notes: string[];
}

/**
 * Loose write-side contract. Real implementations live in scripts/ (Python)
 * — TS callers typically read normalized output via the DataAdapter side.
 * We keep the interface here so cross-cutting code (campaign / comparison)
 * can describe each provider without depending on its concrete adapter.
 */
export interface MarketDataProvider {
  readonly providerId: ProviderId;
  getUniverse(): Promise<ProviderStockMeta[]>;
  getDailyBars(
    symbol: string,
    startDate: string,
    endDate: string,
    adjust?: "qfq" | "hfq" | "raw",
  ): Promise<ProviderFetchResult<ProviderDailyBar[]>>;
  getMetadata?(): Promise<ProviderStockMeta[]>;
  getSectors?(date: string): Promise<SectorSnapshot[]>;
  getMarketSentiment?(date: string): Promise<MarketSentimentSnapshot | undefined>;
  healthCheck(): Promise<ProviderHealthCheck>;
}
