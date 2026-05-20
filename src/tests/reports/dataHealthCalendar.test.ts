import { describe, expect, it } from "vitest";
import {
  buildDataHealthReport,
  renderDataHealthReportMarkdown,
  type CachedSymbolFile,
  type TradingCalendar,
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

function file(symbol: string, bars: StockDailyBar[]): CachedSymbolFile {
  return { symbol, name: symbol, adjust: "qfq", barCount: bars.length, bars };
}

const TODAY = "2024-12-31";

describe("dataHealth — calendar awareness", () => {
  it("with calendar: missing-date warnings fire only on calendar trading days", () => {
    // Calendar treats 2024-01-03 as a HOLIDAY (e.g. Mid-Autumn). Without
    // calendar the v1.4 path would have flagged it; v1.5 must not.
    const calendar: TradingCalendar = {
      source: "test",
      fetchedAt: "2024-01-01",
      dates: ["2024-01-02", "2024-01-04", "2024-01-05"],
    };
    const r = buildDataHealthReport(
      [
        file("300750.SZ", [
          bar("300750.SZ", "2024-01-02"),
          bar("300750.SZ", "2024-01-04"),
        ]),
      ],
      { calendar, today: TODAY },
    );
    expect(r.warningCounts.MISSING_WEEKDAY ?? 0).toBe(0);
    expect(r.warningCounts.MISSING_TRADING_DATE ?? 0).toBe(0);
  });

  it("with calendar: flags REAL missing trading day", () => {
    const calendar: TradingCalendar = {
      source: "test",
      fetchedAt: "2024-01-01",
      dates: ["2024-01-02", "2024-01-03", "2024-01-04"],
    };
    const r = buildDataHealthReport(
      [
        file("300750.SZ", [
          bar("300750.SZ", "2024-01-02"),
          bar("300750.SZ", "2024-01-04"),
          // 2024-01-03 is in calendar but missing from cache.
        ]),
      ],
      { calendar, today: TODAY },
    );
    expect(r.warningCounts.MISSING_TRADING_DATE).toBe(1);
    const w = r.warnings.find((x) => x.kind === "MISSING_TRADING_DATE");
    expect(w?.date).toBe("2024-01-03");
    expect(w?.severity).toBe("WARNING");
  });

  it("without calendar: MISSING_WEEKDAY is INFO severity and notice is added", () => {
    const r = buildDataHealthReport(
      [
        file("300750.SZ", [
          bar("300750.SZ", "2024-01-02"),
          bar("300750.SZ", "2024-01-05"),
        ]),
      ],
      { today: TODAY },
    );
    expect(r.warningCounts.MISSING_WEEKDAY).toBeGreaterThanOrEqual(2);
    const sample = r.warnings.find((w) => w.kind === "MISSING_WEEKDAY");
    expect(sample?.severity).toBe("INFO");
    expect(r.notices.some((n) => /calendar/i.test(n))).toBe(true);
  });

  it("computes coverage ratio using calendar", () => {
    const calendar: TradingCalendar = {
      source: "test",
      fetchedAt: "2024-01-01",
      dates: ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"],
    };
    const r = buildDataHealthReport(
      [
        file("300750.SZ", [
          bar("300750.SZ", "2024-01-02"),
          bar("300750.SZ", "2024-01-03"),
          bar("300750.SZ", "2024-01-05"),
        ]),
      ],
      { calendar, today: TODAY },
    );
    expect(r.perSymbol[0].coverageRatio).toBeCloseTo(0.75, 2);
    expect(r.coverageRatio).toBeCloseTo(0.75, 2);
  });

  it("flags STALE_LAST_DATE when last bar is older than threshold", () => {
    const calendar: TradingCalendar = {
      source: "test",
      fetchedAt: "2024-12-31",
      dates: ["2024-12-01", "2024-12-02"],
    };
    const r = buildDataHealthReport(
      [
        file("300750.SZ", [bar("300750.SZ", "2024-12-01"), bar("300750.SZ", "2024-12-02")]),
      ],
      { calendar, today: TODAY },
    );
    expect(r.warningCounts.STALE_LAST_DATE).toBe(1);
  });

  it("flags INCOMPLETE_LATEST_DATE when cache trails the calendar", () => {
    const calendar: TradingCalendar = {
      source: "test",
      fetchedAt: "2024-12-31",
      dates: ["2024-12-29", "2024-12-30", "2024-12-31"],
    };
    const r = buildDataHealthReport(
      [
        file("300750.SZ", [
          bar("300750.SZ", "2024-12-29"),
          bar("300750.SZ", "2024-12-30"),
          // missing 2024-12-31
        ]),
      ],
      { calendar, today: TODAY },
    );
    expect(r.warningCounts.INCOMPLETE_LATEST_DATE).toBe(1);
  });

  it("renders the calendar source in the markdown", () => {
    const calendar: TradingCalendar = {
      source: "akshare.tool_trade_date_hist_sina",
      fetchedAt: "2024-01-01",
      dates: ["2024-01-02"],
    };
    const r = buildDataHealthReport(
      [file("300750.SZ", [bar("300750.SZ", "2024-01-02")])],
      { calendar, today: TODAY },
    );
    const md = renderDataHealthReportMarkdown(r, {
      source: "akshareLocal",
      generatedAt: "now",
      cachePath: "x",
    });
    expect(md).toContain("akshare.tool_trade_date_hist_sina");
    expect(md).toContain("Severity counts");
  });
});
