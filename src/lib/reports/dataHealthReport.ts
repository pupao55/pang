// Data-health checks on the local AkShare JSON cache (v1.5).
//
// v1.5 changes:
//   * Real Chinese trading calendar (data/akshare/trading-calendar.json) is
//     consulted when present. Missing-date warnings only fire for dates that
//     actually were trading days. If the calendar is absent, the weekday
//     heuristic still runs but the kind is demoted to INFO and a top-level
//     warning notes "calendar unavailable".
//   * Each warning carries an ERROR / WARNING / INFO severity.
//   * New checks: STALE_LAST_DATE, INCOMPLETE_LATEST_DATE, LOW_COVERAGE_RATIO.
//   * Top-level report carries calendarSource, expectedTradingDays,
//     coverageRatio, missingTradingDates count.
//
// Pure function inputs/outputs; the CLI wrapper handles filesystem IO.

import { inferBoardType } from "@/lib/data/adapters/akshareLocalAdapter";
import type { BoardType, StockDailyBar } from "@/lib/types/stock";

export interface CachedSymbolFile {
  symbol: string;
  name?: string;
  exchange?: string;
  adjust?: string;
  source?: string;
  fetchedAt?: string;
  startDate?: string;
  endDate?: string;
  barCount?: number;
  bars: StockDailyBar[];
}

export interface TradingCalendar {
  source: string;
  fetchedAt: string;
  startDate?: string;
  endDate?: string;
  dates: string[];
}

export type DataHealthSeverity = "ERROR" | "WARNING" | "INFO";

export type DataHealthWarningKind =
  | "DUPLICATE_DATE"
  | "MISSING_TRADING_DATE"
  | "MISSING_WEEKDAY"
  | "IMPOSSIBLE_OHLC"
  | "ZERO_VOLUME"
  | "ABNORMAL_PCT_CHANGE"
  | "SHORT_HISTORY"
  | "BAD_BOARD_FALLBACK"
  | "ADJUST_MISSING"
  | "EMPTY_FILE"
  | "STALE_LAST_DATE"
  | "INCOMPLETE_LATEST_DATE"
  | "LOW_COVERAGE_RATIO";

export interface DataHealthWarning {
  kind: DataHealthWarningKind;
  severity: DataHealthSeverity;
  symbol: string;
  date?: string;
  detail: string;
}

export interface PerSymbolHealth {
  symbol: string;
  boardType: BoardType;
  barCount: number;
  startDate: string;
  endDate: string;
  /** barCount / expectedTradingDays clamped to [0, 1]; NaN if no calendar. */
  coverageRatio: number;
  zeroVolumeBars: number;
  duplicateDateBars: number;
  abnormalPctChangeBars: number;
  impossibleOhlcBars: number;
  warnings: DataHealthWarning[];
}

export interface DataHealthReport {
  symbolCount: number;
  totalBars: number;
  dateRange: { start: string; end: string };
  calendarSource: string;
  /** Trading days present in calendar within the cache's date range. */
  expectedTradingDays: number;
  /** Universe-wide coverage ratio = total bars / (symbols × expectedTradingDays). */
  coverageRatio: number;
  perSymbol: PerSymbolHealth[];
  warningCounts: Partial<Record<DataHealthWarningKind, number>>;
  severityCounts: Record<DataHealthSeverity, number>;
  warnings: DataHealthWarning[];
  /** Top-level notices (calendar missing, etc.). */
  notices: string[];
}

/* -------------------- thresholds -------------------- */

export const SHORT_HISTORY_THRESHOLD = 60;
export const ABNORMAL_PCT_CHANGE_THRESHOLD = 22;
/** A symbol whose last bar is older than this many calendar days is stale. */
export const STALE_LAST_DATE_THRESHOLD_DAYS = 14;
/** Symbols with coverage below this fraction get LOW_COVERAGE_RATIO. */
export const MIN_COVERAGE_RATIO = 0.6;

