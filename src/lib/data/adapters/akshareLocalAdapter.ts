// Local-cache adapter that reads JSON files produced by scripts/akshare_fetcher.py.
//
// IMPORTANT: this adapter NEVER calls Python or the network. The web app, the
// signal engine, the backtest engine, and the validation report all consume
// only this local cache. Refresh the cache offline with:
//   npm run fetch:akshare:sample
//   npm run fetch:akshare
//
// Sector and sentiment data are still missing from AkShare in v1.2 — we fall
// back to mock snapshots and tag them with `isFallback: true` so the UI can
// warn users not to over-trust them.

import fs from "node:fs";
import path from "node:path";
import type { DataAdapter } from "./types";
import type { BoardType, StockDailyBar, StockMeta } from "@/lib/types/stock";
import type {
  MarketSentimentSnapshot,
  SectorSnapshot,
} from "@/lib/types/market";
import { MOCK_SECTORS } from "@/lib/data/mockSectors";
import { MOCK_SENTIMENT } from "@/lib/data/mockSentiment";
import { PATHS } from "@/lib/store/paths";

export interface AkshareLocalCacheStatus {
  ok: boolean;
  reason?: string;
  importReportPath: string;
  barsDir: string;
  symbolCount: number;
}

export interface AkshareImportReport {
  source: string;
  adjust: string;
  startDate: string;
  endDate: string;
  /** v1.4 schema kept for back-compat with older caches. */
  startedAt?: string;
  completedAt?: string;
  totalSymbolsRequested?: number;
  /** v1.5 schema (cumulative). */
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

export interface AkshareFetchStatusEntry {
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

export interface AkshareFetchStatus {
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
  symbols: Record<string, AkshareFetchStatusEntry>;
}

interface CachedFile {
  symbol: string;
  name: string;
  exchange: "SH" | "SZ" | "BJ";
  adjust: string;
  source: string;
  fetchedAt: string;
  startDate: string;
  endDate: string;
  barCount: number;
  bars: Partial<StockDailyBar>[];
}

/** Infer board type from the 6-digit code prefix. */
export function inferBoardType(symbol: string): { board: BoardType; warning?: string } {
  const code = symbol.slice(0, 6);
  const head = code[0];
  const head3 = code.slice(0, 3);
  if (head3 === "688" || head3 === "689") return { board: "STAR" };
  if (head === "3") return { board: "CHINEXT" };
  if (head === "8" || head === "4") {
    return {
      board: "MAIN",
      warning:
        `${symbol}: 北交所 (BJ) is not modelled as a distinct board type yet; ` +
        "boardType defaulted to MAIN, but the 30% daily limit will not be applied. " +
        "See AUDIT J-6.",
    };
  }
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
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw) as CachedFile;
}

function toStockMeta(file: CachedFile): { meta: StockMeta; warning?: string } {
  const { board, warning } = inferBoardType(file.symbol);
  return {
    meta: {
      symbol: file.symbol,
      name: file.name || file.symbol,
      exchange: file.exchange,
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
  // Defensive sort — upstream may interleave rows during retries.
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export function getAkshareLocalCacheStatus(
  baseDir = PATHS.akshareDir,
): AkshareLocalCacheStatus {
  const barsDir = path.join(baseDir, "daily-bars");
  const importReportPath = path.join(baseDir, "import-report.json");
  if (!fs.existsSync(barsDir)) {
    return {
      ok: false,
      reason: `Bars directory missing: ${barsDir}. Run npm run fetch:akshare:sample.`,
      importReportPath,
      barsDir,
      symbolCount: 0,
    };
  }
  const symbols = listCachedSymbols(barsDir);
  if (symbols.length === 0) {
    return {
      ok: false,
      reason: `No JSON files in ${barsDir}. Run npm run fetch:akshare:sample.`,
      importReportPath,
      barsDir,
      symbolCount: 0,
    };
  }
  return { ok: true, importReportPath, barsDir, symbolCount: symbols.length };
}

export function readAkshareImportReport(
  baseDir = PATHS.akshareDir,
): AkshareImportReport | null {
  const p = path.join(baseDir, "import-report.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as AkshareImportReport;
}

export function readAkshareFetchStatus(
  baseDir = PATHS.akshareDir,
): AkshareFetchStatus | null {
  const p = path.join(baseDir, "fetch-status.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as AkshareFetchStatus;
}

export type ContextSourceMode = "REAL" | "GENERATED" | "FALLBACK" | "MISSING";

export interface AkshareLocalAdapter extends DataAdapter {
  /** Filesystem warnings surfaced during initial load. */
  readonly warnings: string[];
  /** True iff sector data is the mock fallback (v1.6 may surface REAL). */
  readonly sectorIsFallback: boolean;
  /** True iff sentiment data is the mock fallback (v1.6 may surface GENERATED). */
  readonly sentimentIsFallback: boolean;
  /** Origin of stock metadata in this adapter instance. */
  readonly metadataMode: ContextSourceMode;
  /** Origin of sector data. */
  readonly sectorMode: ContextSourceMode;
  /** Origin of sentiment data. */
  readonly sentimentMode: ContextSourceMode;
  /** Source identifier used in path resolution and signal store keys. */
  readonly id: "akshareLocal";
  /** Read the import report once it has been generated. */
  importReport(): AkshareImportReport | null;
}

interface MetadataFile {
  source?: string;
  fetchedAt?: string;
  totalSymbols?: number;
  withIndustry?: number;
  warnings?: string[];
  stocks?: Array<{
    symbol: string;
    name?: string;
    exchange?: string;
    boardType?: BoardType;
    industry?: string | null;
    concepts?: string[];
    isST?: boolean;
    marketCap?: number | null;
    floatMarketCap?: number | null;
  }>;
}

interface SectorFile {
  source?: string;
  date?: string;
  fetchedAt?: string;
  warnings?: string[];
  snapshots: SectorSnapshot[];
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

function loadSectorFiles(baseDir: string): Map<string, SectorSnapshot[]> {
  const dir = path.join(baseDir, "sectors");
  const map = new Map<string, SectorSnapshot[]>();
  if (!fs.existsSync(dir)) return map;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, entry), "utf8");
      const f = JSON.parse(raw) as SectorFile;
      const date = (f.date ?? entry.replace(/\.json$/, "")).slice(0, 10);
      if (Array.isArray(f.snapshots) && f.snapshots.length > 0) {
        map.set(date, f.snapshots);
      }
    } catch {
      /* skip */
    }
  }
  return map;
}

function loadSentimentFile(
  baseDir: string,
): Map<string, MarketSentimentSnapshot> {
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

function resolveSnapshotAtOrBefore<T>(
  map: Map<string, T>,
  date: string,
): T | undefined {
  if (map.has(date)) return map.get(date);
  // Walk keys in sorted order and pick the last ≤ date.
  let chosen: T | undefined;
  for (const k of [...map.keys()].sort()) {
    if (k <= date) chosen = map.get(k);
    else break;
  }
  return chosen;
}

export function createAkshareLocalAdapter(
  baseDir = PATHS.akshareDir,
): AkshareLocalAdapter {
  const status = getAkshareLocalCacheStatus(baseDir);
  if (!status.ok) {
    throw new Error(
      `AkShare local cache not available. ${status.reason ?? ""}\n` +
        "Setup steps:\n" +
        "  1. pip install akshare --upgrade\n" +
        "  2. npm run fetch:akshare:sample:slow\n",
    );
  }

  const barsDir = status.barsDir;
  const symbols = listCachedSymbols(barsDir).sort();

  const warnings: string[] = [];
  const fileBySymbol = new Map<string, CachedFile>();
  // Seed metas from cache files (low-fi). Real-metadata pass overrides below.
  const metasBySymbol = new Map<string, StockMeta>();
  for (const sym of symbols) {
    const f = readCachedFile(barsDir, sym);
    if (!f) continue;
    fileBySymbol.set(sym, f);
    const { meta, warning } = toStockMeta(f);
    metasBySymbol.set(meta.symbol, meta);
    if (warning) warnings.push(warning);
  }

  // ---- metadata enrichment ----
  let metadataMode: ContextSourceMode = "FALLBACK";
  const metadataFile = loadMetadataFile(baseDir);
  if (metadataFile && Array.isArray(metadataFile.stocks) && metadataFile.stocks.length > 0) {
    metadataMode = "REAL";
    for (const m of metadataFile.stocks) {
      const existing = metasBySymbol.get(m.symbol);
      if (!existing) continue; // only enrich symbols we actually have bars for
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
    const enriched = metadataFile.stocks.filter((m) => m.industry).length;
    if (enriched === 0) {
      warnings.push(
        "Metadata cache present but no symbols carry industry; refetch with --with-industry.",
      );
    }
  } else {
    warnings.push(
      "No metadata cache (data/akshare/metadata/stocks.json) — boardType / industry inferred or empty.",
    );
  }

  const metas: StockMeta[] = symbols
    .map((s) => metasBySymbol.get(s))
    .filter((m): m is StockMeta => !!m);

  // ---- sector cache ----
  const sectorFiles = loadSectorFiles(baseDir);
  let sectorMode: ContextSourceMode = "MISSING";
  if (sectorFiles.size > 0) {
    sectorMode = "REAL";
  } else {
    warnings.push(
      "No sector snapshots cached (data/akshare/sectors/{date}.json); falling back to mock sectors.",
    );
  }

  // ---- sentiment cache ----
  const sentimentMap = loadSentimentFile(baseDir);
  let sentimentMode: ContextSourceMode = "MISSING";
  if (sentimentMap.size > 0) {
    sentimentMode = "GENERATED";
  } else {
    warnings.push(
      "No generated sentiment (data/akshare/sentiment/sentiment.jsonl); falling back to mock sentiment.",
    );
  }

  function getBarsAll(symbol: string): StockDailyBar[] {
    const f = fileBySymbol.get(symbol);
    return f ? toBars(f) : [];
  }
  function slice(bars: StockDailyBar[], start: string, end: string): StockDailyBar[] {
    return bars.filter((b) => b.date >= start && b.date <= end);
  }

  return {
    id: "akshareLocal",
    warnings,
    sectorIsFallback: (sectorMode as ContextSourceMode) !== "REAL",
    sentimentIsFallback:
      (sentimentMode as ContextSourceMode) !== "GENERATED" &&
      (sentimentMode as ContextSourceMode) !== "REAL",
    metadataMode,
    sectorMode,
    sentimentMode,

    importReport() {
      return readAkshareImportReport(baseDir);
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
      if (sectorMode === "REAL") {
        const found = resolveSnapshotAtOrBefore(sectorFiles, date);
        if (found && found.length > 0) return found;
      }
      return MOCK_SECTORS;
    },

    async getMarketSentiment(date): Promise<MarketSentimentSnapshot | undefined> {
      if (sentimentMode === "GENERATED") {
        const found = resolveSnapshotAtOrBefore(sentimentMap, date);
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
