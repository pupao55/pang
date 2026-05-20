"use server";
import { runBacktest } from "@/lib/engine/backtestEngine";
import {
  buildDiagnostics,
  type BacktestDiagnostics,
} from "@/lib/engine/backtestDiagnostics";
import { createMockAdapter } from "@/lib/data/adapters/mockAdapter";
import { createAkshareLocalAdapter } from "@/lib/data/adapters/akshareLocalAdapter";
import { createBaostockLocalAdapter } from "@/lib/data/adapters/baostockLocalAdapter";
import { MOCK_SECTORS } from "@/lib/data/mockSectors";
import { MOCK_SENTIMENT } from "@/lib/data/mockSentiment";
import type { DataSourceId } from "@/lib/data/adapters";
import type { BacktestParams, BacktestResult } from "@/lib/types/backtest";

export interface RunBacktestResponse {
  result: BacktestResult;
  diagnostics: BacktestDiagnostics;
  /** Tells the UI which dataset and what is fallback-only. */
  dataInfo: {
    source: DataSourceId;
    symbolCount: number;
    sectorIsFallback: boolean;
    sentimentIsFallback: boolean;
    adapterWarnings: string[];
  };
}

export async function runBacktestAction(
  params: BacktestParams,
  source: DataSourceId = "mock",
): Promise<RunBacktestResponse> {
  const evalDate = MOCK_SENTIMENT.date;
  const sectorsByDate = { [evalDate]: MOCK_SECTORS };
  const sentimentByDate = { [evalDate]: MOCK_SENTIMENT };

  let metas;
  let barsBySymbol: Record<string, Awaited<ReturnType<typeof Object>>> & Record<string, never[]>;
  let dataInfo: RunBacktestResponse["dataInfo"];

  if (source === "akshareLocal" || source === "baostockLocal") {
    let adapter;
    try {
      adapter =
        source === "akshareLocal"
          ? createAkshareLocalAdapter()
          : createBaostockLocalAdapter();
    } catch (err) {
      throw new Error(
        `${source} cache unavailable. ${(err as Error).message}\n` +
          "Fall back to the MOCK source or fetch the cache first.",
      );
    }
    metas = await adapter.getStockMetas();
    const all = await adapter.getDailyBarsForUniverse(
      metas.map((m) => m.symbol),
      "1900-01-01",
      "9999-12-31",
    );
    barsBySymbol = all as never;
    dataInfo = {
      source,
      symbolCount: metas.length,
      sectorIsFallback: adapter.sectorIsFallback,
      sentimentIsFallback: adapter.sentimentIsFallback,
      adapterWarnings: adapter.warnings,
    };
  } else {
    const adapter = createMockAdapter();
    metas = await adapter.getStockMetas();
    const all = await adapter.getDailyBarsForUniverse(
      metas.map((m) => m.symbol),
      "1900-01-01",
      "9999-12-31",
    );
    barsBySymbol = all as never;
    dataInfo = {
      source: "mock",
      symbolCount: metas.length,
      sectorIsFallback: false,
      sentimentIsFallback: false,
      adapterWarnings: [],
    };
  }

  const result = runBacktest({
    ...params,
    metas,
    barsBySymbol,
    sectorsByDate,
    sentimentByDate,
  });

  const regimeByDate: Record<string, string> = {
    [evalDate]: MOCK_SENTIMENT.marketRegime,
  };
  const diagnostics = buildDiagnostics(result, regimeByDate);
  return { result, diagnostics, dataInfo };
}
