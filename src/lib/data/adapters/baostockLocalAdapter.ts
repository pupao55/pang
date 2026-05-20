// BaoStock local-cache adapter (v1.7).
//
// Reads JSON files written by scripts/baostock_fetcher.py. Mirrors the
// akshareLocalAdapter shape so engines/UI can read either provider behind
// the same DataAdapter interface. Sector/metadata cached files are optional
// (BaoStock free tier only reliably gives daily bars + adjustment factors).
// Sentiment can be regenerated locally via build_sentiment.

import fs from "node:fs";
import path from "node:path";
import type { DataAdapter } from "./types";
import type {
  ContextSourceMode,
} from "./akshareLocalAdapter";
import type { BoardType, StockDailyBar, StockMeta } from "@/lib/types/stock";
import type {
  MarketSentimentSnapshot,
  SectorSnapshot,
} from "@/lib/types/market";
import { MOCK_SECTORS } from "@/lib/data/mockSectors";
import { MOCK_SENTIMENT } from "@/lib/data/mockSentiment";
import { PATHS } from "@/lib/store/paths";

/* -------------------- shared types -------------------- */

export interface BaostockCacheStatus {
  ok: boolean;
  reason?: string;
  barsDir: string;
  symbolCount: number;
}

export interface BaostockImportReport {
  source: string;
  adjust: string;
  startDate: string;
  endDate: string;
  lastUpdatedAt?: string;
  totalSymbolsKnown?: number;
  totalSymbolsSucceeded: number;
  totalSymbolsFailed: number;
  totalSymbolsEmpty?: number;
  totalRows: number;
  dateRange?: { start: string; end: string };
  failedSymbols: { symbol: string; error: string }[];
  warnings: string[];
}

export interface BaostockFetchStatusEntry {
  symbol: string;
  name?: string;
  status: "SUCCESS" | "FAILED" | "EMPTY_DATA" | "SCHEMA_ERROR" | "INVALID_SYMBOL" | "SKIPPED";
  rows: number;
  firstDate?: string;
  lastDate?: string;
  attemptCount: number;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string | null;
}

export interface BaostockFetchStatus {
  source: string;
  adjust: string;
  startDate: string;
  endDate: string;
  updatedAt: string;
  totalSymbols: number;
  succeeded: number;
  failed: number;
  empty: number;
  skipped: number;
  symbols: Record<string, BaostockFetchStatusEntry>;
}

interface CachedFile {
  symbol: string;
  name?: string;
  exchange?: "SH" | "SZ" | "BJ";
  adjust?: string;
  source?: string;
  fetchedAt?: string;
  startDate?: string;
  endDate?: string;
  barCount?: number;
  bars: Partial<StockDailyBar>[];
}

export interface BaostockLocalAdapter extends DataAdapter {
  readonly id: "baostockLocal";
  readonly warnings: string[];
  readonly sectorIsFallback: boolean;
  readonly sentimentIsFallback: boolean;
  readonly metadataMode: ContextSourceMode;
  readonly sectorMode: ContextSourceMode;
  readonly sentimentMode: ContextSourceMode;
  importReport(): BaostockImportReport | null;
}

/* -------------------- helpers -------------------- */

function inferBoard(symbol: string): { board: BoardType; warning?: string } {
  const code = symbol.slice(0, 6);
  const head = code[0];
  const head3 = code.slice(0, 3);
  if (head3 === "688" || head3 === "689") return { board: "STAR" };
  if (head === "3") return { board: "CHINEXT" };
  if (head === "8" || head === "4")
    return {
      board: "MAIN",
      warning: `${symbol}: 北交所 (BJ) defaulted to MAIN — 30% daily limit not modelled.`,
    };
  return { board: "MAIN" };
}

