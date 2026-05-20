// Tushare adapter — interface stub.
//
// Tushare Pro is an HTTP API (POST JSON with {api_name, token, params, fields}).
// Production wiring would issue rate-limited fetches against
// https://api.tushare.pro and convert each endpoint's table response into
// the StockDailyBar / SectorSnapshot / MarketSentimentSnapshot shapes.
//
// Quotas, schema versioning, and adjustment factor handling (`adj_factor`)
// are all real-data concerns deferred until a paid Tushare key is configured.

import type { DataAdapter } from "./types";

export interface TushareAdapterConfig {
  /** Tushare Pro API token. */
  token: string;
  /** Override endpoint (defaults to https://api.tushare.pro). */
  endpoint?: string;
  /** Concurrency cap to respect Tushare's per-minute quota. */
  concurrency?: number;
}

const NOT_IMPLEMENTED = (fn: string) => {
  throw new Error(
    `tushareAdapter.${fn} is not implemented. ` +
      "Wire it up against https://api.tushare.pro (api_name: daily, stock_basic, etc.). " +
      "See src/lib/data/adapters/tushareAdapter.ts.",
  );
};

export function createTushareAdapter(_config: TushareAdapterConfig): DataAdapter {
  return {
    id: "tushare",
    // TODO: implement via POST https://api.tushare.pro with api_name=daily,
    // stock_basic, index_dailybasic, etc. Apply adj_factor for forward/back
    // price adjustment, handle 停牌 by omitting bars, and surface 暂停上市 /
    // 退市整理 flags into StockMeta.
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
