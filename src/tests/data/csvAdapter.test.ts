import { describe, expect, it } from "vitest";
import { createCsvAdapter } from "@/lib/data/adapters/csvAdapter";
import type { StockMeta } from "@/lib/types/stock";

const meta: StockMeta = {
  symbol: "600000",
  name: "TestCo",
  exchange: "SH",
  boardType: "MAIN",
  industry: "Banks",
  concepts: [],
  isST: false,
  marketCap: 1e10,
  floatMarketCap: 1e10,
};

const HEADER =
  "symbol,name,date,open,high,low,close,volume,amount,turnoverRate,pctChange";

describe("csvAdapter", () => {
  it("loads bars from raw CSV text and slices by date range", async () => {
    const csv = [
      HEADER,
      "600000,TestCo,2024-01-02,10,11,9,10.5,1000,10500,2,1",
      "600000,TestCo,2024-01-03,10.5,11,10,10.8,1100,11500,2.2,2.8",
      "600000,TestCo,2024-01-04,10.8,11.2,10.5,11,1200,12500,2.4,1.85",
    ].join("\n");
    const a = createCsvAdapter({ metas: [meta], csv });
    const bars = await a.getDailyBars("600000", "2024-01-03", "2024-01-03");
    expect(bars).toHaveLength(1);
    expect(bars[0].date).toBe("2024-01-03");
  });

  it("returns sector snapshot fallback by most-recent date", async () => {
    const a = createCsvAdapter({
      metas: [meta],
      bars: { "600000": [] },
      sectorsByDate: {
        "2024-01-02": [
          {
            date: "2024-01-02",
            sectorName: "Banks",
            pctChange: 1,
            limitUpCount: 0,
            topStocks: [],
            strengthRank: 1,
            momentumScore: 70,
          },
        ],
      },
    });
    const snap = await a.getSectorSnapshots("2024-01-05");
    expect(snap[0].sectorName).toBe("Banks");
  });

  it("derives trading calendar from bars when not supplied", async () => {
    const a = createCsvAdapter({
      metas: [meta],
      bars: {
        "600000": [
          { ...sampleBar("2024-01-02") },
          { ...sampleBar("2024-01-03") },
        ],
      },
    });
    const cal = await a.getTradingCalendar("2024-01-01", "2024-01-31");
    expect(cal).toEqual(["2024-01-02", "2024-01-03"]);
  });

  it("throws when neither bars nor csv are provided", () => {
    expect(() => createCsvAdapter({ metas: [meta] })).toThrow();
  });
});

function sampleBar(date: string) {
  return {
    symbol: "600000",
    name: "TestCo",
    date,
    open: 10,
    high: 11,
    low: 9,
    close: 10.5,
    volume: 1000,
    amount: 10500,
    turnoverRate: 2,
    pctChange: 1,
  };
}
