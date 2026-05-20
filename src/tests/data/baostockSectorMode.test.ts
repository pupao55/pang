import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBaostockLocalAdapter } from "@/lib/data/adapters/baostockLocalAdapter";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pangzi-baostock-sectors-"));
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

function writeSectorFile(date: string, source: string): void {
  fs.mkdirSync(path.join(tmp, "sectors"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, "sectors", `${date}.json`),
    JSON.stringify({
      source,
      date,
      snapshots: [
        {
          date,
          sectorName: "BOARD_MAIN",
          sectorType: "BOARD",
          pctChange: 1.5,
          limitUpCount: 1,
          topStocks: ["600000.SH"],
          strengthRank: 1,
          momentumScore: 80,
        },
      ],
    }),
  );
}

describe("baostockLocalAdapter sectorMode (v1.8)", () => {
  it("sectorMode = GENERATED when sector file declares source=localSectorBuilder", async () => {
    writeBars("600000.SH", ["2024-01-02"]);
    writeSectorFile("2024-01-02", "localSectorBuilder");
    const a = createBaostockLocalAdapter(tmp);
    expect(a.sectorMode).toBe("GENERATED");
    expect(a.sectorIsFallback).toBe(false);
  });

  it("sectorMode = REAL when sector file declares an upstream source", async () => {
    writeBars("600000.SH", ["2024-01-02"]);
    writeSectorFile("2024-01-02", "akshare.stock_board_industry_name_em");
    const a = createBaostockLocalAdapter(tmp);
    expect(a.sectorMode).toBe("REAL");
    expect(a.sectorIsFallback).toBe(false);
  });

  it("sectorMode = MISSING when sectors directory empty", async () => {
    writeBars("600000.SH", ["2024-01-02"]);
    const a = createBaostockLocalAdapter(tmp);
    expect(a.sectorMode).toBe("MISSING");
    expect(a.sectorIsFallback).toBe(true);
  });

  it("metadataMode = REAL when metadata/stocks.json is present", async () => {
    writeBars("600000.SH", ["2024-01-02"]);
    fs.mkdirSync(path.join(tmp, "metadata"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "metadata", "stocks.json"),
      JSON.stringify({
        source: "baostock.query_stock_industry",
        totalSymbols: 1,
        withIndustry: 1,
        warnings: [],
        stocks: [
          {
            symbol: "600000.SH",
            name: "Test",
            industry: "Banks",
            industrySource: "baostock.query_stock_industry",
            syntheticBoardGroup: "BOARD_MAIN",
            syntheticPrefixGroup: "PREFIX_600",
            boardType: "MAIN",
          },
        ],
      }),
    );
    const a = createBaostockLocalAdapter(tmp);
    expect(a.metadataMode).toBe("REAL");
    const metas = await a.getStockMetas();
    expect(metas[0].industry).toBe("Banks");
  });

  it("getSectorSnapshots returns the local snapshot when GENERATED", async () => {
    writeBars("600000.SH", ["2024-01-02"]);
    writeSectorFile("2024-01-02", "localSectorBuilder");
    const a = createBaostockLocalAdapter(tmp);
    const snap = await a.getSectorSnapshots("2024-01-02");
    expect(snap[0].sectorName).toBe("BOARD_MAIN");
  });
});
