// CSV importer for daily bars.
//
// Expected columns (header row required, order-independent):
//   symbol,name,date,open,high,low,close,volume,amount,turnoverRate,pctChange
//
// Numeric fields must parse as finite numbers. `date` must be YYYY-MM-DD.
// Returns parsed bars (sorted by date per symbol) plus a structured warning
// list — caller decides whether to surface them or abort.

import type { StockDailyBar } from "@/lib/types/stock";

const REQUIRED_COLUMNS = [
  "symbol",
  "name",
  "date",
  "open",
  "high",
  "low",
  "close",
  "volume",
  "amount",
  "turnoverRate",
  "pctChange",
] as const;

type Column = (typeof REQUIRED_COLUMNS)[number];

export type CsvWarningKind =
  | "MISSING_COLUMN"
  | "INVALID_NUMBER"
  | "INVALID_DATE"
  | "DUPLICATE_ROW"
  | "MISSING_TRADING_DATE"
  | "EMPTY_FILE"
  | "BAD_ROW_LENGTH";

export interface CsvWarning {
  kind: CsvWarningKind;
  symbol?: string;
  date?: string;
  line?: number;
  detail: string;
}

export interface CsvImportResult {
  /** Map symbol -> chronological bars. */
  bars: Record<string, StockDailyBar[]>;
  warnings: CsvWarning[];
  /** True if at least one CRITICAL warning (missing column / empty file). */
  hasFatalError: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseHeader(line: string): { header: Column[]; missing: Column[] } {
  const cols = line.split(",").map((c) => c.trim());
  const missing = REQUIRED_COLUMNS.filter((c) => !cols.includes(c));
  const header = cols.filter((c): c is Column =>
    (REQUIRED_COLUMNS as readonly string[]).includes(c),
  );
  return { header, missing };
}

function parseRow(
  cells: string[],
  header: Column[],
): Partial<Record<Column, string>> {
  const out: Partial<Record<Column, string>> = {};
  for (let i = 0; i < header.length; i++) {
    out[header[i]] = cells[i]?.trim() ?? "";
  }
  return out;
}

function num(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

/**
 * Detect missing trading dates between two consecutive bar dates. Mirrors
 * `mockDailyBars`'s weekday filter — for real data, weekends/holidays should
 * not be flagged. Caller may also pass a known trading calendar via
 * `expectedDates`.
 */
function detectMissingDates(
  dates: string[],
  expectedDates?: string[],
): string[] {
  if (expectedDates) {
    const present = new Set(dates);
    return expectedDates.filter((d) => !present.has(d));
  }
  // Weekday-only fallback: detect any gap > 1 weekday between adjacent rows.
  const missing: string[] = [];
  for (let i = 1; i < dates.length; i++) {
    const a = new Date(dates[i - 1] + "T00:00:00Z");
    const b = new Date(dates[i] + "T00:00:00Z");
    const cursor = new Date(a);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    while (cursor < b) {
      const day = cursor.getUTCDay();
      if (day !== 0 && day !== 6) {
        missing.push(cursor.toISOString().slice(0, 10));
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return missing;
}

export interface ImportOptions {
  /** Trading-day calendar to validate against. */
  expectedDates?: string[];
  /** Skip weekday-gap detection entirely (default false). */
  skipGapDetection?: boolean;
}

export function importDailyBarsCsv(
  text: string,
  options: ImportOptions = {},
): CsvImportResult {
  const warnings: CsvWarning[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    warnings.push({ kind: "EMPTY_FILE", detail: "CSV input is empty." });
    return { bars: {}, warnings, hasFatalError: true };
  }

  const { header, missing } = parseHeader(lines[0]);
  if (missing.length > 0) {
    warnings.push({
      kind: "MISSING_COLUMN",
      detail: `Required columns missing: ${missing.join(", ")}`,
    });
    return { bars: {}, warnings, hasFatalError: true };
  }

  const bySymbol: Record<string, StockDailyBar[]> = {};
  const seenKey = new Set<string>();

  for (let li = 1; li < lines.length; li++) {
    const cells = lines[li].split(",");
    if (cells.length !== header.length) {
      warnings.push({
        kind: "BAD_ROW_LENGTH",
        line: li + 1,
        detail: `Expected ${header.length} columns, got ${cells.length}`,
      });
      continue;
    }
    const row = parseRow(cells, header);

    const symbol = row.symbol ?? "";
    const date = row.date ?? "";
    if (!DATE_RE.test(date)) {
      warnings.push({
        kind: "INVALID_DATE",
        line: li + 1,
        symbol,
        date,
        detail: `Date "${date}" is not in YYYY-MM-DD format`,
      });
      continue;
    }

    const open = num(row.open);
    const high = num(row.high);
    const low = num(row.low);
    const close = num(row.close);
    const volume = num(row.volume);
    const amount = num(row.amount);
    const turnoverRate = num(row.turnoverRate);
    const pctChange = num(row.pctChange);

    if (
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      volume === null ||
      amount === null ||
      turnoverRate === null ||
      pctChange === null
    ) {
      warnings.push({
        kind: "INVALID_NUMBER",
        line: li + 1,
        symbol,
        date,
        detail: "One or more numeric fields are missing or non-numeric",
      });
      continue;
    }

    const key = `${symbol}|${date}`;
    if (seenKey.has(key)) {
      warnings.push({
        kind: "DUPLICATE_ROW",
        line: li + 1,
        symbol,
        date,
        detail: "Duplicate symbol+date row",
      });
      continue;
    }
    seenKey.add(key);

    const bar: StockDailyBar = {
      symbol,
      name: row.name ?? "",
      date,
      open,
      high,
      low,
      close,
      volume,
      amount,
      turnoverRate,
      pctChange,
    };
    (bySymbol[symbol] ??= []).push(bar);
  }

  // Sort each symbol by date and detect missing trading days.
  for (const sym of Object.keys(bySymbol)) {
    bySymbol[sym].sort((a, b) => a.date.localeCompare(b.date));
    if (!options.skipGapDetection) {
      const missingDates = detectMissingDates(
        bySymbol[sym].map((b) => b.date),
        options.expectedDates,
      );
      for (const d of missingDates) {
        warnings.push({
          kind: "MISSING_TRADING_DATE",
          symbol: sym,
          date: d,
          detail: `No bar for ${sym} on ${d}`,
        });
      }
    }
  }

  return { bars: bySymbol, warnings, hasFatalError: false };
}