const SEVERITY_BY_KIND: Record<DataHealthWarningKind, DataHealthSeverity> = {
  DUPLICATE_DATE: "ERROR",
  IMPOSSIBLE_OHLC: "ERROR",
  EMPTY_FILE: "ERROR",
  ZERO_VOLUME: "WARNING",
  ABNORMAL_PCT_CHANGE: "WARNING",
  SHORT_HISTORY: "WARNING",
  STALE_LAST_DATE: "WARNING",
  INCOMPLETE_LATEST_DATE: "WARNING",
  LOW_COVERAGE_RATIO: "WARNING",
  ADJUST_MISSING: "WARNING",
  BAD_BOARD_FALLBACK: "INFO",
  MISSING_TRADING_DATE: "WARNING",
  MISSING_WEEKDAY: "INFO", // weekday heuristic — demoted vs calendar match
};

/* -------------------- helpers -------------------- */

function* weekdaysBetween(a: string, b: string): Generator<string> {
  const cur = new Date(a + "T00:00:00Z");
  cur.setUTCDate(cur.getUTCDate() + 1);
  const end = new Date(b + "T00:00:00Z");
  while (cur < end) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) yield cur.toISOString().slice(0, 10);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

function safeBoard(symbol: string): { board: BoardType; warning?: string } {
  try {
    return inferBoardType(symbol);
  } catch {
    return {
      board: "MAIN",
      warning: `${symbol}: could not infer board type, defaulting to MAIN.`,
    };
  }
}

function warn(
  kind: DataHealthWarningKind,
  symbol: string,
  detail: string,
  date?: string,
): DataHealthWarning {
  return { kind, severity: SEVERITY_BY_KIND[kind], symbol, date, detail };
}

function buildCalendarLookup(calendar: TradingCalendar | undefined): {
  set: Set<string> | null;
  range: { start: string; end: string } | null;
} {
  if (!calendar || !calendar.dates || calendar.dates.length === 0) {
    return { set: null, range: null };
  }
  const set = new Set(calendar.dates);
  const sorted = [...calendar.dates].sort();
  return { set, range: { start: sorted[0], end: sorted[sorted.length - 1] } };
}

