import { describe, expect, it } from "vitest";
import { importDailyBarsCsv } from "@/lib/data/csvImporter";

const HEADER =
  "symbol,name,date,open,high,low,close,volume,amount,turnoverRate,pctChange";

describe("importDailyBarsCsv", () => {
  it("parses a valid CSV into bars sorted by date", () => {
    const csv = [
      HEADER,
      "600000,TestCo,2024-01-04,10,11,9.5,10.5,1000,10500,2.1,5.0",
      "600000,TestCo,2024-01-03,9.8,10.2,9.6,10.0,900,9500,1.8,0.5",
    ].join("\n");
    const r = importDailyBarsCsv(csv, { skipGapDetection: true });
    expect(r.hasFatalError).toBe(false);
    expect(r.bars["600000"].map((b) => b.date)).toEqual([
      "2024-01-03",
      "2024-01-04",
    ]);
    expect(r.warnings).toHaveLength(0);
  });

  it("returns a fatal warning when required columns are missing", () => {
    const csv = ["symbol,date,close", "600000,2024-01-03,10"].join("\n");
    const r = importDailyBarsCsv(csv);
    expect(r.hasFatalError).toBe(true);
    expect(r.warnings.some((w) => w.kind === "MISSING_COLUMN")).toBe(true);
  });

  it("flags an invalid date", () => {
    const csv = [HEADER, "600000,X,not-a-date,1,1,1,1,1,1,1,1"].join("\n");
    const r = importDailyBarsCsv(csv, { skipGapDetection: true });
    expect(r.warnings.some((w) => w.kind === "INVALID_DATE")).toBe(true);
    expect(r.bars["600000"]).toBeUndefined();
  });

  it("flags a non-numeric field", () => {
    const csv = [HEADER, "600000,X,2024-01-03,abc,1,1,1,1,1,1,1"].join("\n");
    const r = importDailyBarsCsv(csv, { skipGapDetection: true });
    expect(r.warnings.some((w) => w.kind === "INVALID_NUMBER")).toBe(true);
  });

  it("detects duplicate symbol+date rows", () => {
    const csv = [
      HEADER,
      "600000,X,2024-01-03,1,1,1,1,1,1,1,1",
      "600000,X,2024-01-03,2,2,2,2,2,2,2,2",
    ].join("\n");
    const r = importDailyBarsCsv(csv, { skipGapDetection: true });
    expect(r.warnings.some((w) => w.kind === "DUPLICATE_ROW")).toBe(true);
    expect(r.bars["600000"]).toHaveLength(1);
  });

  it("detects missing trading dates via weekday heuristic", () => {
    // 2024-01-02 Tuesday, 2024-01-04 Thursday; Wednesday is missing.
    const csv = [
      HEADER,
      "600000,X,2024-01-02,1,1,1,1,1,1,1,1",
      "600000,X,2024-01-04,1,1,1,1,1,1,1,1",
    ].join("\n");
    const r = importDailyBarsCsv(csv);
    expect(
      r.warnings.some(
        (w) => w.kind === "MISSING_TRADING_DATE" && w.date === "2024-01-03",
      ),
    ).toBe(true);
  });

  it("flags row length mismatch", () => {
    const csv = [HEADER, "600000,X,2024-01-03,1,1,1"].join("\n");
    const r = importDailyBarsCsv(csv);
    expect(r.warnings.some((w) => w.kind === "BAD_ROW_LENGTH")).toBe(true);
  });

  it("returns EMPTY_FILE for empty input", () => {
    const r = importDailyBarsCsv("");
    expect(r.hasFatalError).toBe(true);
    expect(r.warnings[0].kind).toBe("EMPTY_FILE");
  });
});
