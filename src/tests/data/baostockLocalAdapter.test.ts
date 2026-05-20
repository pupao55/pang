import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createBaostockLocalAdapter,
  getBaostockLocalCacheStatus,
} from "@/lib/data/adapters/baostockLocalAdapter";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pangzi-baostock-"));
  fs.mkdirSync(path.join(tmp, "daily-bars"), { recursive: true });
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function writeBars(symbol: string, dates: string[]): void {
  fs.writeFileSync(
    path.join(tmp, "daily-bars", `${symbol}.json`),
    JSON.stringify({
      symbol,
      name: "Test",
      exchange: symbol.endsWith(".SH") ? "SH" : "SZ",
      adjust: "qfq",
      source: "baostock.query_history_k_data_plus",
      fetchedAt: "x",
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      barCount: dates.length,
      bars: dates.map((d) => ({
        date: d,
        open: 10,
        high: 11,
        low: 9,
        close: 10.5,
        volume: 1000,
        amount: 10500,
        turnoverRate: 1,
        pctChange: 0,
      })),
    }),
  );
}

describe("baostockLocalAdapter", () => {
  it("cache status returns ok=false when empty", () => {
    expect(getBaostockLocalCacheStatus(tmp).ok).toBe(false);
  });

  it("throws a helpful error when adapter constructed on empty cache", () => {
    expect(() => createBaostockLocalAdapter(tmp)).toThrow(/BaoStock local cache/);
  });

  it("loads JSON cache and infers board types correctly", async () => {
    writeBars("300750.SZ", ["2024-01-02"]);
    writeBars("688981.SH", ["2024-01-02"]);
    const a = createBaostockLocalAdapter(tmp);
    const metas = await a.getStockMetas();
    const star = metas.find((m) => m.symbol === "688981.SH");
    const chinext = metas.find((m) => m.symbol === "300750.SZ");
    expect(star?.boardType).toBe("STAR");
    expect(chinext?.boardType).toBe("CHINEXT");
  });

  it("slices bars to the requested window inclusively", async () => {
    writeBars("300750.SZ", [
      "2024-01-02",
      "2024-01-03",
      "2024-01-04",
      "2024-01-05",
    ]);
    const a = createBaostockLocalAdapter(tmp);
    const bars = await a.getDailyBars("300750.SZ", "2024-01-03", "2024-01-04");
    expect(bars.map((b) => b.date)).toEqual(["2024-01-03", "2024-01-04"]);
  });

  it("sets metadataMode FALLBACK and surfaces warnings when no extras present", () => {
    writeBars("300750.SZ", ["2024-01-02"]);
    const a = createBaostockLocalAdapter(tmp);
    expect(a.metadataMode).toBe("FALLBACK");
    expect(a.sectorMode).toBe("MISSING");
    expect(a.sentimentMode).toBe("MISSING");
    expect(a.sectorIsFallback).toBe(true);
    expect(a.sentimentIsFallback).toBe(true);
    expect(a.warnings.some((w) => /BaoStock/.test(w))).toBe(true);
  });

  it("id is `baostockLocal`", () => {
    writeBars("300750.SZ", ["2024-01-02"]);
    const a = createBaostockLocalAdapter(tmp);
    expect(a.id).toBe("baostockLocal");
  });
});