function expectedDaysBetween(
  calendarSet: Set<string> | null,
  start: string,
  end: string,
): number {
  if (!calendarSet) {
    // weekday count fallback
    let n = 0;
    const cur = new Date(start + "T00:00:00Z");
    const stop = new Date(end + "T00:00:00Z");
    while (cur <= stop) {
      const d = cur.getUTCDay();
      if (d !== 0 && d !== 6) n += 1;
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return n;
  }
  let n = 0;
  for (const d of calendarSet) if (d >= start && d <= end) n += 1;
  return n;
}

function calendarDatesBetween(
  calendarSet: Set<string>,
  start: string,
  end: string,
): string[] {
  const out: string[] = [];
  for (const d of calendarSet) if (d > start && d < end) out.push(d);
  return out.sort();
}

function checkOne(
  file: CachedSymbolFile,
  options: {
    maxMissingDateWarnings: number;
    calendarSet: Set<string> | null;
    calendarRange: { start: string; end: string } | null;
    today: string;
  },
): PerSymbolHealth {
  const warnings: DataHealthWarning[] = [];
  const { board, warning: boardWarning } = safeBoard(file.symbol);
  if (boardWarning) {
    warnings.push(warn("BAD_BOARD_FALLBACK", file.symbol, boardWarning));
  }
  if (!file.adjust) {
    warnings.push(
      warn(
        "ADJUST_MISSING",
        file.symbol,
        "No `adjust` field on cache; cannot verify qfq/hfq application.",
      ),
    );
  }

  const bars = file.bars;
  if (bars.length === 0) {
    warnings.push(warn("EMPTY_FILE", file.symbol, "Cached file has no bars."));
    return {
      symbol: file.symbol,
      boardType: board,
      barCount: 0,
      startDate: "—",
      endDate: "—",
      coverageRatio: NaN,
      zeroVolumeBars: 0,
      duplicateDateBars: 0,
      abnormalPctChangeBars: 0,
      impossibleOhlcBars: 0,
      warnings,
    };
  }

  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const startDate = sorted[0].date;
  const endDate = sorted[sorted.length - 1].date;

  if (sorted.length < SHORT_HISTORY_THRESHOLD) {
    warnings.push(
      warn(
        "SHORT_HISTORY",
        file.symbol,
        `Only ${sorted.length} bars (< ${SHORT_HISTORY_THRESHOLD}); too short to draw conclusions.`,
      ),
    );
  }

  const expected = expectedDaysBetween(options.calendarSet, startDate, endDate);
  const coverage = expected > 0 ? Math.min(1, sorted.length / expected) : NaN;
  if (!Number.isNaN(coverage) && coverage < MIN_COVERAGE_RATIO) {
    warnings.push(
      warn(
        "LOW_COVERAGE_RATIO",
        file.symbol,
        `Only ${(coverage * 100).toFixed(1)}% of expected trading days covered (${sorted.length}/${expected}).`,
      ),
    );
  }

  // STALE_LAST_DATE — compare last bar date to today.
  const daysFromToday = Math.floor(
    (Date.parse(options.today) - Date.parse(endDate)) / 86_400_000,
  );
  if (daysFromToday > STALE_LAST_DATE_THRESHOLD_DAYS) {
    warnings.push(
      warn(
        "STALE_LAST_DATE",
        file.symbol,
        `Last bar ${endDate} is ${daysFromToday} days old.`,
        endDate,
      ),
    );
  }

  // INCOMPLETE_LATEST_DATE — when calendar exists and the cache's lastDate is
  // not the latest calendar trading day inside the cache range.
  if (options.calendarSet && options.calendarRange) {
    const cap = options.calendarRange.end <= endDate ? options.calendarRange.end : endDate;
    if (options.calendarSet.has(options.calendarRange.end) && endDate < options.calendarRange.end) {
      warnings.push(
        warn(
          "INCOMPLETE_LATEST_DATE",
          file.symbol,
          `Last cached bar ${endDate} < latest calendar trading day ${options.calendarRange.end}.`,
          options.calendarRange.end,
        ),
      );
    }
    void cap;
  }

  let zero = 0;
  let dup = 0;
  let abnormal = 0;
  let impossible = 0;
  const seen = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    if (seen.has(b.date)) {
      dup += 1;
      warnings.push(
        warn(
          "DUPLICATE_DATE",
          file.symbol,
          "Same date appears more than once in the cache.",
          b.date,
        ),
      );
    }
    seen.add(b.date);

    if (b.volume === 0) {
      zero += 1;
      warnings.push(
        warn(
          "ZERO_VOLUME",
          file.symbol,
          "Zero volume — likely a 停牌 (suspension) day or upstream data gap.",
          b.date,
        ),
      );
    }

    if (
      b.low > b.high ||
      b.close < b.low ||
      b.close > b.high ||
      b.open < b.low ||
      b.open > b.high ||
      b.open <= 0 ||
      b.close <= 0 ||
      b.high <= 0 ||
      b.low <= 0
    ) {
      impossible += 1;
      warnings.push(
        warn(
          "IMPOSSIBLE_OHLC",
          file.symbol,
          `OHLC=${b.open}/${b.high}/${b.low}/${b.close} violates ordering or positivity.`,
          b.date,
        ),
      );
    }

    if (Math.abs(b.pctChange) > ABNORMAL_PCT_CHANGE_THRESHOLD) {
      abnormal += 1;
      warnings.push(
        warn(
          "ABNORMAL_PCT_CHANGE",
          file.symbol,
          `pctChange=${b.pctChange.toFixed(2)}% exceeds ±${ABNORMAL_PCT_CHANGE_THRESHOLD}% threshold.`,
          b.date,
        ),
      );
    }

    if (i > 0) {
      const prev = sorted[i - 1].date;
      const cur = b.date;
      let missCount = 0;
      if (options.calendarSet) {
        const missing = calendarDatesBetween(options.calendarSet, prev, cur);
        for (const m of missing) {
          if (missCount >= options.maxMissingDateWarnings) break;
          warnings.push(
            warn(
              "MISSING_TRADING_DATE",
              file.symbol,
              `No bar for ${file.symbol} on trading day ${m}.`,
              m,
            ),
          );
          missCount += 1;
        }
      } else {
        for (const m of weekdaysBetween(prev, cur)) {
          if (missCount >= options.maxMissingDateWarnings) break;
          warnings.push(
            warn(
              "MISSING_WEEKDAY",
              file.symbol,
              `No bar for ${file.symbol} on weekday ${m}; trading calendar unavailable so this may be a holiday or a real gap.`,
              m,
            ),
          );
          missCount += 1;
        }
      }
    }
  }

  return {
    symbol: file.symbol,
    boardType: board,
    barCount: sorted.length,
    startDate,
    endDate,
    coverageRatio: coverage,
    zeroVolumeBars: zero,
    duplicateDateBars: dup,
    abnormalPctChangeBars: abnormal,
    impossibleOhlcBars: impossible,
    warnings,
  };
}