function listCachedSymbols(barsDir: string): string[] {
  if (!fs.existsSync(barsDir)) return [];
  return fs
    .readdirSync(barsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

function readCachedFile(barsDir: string, symbol: string): CachedFile | null {
  const p = path.join(barsDir, `${symbol}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as CachedFile;
  } catch {
    return null;
  }
}

function toStockMeta(file: CachedFile): { meta: StockMeta; warning?: string } {
  const { board, warning } = inferBoard(file.symbol);
  return {
    meta: {
      symbol: file.symbol,
      name: file.name || file.symbol,
      exchange: file.exchange ?? "SZ",
      boardType: board,
      industry: "",
      concepts: [],
      isST: false,
      marketCap: 0,
      floatMarketCap: 0,
    },
    warning,
  };
}

function toBars(file: CachedFile): StockDailyBar[] {
  const out: StockDailyBar[] = [];
  for (const b of file.bars) {
    if (!b.date) continue;
    out.push({
      symbol: file.symbol,
      name: file.name || file.symbol,
      date: String(b.date).slice(0, 10),
      open: Number(b.open ?? 0),
      high: Number(b.high ?? 0),
      low: Number(b.low ?? 0),
      close: Number(b.close ?? 0),
      volume: Number(b.volume ?? 0),
      amount: Number(b.amount ?? 0),
      turnoverRate: Number(b.turnoverRate ?? 0),
      pctChange: Number(b.pctChange ?? 0),
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

function loadSentimentFile(baseDir: string): Map<string, MarketSentimentSnapshot> {
  const p = path.join(baseDir, "sentiment", "sentiment.jsonl");
  const map = new Map<string, MarketSentimentSnapshot>();
  if (!fs.existsSync(p)) return map;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      const obj = JSON.parse(s) as MarketSentimentSnapshot;
      if (obj.date) map.set(obj.date, obj);
    } catch {
      /* skip */
    }
  }
  return map;
}

interface SectorFile {
  date?: string;
  source?: string;
  snapshots: SectorSnapshot[];
}

interface SectorLoadResult {
  byDate: Map<string, SectorSnapshot[]>;
  /** True when at least one file declares source = "localSectorBuilder". */
  hasGenerated: boolean;
  /** True when at least one file declares source != localSectorBuilder. */
  hasReal: boolean;
}

function loadSectorFiles(baseDir: string): SectorLoadResult {
  const dir = path.join(baseDir, "sectors");
  const byDate = new Map<string, SectorSnapshot[]>();
  let hasGenerated = false;
  let hasReal = false;
  if (!fs.existsSync(dir)) return { byDate, hasGenerated, hasReal };
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, entry), "utf8");
      const f = JSON.parse(raw) as SectorFile;
      const date = (f.date ?? entry.replace(/\.json$/, "")).slice(0, 10);
      if (Array.isArray(f.snapshots) && f.snapshots.length > 0) {
        byDate.set(date, f.snapshots);
        if (f.source === "localSectorBuilder") hasGenerated = true;
        else hasReal = true;
      }
    } catch {
      /* skip */
    }
  }
  return { byDate, hasGenerated, hasReal };
}

interface MetadataStock {
  symbol: string;
  name?: string;
  industry?: string;
  industrySource?: string;
  syntheticBoardGroup?: string;
  syntheticPrefixGroup?: string;
  boardType?: BoardType;
  isST?: boolean;
  marketCap?: number;
  floatMarketCap?: number;
  concepts?: string[];
}

interface MetadataFile {
  source?: string;
  totalSymbols?: number;
  withIndustry?: number;
  warnings?: string[];
  stocks?: MetadataStock[];
}

function loadMetadataFile(baseDir: string): MetadataFile | null {
  const p = path.join(baseDir, "metadata", "stocks.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as MetadataFile;
  } catch {
    return null;
  }
}

function resolveAtOrBefore<T>(map: Map<string, T>, date: string): T | undefined {
  if (map.has(date)) return map.get(date);
  let chosen: T | undefined;
  for (const k of [...map.keys()].sort()) {
    if (k <= date) chosen = map.get(k);
    else break;
  }
  return chosen;
}

/* -------------------- public API -------------------- */

export function getBaostockLocalCacheStatus(
  baseDir = PATHS.baostockDir,
): BaostockCacheStatus {
  const barsDir = path.join(baseDir, "daily-bars");
  if (!fs.existsSync(barsDir)) {
    return {
      ok: false,
      reason: `Bars directory missing: ${barsDir}. Run npm run fetch:baostock:sample.`,
      barsDir,
      symbolCount: 0,
    };
  }
  const symbols = listCachedSymbols(barsDir);
  if (symbols.length === 0) {
    return {
      ok: false,
      reason: `No JSON files in ${barsDir}. Run npm run fetch:baostock:sample.`,
      barsDir,
      symbolCount: 0,
    };
  }
  return { ok: true, barsDir, symbolCount: symbols.length };
}

export function readBaostockImportReport(
  baseDir = PATHS.baostockDir,
): BaostockImportReport | null {
  const p = path.join(baseDir, "import-report.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as BaostockImportReport;
}

export function readBaostockFetchStatus(
  baseDir = PATHS.baostockDir,
): BaostockFetchStatus | null {
  const p = path.join(baseDir, "fetch-status.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as BaostockFetchStatus;
}

export function createBaostockLocalAdapter(
  baseDir = PATHS.baostockDir,
): BaostockLocalAdapter {
  const status = getBaostockLocalCacheStatus(baseDir);
  if (!status.ok) {
    throw new Error(
      `BaoStock local cache not available. ${status.reason ?? ""}\n` +
        "Setup steps:\n" +
        "  1. npm run setup:baostock        # pip install baostock pandas\n" +
        "  2. npm run fetch:baostock:sample\n",
    );
  }

  const barsDir = status.barsDir;
  const symbols = listCachedSymbols(barsDir).sort();
  const warnings: string[] = [];
  const fileBySymbol = new Map<string, CachedFile>();
  const metasBySymbol = new Map<string, StockMeta>();
  for (const sym of symbols) {
    const f = readCachedFile(barsDir, sym);
    if (!f) continue;
    fileBySymbol.set(sym, f);
    const { meta, warning } = toStockMeta(f);
    metasBySymbol.set(meta.symbol, meta);
    if (warning) warnings.push(warning);
  }

  // ---- metadata (v1.8): real when stocks.json is present + non-empty ----
  const metadataFile = loadMetadataFile(baseDir);
  let metadataMode: ContextSourceMode;
  if (metadataFile && Array.isArray(metadataFile.stocks) && metadataFile.stocks.length > 0) {
    metadataMode = "REAL";
    for (const m of metadataFile.stocks) {
      const existing = metasBySymbol.get(m.symbol);
      if (!existing) continue;
      metasBySymbol.set(m.symbol, {
        ...existing,
        name: m.name || existing.name,
        boardType: (m.boardType as BoardType) ?? existing.boardType,
        industry: m.industry ?? existing.industry,
        concepts: Array.isArray(m.concepts) ? m.concepts : existing.concepts,
        isST: m.isST ?? existing.isST,
        marketCap: m.marketCap ?? existing.marketCap,
        floatMarketCap: m.floatMarketCap ?? existing.floatMarketCap,
      });
    }
    const withIndustry = (metadataFile.withIndustry ?? 0);
    if (withIndustry === 0) {
      warnings.push(
        "metadata/stocks.json has zero industry hits — sector grouping will rely on synthetic BOARD_*/PREFIX_* fallback only.",
      );
    }
  } else {
    metadataMode = "FALLBACK";
    warnings.push(
      "BaoStock metadata cache missing (data/baostock/metadata/stocks.json) — sector grouping will be synthetic-only. Run `npm run fetch:baostock:metadata`.",
    );
  }

  // ---- sectors (v1.8): REAL or GENERATED based on the file's source tag ----
  const sectorLoad = loadSectorFiles(baseDir);
  let sectorMode: ContextSourceMode;
  if (sectorLoad.hasReal && !sectorLoad.hasGenerated) sectorMode = "REAL";
  else if (sectorLoad.byDate.size > 0) sectorMode = "GENERATED";
  else {
    sectorMode = "MISSING";
    warnings.push(
      "No sector snapshots cached (data/baostock/sectors/{date}.json); run `npm run build:sectors:baostock` to generate from the local universe.",
    );
  }

  const sentimentMap = loadSentimentFile(baseDir);
  let sentimentMode: ContextSourceMode = "MISSING";
  if (sentimentMap.size > 0) sentimentMode = "GENERATED";
  else
    warnings.push(
      "No generated sentiment (data/baostock/sentiment/sentiment.jsonl); run `npm run build:sentiment -- --source baostockLocal`.",
    );

  const metas: StockMeta[] = symbols
    .map((s) => metasBySymbol.get(s))
    .filter((m): m is StockMeta => !!m);

  function getBarsAll(symbol: string): StockDailyBar[] {
    const f = fileBySymbol.get(symbol);
    return f ? toBars(f) : [];
  }
  function slice(bars: StockDailyBar[], start: string, end: string): StockDailyBar[] {
    return bars.filter((b) => b.date >= start && b.date <= end);
  }

  return {
    id: "baostockLocal",
    warnings,
    // v1.8: GENERATED sectors are NOT fallback — they're real (just locally
    // computed). Only MISSING or FALLBACK should be treated as fallback.
    sectorIsFallback:
      (sectorMode as ContextSourceMode) !== "REAL" &&
      (sectorMode as ContextSourceMode) !== "GENERATED",
    sentimentIsFallback:
      (sentimentMode as ContextSourceMode) !== "GENERATED" &&
      (sentimentMode as ContextSourceMode) !== "REAL",
    metadataMode,
    sectorMode,
    sentimentMode,

    importReport() {
      return readBaostockImportReport(baseDir);
    },

    async getStockMetas() {
      return metas;
    },

    async getDailyBars(symbol, startDate, endDate) {
      return slice(getBarsAll(symbol), startDate, endDate);
    },

    async getDailyBarsForUniverse(syms, startDate, endDate) {
      const out: Record<string, StockDailyBar[]> = {};
      for (const s of syms) out[s] = slice(getBarsAll(s), startDate, endDate);
      return out;
    },

    async getSectorSnapshots(date): Promise<SectorSnapshot[]> {
      // v1.8: serve REAL or GENERATED snapshots from the cache; only fall back
      // to mock when nothing local is available, and only with an explicit
      // caveat (see sectorIsFallback / sectorMode on the adapter).
      if (sectorMode === "REAL" || sectorMode === "GENERATED") {
        const found = resolveAtOrBefore(sectorLoad.byDate, date);
        if (found && found.length > 0) return found;
      }
      return MOCK_SECTORS;
    },

    async getMarketSentiment(date): Promise<MarketSentimentSnapshot | undefined> {
      if (sentimentMode === "GENERATED") {
        const found = resolveAtOrBefore(sentimentMap, date);
        if (found) return found;
      }
      return MOCK_SENTIMENT;
    },

    async getTradingCalendar(startDate, endDate) {
      const all = new Set<string>();
      for (const f of fileBySymbol.values()) {
        for (const b of f.bars) {
          const d = String(b.date ?? "").slice(0, 10);
          if (d) all.add(d);
        }
      }
      return Array.from(all)
        .sort()
        .filter((d) => d >= startDate && d <= endDate);
    },
  };
}
