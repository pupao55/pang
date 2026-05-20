import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAkshareLocalAdapter } from "@/lib/data/adapters/akshareLocalAdapter";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pangzi-ctx-"));
  fs.mkdirSync(path.join(tmpRoot, "daily-bars"), { recursive: true });
});
afterEach(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

function writeBars(symbol: string, dates: string[]) {
  const payload = {
    symbol,
    name: "",
    exchange: symbol.endsWith(".SH") ? "SH" : "SZ",
    adjust: "qfq",
    source: "akshare.stock_zh_a_hist",
    fetchedAt: new Date().toISOString(),
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
  };
  fs.writeFileSync(
    path.join(tmpRoot, "daily-bars", `${symbol}.json`),
    JSON.stringify(payload),
  );
}

function writeMetadata() {
  const payload = {
    source: "akshare",
    fetchedAt: "2024-01-01",
    totalSymbols: 1,
    withIndustry: 1,
    warnings: [],
    stocks: [
      {
        symbol: "300750.SZ",
        name: "宁德时代",
        exchange: "SZ",
        boardType: "CHINEXT",
        industry: "电池",
        concepts: [],
        isST: false,
        marketCap: 1.2e12,
        floatMarketCap: 9.8e11,
      },
    ],
  };
  fs.mkdirSync(path.join(tmpRoot, "metadata"), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, "metadata", "stocks.json"), JSON.stringify(payload));
}

function writeSector(date: string) {
  const payload = {
    source: "akshare.stock_board_industry_name_em",
    date,
    fetchedAt: "x",
    warnings: [],
    snapshots: [
      {
        date,
        sectorName: "电池",
        sectorType: "INDUSTRY",
        pctChange: 1.5,
        limitUpCount: 0,
        topStocks: ["300750.SZ"],
        strengthRank: 1,
        momentumScore: 85,
      },
    ],
  };
  fs.mkdirSync(path.join(tmpRoot, "sectors"), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, "sectors", `${date}.json`), JSON.stringify(payload));
}

function writeSentiment(date: string) {
  fs.mkdirSync(path.join(tmpRoot, "sentiment"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpRoot, "sentiment", "sentiment.jsonl"),
    JSON.stringify({
      date,
      indexTrend: "UP",
      limitUpCount: 60,
      limitDownCount: 5,
      failedLimitUpRate: 0.1,
      maxConsecutiveLimitUp: 4,
      yesterdayLimitUpPerformance: 2.1,
      marketRegime: "STRONG",
    }) + "\n",
  );
}

describe("akshareLocalAdapter v1.6 — fallback priority", () => {
  it("metadata FALLBACK + sector MISSING + sentiment MISSING when no extras", async () => {
    writeBars("300750.SZ", ["2024-01-02"]);
    const a = createAkshareLocalAdapter(tmpRoot);
    expect(a.metadataMode).toBe("FALLBACK");
    expect(a.sectorMode).toBe("MISSING");
    expect(a.sentimentMode).toBe("MISSING");
    expect(a.sectorIsFallback).toBe(true);
    expect(a.sentimentIsFallback).toBe(true);
  });

  it("metadata REAL when stocks.json present", async () => {
    writeBars("300750.SZ", ["2024-01-02"]);
    writeMetadata();
    const a = createAkshareLocalAdapter(tmpRoot);
    const metas = await a.getStockMetas();
    expect(a.metadataMode).toBe("REAL");
    expect(metas[0].industry).toBe("电池");
    expect(metas[0].name).toBe("宁德时代");
  });

  it("sector REAL when sectors/{date}.json present", async () => {
    writeBars("300750.SZ", ["2024-01-02"]);
    writeSector("2024-01-02");
    const a = createAkshareLocalAdapter(tmpRoot);
    expect(a.sectorMode).toBe("REAL");
    const snap = await a.getSectorSnapshots("2024-01-02");
    expect(snap[0].sectorName).toBe("电池");
    expect(snap[0].momentumScore).toBe(85);
  });

  it("sector falls back to nearest-prior calendar date", async () => {
    writeBars("300750.SZ", ["2024-01-02"]);
    writeSector("2024-01-02");
    const a = createAkshareLocalAdapter(tmpRoot);
    const snap = await a.getSectorSnapshots("2024-01-05");
    expect(snap[0].date).toBe("2024-01-02");
  });

  it("sentiment GENERATED when sentiment.jsonl present", async () => {
    writeBars("300750.SZ", ["2024-01-02"]);
    writeSentiment("2024-01-02");
    const a = createAkshareLocalAdapter(tmpRoot);
    expect(a.sentimentMode).toBe("GENERATED");
    expect(a.sentimentIsFallback).toBe(false);
    const s = await a.getMarketSentiment("2024-01-02");
    expect(s?.marketRegime).toBe("STRONG");
    expect(s?.limitUpCount).toBe(60);
  });
});
