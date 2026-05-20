import { describe, expect, it } from "vitest";
import {
  ABNORMAL_PCT_CHANGE_THRESHOLD,
  SHORT_HISTORY_THRESHOLD,
  buildDataHealthReport,
  renderDataHealthReportMarkdown,
  type CachedSymbolFile,
} from "@/lib/reports/dataHealthReport";
import type { StockDailyBar } from "@/lib/types/stock";

function bar(
  symbol: string,
  date: string,
  override: Partial<StockDailyBar> = {},
): StockDailyBar {
  return {
    symbol,
    name: symbol,
    date,
    open: 10,
    high: 11,
    low: 9,
    close: 10.5,
    volume: 1000,
    amount: 10500,
    turnoverRate: 1,
    pctChange: 0,
    ...override,
  };
}

function file(symbol: string, bars: StockDailyBar[], adjust = "qfq"): CachedSymbolFile {
  return {
    symbol,
    name: symbol,
    adjust,
    barCount: bars.length,
    bars,
  };
}

describe("buildDataHealthReport", () => {
  it("flags duplicate date rows", () => {
    const files = [
      file("300750.SZ", [bar("300750.SZ", "2024-01-02"), bar("300750.SZ", "2024-01-02")]),
    ];
    const r = buildDataHealthReport(files);
    expect(r.warningCounts.DUPLICATE_DATE).toBe(1);
    expect(r.perSymbol[0].duplicateDateBars).toBe(1);
  });

  it("flags missing weekday gaps (capped per pair)", () => {
    // 2024-01-02 Tue, 2024-01-05 Fri — 03 Wed + 04 Thu missing
    const files = [
      file("300750.SZ", [bar("300750.SZ", "2024-01-02"), bar("300750.SZ", "2024-01-05")]),
    ];
    const r = buildDataHealthReport(files);
    expect((r.warningCounts.MISSING_WEEKDAY ?? 0)).toBeGreaterThanOrEqual(2);
  });

  it("flags impossible OHLC (close above high)", () => {
    const files = [
      file("300750.SZ", [bar("300750.SZ", "2024-01-02", { high: 11, close: 12 })]),
    ];
    const r = buildDataHealthReport(files);
    expect(r.warningCounts.IMPOSSIBLE_OHLC).toBe(1);
    expect(r.perSymbol[0].impossibleOhlcBars).toBe(1);
  });

  it("flags zero-volume bars (likely 停牌)", () => {
    const files = [
      file("300750.SZ", [bar("300750.SZ", "2024-01-02", { volume: 0 })]),
    ];
    const r = buildDataHealthReport(files);
    expect(r.warningCounts.ZERO_VOLUME).toBe(1);
    expect(r.perSymbol[0].zeroVolumeBars).toBe(1);
  });

  it("flags abnormal pct change", () => {
    const files = [
      file("300750.SZ", [
        bar("300750.SZ", "2024-01-02", {
          pctChange: ABNORMAL_PCT_CHANGE_THRESHOLD + 5,
        }),
      ]),
    ];
    const r = buildDataHealthReport(files);
    expect(r.warningCounts.ABNORMAL_PCT_CHANGE).toBe(1);
  });

  it("flags short history below threshold", () => {
    const few = Array.from({ length: 5 }, (_, i) =>
      bar("300750.SZ", `2024-01-${String(i + 2).padStart(2, "0")}`),
    );
    const r = buildDataHealthReport([file("300750.SZ", few)]);
    expect(r.warningCounts.SHORT_HISTORY).toBe(1);
    expect(SHORT_HISTORY_THRESHOLD).toBeGreaterThan(few.length);
  });

  it("flags missing adjust field", () => {
    const long = Array.from({ length: SHORT_HISTORY_THRESHOLD }, (_, i) => {
      const d = new Date("2024-01-02T00:00:00Z");
      // skip weekends so we don't double-trip MISSING_WEEKDAY
      let added = 0;
      let cursor = new Date(d);
      while (added < i) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        const day = cursor.getUTCDay();
        if (day !== 0 && day !== 6) added += 1;
      }
      return bar("300750.SZ", cursor.toISOString().slice(0, 10));
    });
    const f: CachedSymbolFile = {
      symbol: "300750.SZ",
      name: "x",
      bars: long,
    };
    const r = buildDataHealthReport([f]);
    expect(r.warningCounts.ADJUST_MISSING).toBe(1);
  });

  it("EMPTY_FILE when bars array is empty", () => {
    const r = buildDataHealthReport([file("300750.SZ", [])]);
    expect(r.warningCounts.EMPTY_FILE).toBe(1);
    expect(r.perSymbol[0].barCount).toBe(0);
  });

  it("computes universe-wide date range from earliest start and latest end", () => {
    const r = buildDataHealthReport([
      file("A.SH", [bar("A.SH", "2024-01-02"), bar("A.SH", "2024-01-03")]),
      file("B.SH", [bar("B.SH", "2024-01-05"), bar("B.SH", "2024-01-08")]),
    ]);
    expect(r.dateRange.start).toBe("2024-01-02");
    expect(r.dateRange.end).toBe("2024-01-08");
  });
});

describe("renderDataHealthReportMarkdown", () => {
  it("produces a structured markdown document with summary + per-symbol table", () => {
    const r = buildDataHealthReport([
      file("300750.SZ", [
        bar("300750.SZ", "2024-01-02", { volume: 0 }),
        bar("300750.SZ", "2024-01-03"),
      ]),
    ]);
    const md = renderDataHealthReportMarkdown(r, {
      source: "akshareLocal",
      generatedAt: "2024-03-31T12:00:00Z",
      cachePath: "/tmp/fake",
    });
    expect(md).toContain("# Pangzi data-health report — akshareLocal");
    expect(md).toContain("## Summary");
    expect(md).toContain("## Per-symbol summary");
    expect(md).toContain("300750.SZ");
    expect(md).toContain("ZERO_VOLUME");
  });

  it("notes a clean cache when no warnings exist", () => {
    // 60 contiguous weekdays so there is no SHORT_HISTORY / MISSING_WEEKDAY flag.
    const bars: StockDailyBar[] = [];
    const cur = new Date("2024-01-02T00:00:00Z");
    while (bars.length < SHORT_HISTORY_THRESHOLD) {
      const day = cur.getUTCDay();
      if (day !== 0 && day !== 6) {
        bars.push(bar("300750.SZ", cur.toISOString().slice(0, 10)));
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    // Anchor `today` to the test data so STALE_LAST_DATE doesn't fire.
    const lastDate = bars[bars.length - 1].date;
    const r = buildDataHealthReport([file("300750.SZ", bars)], { today: lastDate });
    const md = renderDataHealthReportMarkdown(r, {
      source: "akshareLocal",
      generatedAt: "x",
      cachePath: "x",
    });
    // Trading calendar is absent → there is at least the calendar-unavailable notice.
    expect(r.severityCounts.ERROR).toBe(0);
    expect(md).toContain("Severity counts");
  });
});