export interface BuildDataHealthReportOptions {
  maxMissingDateWarnings?: number;
  maxTotalWarnings?: number;
  calendar?: TradingCalendar;
  /** ISO date (YYYY-MM-DD). Defaults to "now". */
  today?: string;
}

export function buildDataHealthReport(
  files: CachedSymbolFile[],
  options: BuildDataHealthReportOptions = {},
): DataHealthReport {
  const maxMissing = options.maxMissingDateWarnings ?? 5;
  const maxTotal = options.maxTotalWarnings ?? 500;
  const { set: calendarSet, range: calendarRange } = buildCalendarLookup(
    options.calendar,
  );
  const today = options.today ?? new Date().toISOString().slice(0, 10);

  const perSymbol: PerSymbolHealth[] = files.map((f) =>
    checkOne(f, {
      maxMissingDateWarnings: maxMissing,
      calendarSet,
      calendarRange,
      today,
    }),
  );

  const warningCounts: Partial<Record<DataHealthWarningKind, number>> = {};
  const severityCounts: Record<DataHealthSeverity, number> = {
    ERROR: 0,
    WARNING: 0,
    INFO: 0,
  };
  const allWarnings: DataHealthWarning[] = [];
  for (const s of perSymbol) {
    for (const w of s.warnings) {
      warningCounts[w.kind] = (warningCounts[w.kind] ?? 0) + 1;
      severityCounts[w.severity] += 1;
      if (allWarnings.length < maxTotal) allWarnings.push(w);
    }
  }

  let start = "9999-99-99";
  let end = "0000-00-00";
  let totalBars = 0;
  for (const s of perSymbol) {
    if (s.barCount === 0) continue;
    if (s.startDate < start) start = s.startDate;
    if (s.endDate > end) end = s.endDate;
    totalBars += s.barCount;
  }
  if (totalBars === 0) {
    start = "—";
    end = "—";
  }

  const expectedTradingDays =
    totalBars > 0 ? expectedDaysBetween(calendarSet, start, end) : 0;
  const coverageRatio =
    expectedTradingDays > 0 && perSymbol.length > 0
      ? +Math.min(
          1,
          totalBars / (perSymbol.filter((p) => p.barCount > 0).length * expectedTradingDays),
        ).toFixed(3)
      : NaN;

  const notices: string[] = [];
  if (!calendarSet) {
    notices.push(
      "Trading calendar unavailable (data/akshare/trading-calendar.json missing). " +
        "MISSING_WEEKDAY warnings are best-effort weekday heuristics and may misfire on holidays. " +
        "Run `npm run fetch:calendar` to populate the real A-share calendar.",
    );
  }

  return {
    symbolCount: perSymbol.length,
    totalBars,
    dateRange: { start, end },
    calendarSource: options.calendar ? options.calendar.source : "weekday-heuristic",
    expectedTradingDays,
    coverageRatio,
    perSymbol,
    warningCounts,
    severityCounts,
    warnings: allWarnings,
    notices,
  };
}

/* -------------------- markdown rendering -------------------- */

function severityBadge(s: DataHealthSeverity): string {
  return s === "ERROR" ? "🛑 ERROR" : s === "WARNING" ? "⚠️ WARN" : "ℹ️ INFO";
}

