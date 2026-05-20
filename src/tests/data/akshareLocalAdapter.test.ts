import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAkshareLocalAdapter,
  getAkshareLocalCacheStatus,
  inferBoardType,
} from "@/lib/data/adapters/akshareLocalAdapter";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pangzi-akshare-"));
  fs.mkdirSync(path.join(tmpRoot, "daily-bars"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeCache(symbol: string, bars: { date: string; close: number }[]): void {
  const payload = {
    symbol,
    name: `Stock ${symbol}`,
    exchange: symbol.endsWith(".SH") ? "SH" : symbol.endsWith(".BJ") ? "BJ" : "SZ",
    adjust: "qfq",
    source: "akshare.stock_zh_a_hist",
    fetchedAt: new Date().toISOString(),
    startDate: bars[0]?.date ?? "",
    endDate: bars[bars.length - 1]?.date ?? "",
    barCount: bars.length,
    bars: bars.map((b) => ({
      date: b.date,
      open: b.close,
      high: b.close * 1.01,
      low: b.close * 0.99,
      close: b.close,
      volume: 10000,
      amount: b.close * 10000,
      turnoverRate: 2,
      pctChange: 0,
    })),
  };
  fs.writeFileSync(
    path.join(tmpRoot, "daily-bars", `${symbol}.json`),
    JSON.stringify(payload),
  );
}

describe("inferBoardType", () => {
  it("maps 688 / 689 to STAR", () => {
    expect(inferBoardType("688981.SH").board).toBe("STAR");
    expect(inferBoardType("689009.SH").board).toBe("STAR");
  });
  it("maps 3xxxxx to CHINEXT", () => {
    expect(inferBoardType("300750.SZ").board).toBe("CHINEXT");
  });
  it("maps 6/0/2 to MAIN", () => {
    expect(inferBoardType("600000.SH").board).toBe("MAIN");
    expect(inferBoardType("000001.SZ").board).toBe("MAIN");
    expect(inferBoardType("002415.SZ").board).toBe("MAIN");
  });
  it("flags BJ as MAIN-with-warning until v2", () => {
    const r = inferBoardType("430000.BJ");
    expect(r.board).toBe("MAIN");
    expect(r.warning).toMatch(/北交所/);
  });
});

describe("akshareLocalAdapter cache status", () => {
  it("reports ok=false when cache is empty", () => {
    const s = getAkshareLocalCacheStatus(tmpRoot);
    expect(s.ok).toBe(false);
    expect(s.symbolCount).toBe(0);
  });

  it("reports ok=true when at least one JSON file is present", () => {
    writeCache("600000.SH", [{ date: "2024-01-02", close: 10 }]);
    const s = getAkshareLocalCacheStatus(tmpRoot);
    expect(s.ok).toBe(true);
    expect(s.symbolCount).toBe(1);
  });

  it("throws a useful error when no cache exists", () => {
    expect(() => createAkshareLocalAdapter(tmpRoot)).toThrow(/AkShare local cache/);
  });
});

describe("akshareLocalAdapter date filtering", () => {
  it("slices bars to the requested window inclusively", async () => {
    writeCache("600000.SH", [
      { date: "2024-01-02", close: 10 },
      { date: "2024-01-03", close: 11 },
      { date: "2024-01-04", close: 12 },
      { date: "2024-01-05", close: 13 },
    ]);
    const a = createAkshareLocalAdapter(tmpRoot);
    const bars = await a.getDailyBars("600000.SH", "2024-01-03", "2024-01-04");
    expect(bars.map((b) => b.date)).toEqual(["2024-01-03", "2024-01-04"]);
  });

  it("derives trading calendar from cache union", async () => {
    writeCache("600000.SH", [
      { date: "2024-01-02", close: 1 },
      { date: "2024-01-03", close: 1 },
    ]);
    writeCache("300750.SZ", [
      { date: "2024-01-03", close: 1 },
      { date: "2024-01-04", close: 1 },
    ]);
    const a = createAkshareLocalAdapter(tmpRoot);
    const cal = await a.getTradingCalendar("2024-01-01", "2024-01-31");
    expect(cal).toEqual(["2024-01-02", "2024-01-03", "2024-01-04"]);
  });

  it("derives StockMeta with inferred boardType", async () => {
    writeCache("688981.SH", [{ date: "2024-01-02", close: 100 }]);
    writeCache("300750.SZ", [{ date: "2024-01-02", close: 100 }]);
    const a = createAkshareLocalAdapter(tmpRoot);
    const metas = await a.getStockMetas();
    const star = metas.find((m) => m.symbol === "688981.SH");
    const chinext = metas.find((m) => m.symbol === "300750.SZ");
    expect(star?.boardType).toBe("STAR");
    expect(chinext?.boardType).toBe("CHINEXT");
  });

  it("flags sector and sentiment as fallback in v1.2", () => {
    writeCache("600000.SH", [{ date: "2024-01-02", close: 10 }]);
    const a = createAkshareLocalAdapter(tmpRoot);
    expect(a.sectorIsFallback).toBe(true);
    expect(a.sentimentIsFallback).toBe(true);
  });
});
