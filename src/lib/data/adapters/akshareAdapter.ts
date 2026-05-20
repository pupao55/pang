// AkShare adapter — interface stub.
//
// AkShare is a Python library. Two viable integration shapes:
//   A) Run a small Python sidecar service (FastAPI) that fetches with akshare
//      and exposes JSON endpoints; this adapter does HTTP fetches.
//   B) Schedule an offline export script (Python -> CSV/Parquet) and read with
//      the CSV adapter; this adapter then becomes a thin convention wrapper
//      around csvAdapter.
//
// v1.1 ships the interface only — wiring is intentionally TODO so callers
// fail loudly if they try to use it before implementation.

import type { DataAdapter } from "./types";

export interface AkshareAdapterConfig {
  /** Base URL of the Python sidecar (shape A). */
  baseUrl?: string;
  /** Path to local export directory (shape B). */
  exportDir?: string;
  /** Optional API key / header. */
  apiKey?: string;
  /** Network timeout in ms. */
  timeoutMs?: number;
}

const NOT_IMPLEMENTED = (fn: string) => {
  throw new Error(
    `akshareAdapter.${fn} is not implemented. ` +
      "Provide a sidecar service or export pipeline; see src/lib/data/adapters/akshareAdapter.ts.",
  );
};

export function createAkshareAdapter(_config: AkshareAdapterConfig = {}): DataAdapter {
  return {
    id: "akshare",
    // TODO: implement via Python sidecar (akshare.stock_zh_a_hist, etc.) or
    // schedule a daily Python export to CSV and read via csvAdapter.
    async getStockMetas() {
      NOT_IMPLEMENTED("getStockMetas");
      return [];
    },
    async getDailyBars() {
      NOT_IMPLEMENTED("getDailyBars");
      return [];
    },
    async getDailyBarsForUniverse() {
      NOT_IMPLEMENTED("getDailyBarsForUniverse");
      return {};
    },
    async getSectorSnapshots() {
      NOT_IMPLEMENTED("getSectorSnapshots");
      return [];
    },
    async getMarketSentiment() {
      NOT_IMPLEMENTED("getMarketSentiment");
      return undefined;
    },
    async getTradingCalendar() {
      NOT_IMPLEMENTED("getTradingCalendar");
      return [];
    },
  };
}