export function renderDataHealthReportMarkdown(
  r: DataHealthReport,
  meta: { source: string; generatedAt: string; cachePath: string },
): string {
  const lines: string[] = [];
  lines.push(`# Pangzi data-health report — ${meta.source}`);
  lines.push("");
  lines.push(`Generated ${meta.generatedAt}.`);
  lines.push(`Cache scanned: \`${meta.cachePath}\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Symbols: ${r.symbolCount}`);
  lines.push(`- Total bars: ${r.totalBars.toLocaleString()}`);
  lines.push(`- Date range: ${r.dateRange.start} → ${r.dateRange.end}`);
  lines.push(`- Calendar source: \`${r.calendarSource}\``);
  lines.push(
    `- Expected trading days in range: ${
      r.expectedTradingDays > 0 ? r.expectedTradingDays : "—"
    }`,
  );
  if (!Number.isNaN(r.coverageRatio)) {
    lines.push(
      `- Universe coverage: **${(r.coverageRatio * 100).toFixed(1)}%** of expected bars`,
    );
  }
  lines.push(
    `- Severity counts: ERROR=${r.severityCounts.ERROR} · WARNING=${r.severityCounts.WARNING} · INFO=${r.severityCounts.INFO}`,
  );
  lines.push("");

  if (r.notices.length > 0) {
    lines.push("## Notices");
    lines.push("");
    for (const n of r.notices) lines.push(`- ${n}`);
    lines.push("");
  }

  if (Object.keys(r.warningCounts).length === 0) {
    lines.push("_No data-health warnings — cache looks structurally clean._");
  } else {
    lines.push("| Warning kind | Count | Severity |");
    lines.push("|---|---:|---|");
    for (const [kind, count] of Object.entries(r.warningCounts).sort(
      (a, b) => (b[1] ?? 0) - (a[1] ?? 0),
    )) {
      const sev = SEVERITY_BY_KIND[kind as DataHealthWarningKind];
      lines.push(`| ${kind} | ${count} | ${severityBadge(sev)} |`);
    }
  }
  lines.push("");

  lines.push("## Per-symbol summary");
  lines.push("");
  lines.push(
    "| Symbol | Board | N bars | Range | Coverage | Zero-vol | Dup | Abn pct | Bad OHLC | Warnings |",
  );
  lines.push("|---|---|---:|---|---:|---:|---:|---:|---:|---:|");
  for (const s of r.perSymbol) {
    const cov = Number.isNaN(s.coverageRatio) ? "—" : `${(s.coverageRatio * 100).toFixed(1)}%`;
    lines.push(
      `| ${s.symbol} | ${s.boardType} | ${s.barCount} | ${s.startDate} → ${s.endDate} | ${cov} | ${s.zeroVolumeBars} | ${s.duplicateDateBars} | ${s.abnormalPctChangeBars} | ${s.impossibleOhlcBars} | ${s.warnings.length} |`,
    );
  }
  lines.push("");

  if (r.warnings.length > 0) {
    lines.push("## Warnings (first 100)");
    lines.push("");
    lines.push("| Symbol | Date | Severity | Kind | Detail |");
    lines.push("|---|---|---|---|---|");
    for (const w of r.warnings.slice(0, 100)) {
      lines.push(
        `| ${w.symbol} | ${w.date ?? "—"} | ${severityBadge(w.severity)} | ${w.kind} | ${w.detail.replace(/\|/g, "\\|")} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Notes");
  lines.push("");
  lines.push(
    "- `MISSING_TRADING_DATE` (WARNING) fires only when the trading calendar confirms the gap is a real trading day. " +
      "`MISSING_WEEKDAY` (INFO) is the heuristic fallback used when the calendar is absent.",
  );
  lines.push(
    "- `ZERO_VOLUME` typically indicates a 停牌 (suspension) bar surviving in the cache; strategies should " +
      "explicitly exclude these rather than rely on the row being absent.",
  );
  lines.push(
    "- `ABNORMAL_PCT_CHANGE` thresholds match the 20cm STAR/ChiNext daily limit with a small tolerance; an entry here " +
      "suggests either a 30% BJ symbol (see `BAD_BOARD_FALLBACK`) or a stale-data spike.",
  );

  return lines.join("\n");
}
